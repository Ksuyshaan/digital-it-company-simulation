import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../common/prisma.service'
import { CourseContext, type Ctx } from '../common/course-context.service'
import { NotifyService } from '../common/notify.service'
import { AuditService } from '../common/audit.service'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { TeamRole } from '../domain/types'
import { checkTeam, isStaff, slug } from '../domain/rules'
import { MIN, WEEK, fmtDateTime, now, shortName } from '../domain/util'

@Injectable()
export class TeamsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ctx: CourseContext,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  /* ───────── окно формирования (недели 8–9) ───────── */

  /** По умолчанию окно закрывается в воскресенье 9 недели, 23:59 */
  defaultDeadline(courseStart: number) {
    return courseStart + 9 * WEEK - MIN
  }

  async openFormation(actor: Actor, deadline?: number) {
    const c = await this.ctx.staff(actor, 'Открыть формирование команд может преподаватель')
    const course = await this.db.course.findUniqueOrThrow({ where: { id: c.courseId } })
    if (course.frozenAt) fail('Составы уже заморожены — дальше их меняет только преподаватель')
    const d = deadline ?? this.defaultDeadline(c.s.course.start)
    if (!(d > now())) fail('Срок окна формирования должен быть в будущем')
    await this.db.course.update({ where: { id: c.courseId }, data: { formationOpen: true, formationDeadline: new Date(d) } })
    const students = c.s.users.filter((u) => u.role === 'student').map((u) => u.id)
    await this.notify.sendMany(students, `Открыто формирование команд до ${fmtDateTime(d)}`, '/teams', 'team', c.courseId)
    await this.audit.log(actor, c.courseId, `Открыто окно формирования команд до ${fmtDateTime(d)}`, { objectType: 'course', objectId: c.courseId })
    this.ctx.done(c.courseId, 'teams')
    return { ok: true, deadline: d }
  }

  /** Продлить или сократить окно (преподаватель) */
  async setFormationDeadline(actor: Actor, deadline: number) {
    const c = await this.ctx.staff(actor)
    if (!c.s.formation) fail('Окно формирования команд закрыто')
    await this.db.course.update({ where: { id: c.courseId }, data: { formationDeadline: new Date(deadline) } })
    await this.audit.log(actor, c.courseId, `Срок формирования команд: ${fmtDateTime(deadline)}`)
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  private formationOpen(c: Ctx) {
    if (!c.s.formation) return 'Окно формирования команд закрыто'
    if (now() > c.s.formation.deadline) return 'Окно формирования закрыто, составы меняет только преподаватель'
    return null
  }

  private requireOpen(c: Ctx, staffBypass = false) {
    const e = this.formationOpen(c)
    if (e && !(staffBypass && isStaff(c.me) && c.s.formation)) fail(e)
  }

  private draft(c: Ctx, teamId: string) {
    return must(c.s.formation?.teams.find((t) => t.id === teamId), 'Команда не найдена')
  }

  private teamOf(c: Ctx, userId: string) {
    return c.s.formation?.teams.find((t) => t.memberIds.includes(userId))
  }

  private async saveDraft(teamId: string, data: { memberIds?: string[]; roles?: Record<string, string>; status?: string; returnComment?: string | null; approvedOverride?: string | null }) {
    await this.db.team.update({
      where: { id: teamId },
      data: {
        ...(data.memberIds ? { draftMemberIds: data.memberIds } : {}),
        ...(data.roles ? { roles: data.roles } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.returnComment !== undefined ? { returnComment: data.returnComment } : {}),
        ...(data.approvedOverride !== undefined ? { approvedOverride: data.approvedOverride } : {}),
      },
    })
  }

  async createDraftTeam(actor: Actor, name: string, idea: string) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c)
    if (c.me.role !== 'student') forbid('Создать команду на этапе формирования может студент')
    if (this.teamOf(c, c.me.id)) fail('Вы уже состоите в команде')
    if (!name?.trim() || !idea?.trim()) fail('Укажите название и идею проекта')
    if (name.trim().length > 60) fail('Название — до 60 символов')
    const all = [...c.s.formation!.teams, ...c.s.teams]
    if (all.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) fail('Команда с таким названием уже есть')
    const t = await this.db.team.create({
      data: {
        courseId: c.courseId,
        name: name.trim(),
        idea: idea.trim(),
        initiatorId: c.me.id,
        stage: 'formation',
        status: 'draft',
        draftMemberIds: [c.me.id],
        roles: { [c.me.id]: 'Team Lead' },
      },
    })
    await this.db.formationRequest.deleteMany({ where: { courseId: c.courseId, studentId: c.me.id } })
    this.ctx.done(c.courseId, 'teams')
    return { id: t.id }
  }

  async requestJoin(actor: Actor, teamId: string) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c)
    if (c.me.role !== 'student') forbid('Заявки подают студенты')
    const t = this.draft(c, teamId)
    if (this.teamOf(c, c.me.id)) fail('Студент состоит только в одной команде')
    const mine = c.s.formation!.requests.filter((r) => r.studentId === c.me.id && r.kind === 'request')
    if (mine.length >= 3) fail('Не больше 3 активных заявок')
    if (mine.some((r) => r.teamId === teamId)) fail('Заявка уже отправлена')
    if (t.memberIds.length >= c.s.settings.teamMax) fail(`В команде уже ${c.s.settings.teamMax} человек`)
    await this.db.formationRequest.create({ data: { courseId: c.courseId, teamId, studentId: c.me.id, kind: 'request' } })
    await this.notify.send(t.initiatorId, `Новая заявка в ${t.name} · ${shortName(c.me.name)}`, '/teams', 'team', c.courseId)
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async cancelRequest(actor: Actor, reqId: string) {
    const c = await this.ctx.write(actor)
    const rq = must(c.s.formation?.requests.find((r) => r.id === reqId), 'Заявка не найдена')
    const t = this.draft(c, rq.teamId)
    const own = (rq.kind === 'request' && rq.studentId === c.me.id) || (rq.kind === 'invite' && t.initiatorId === c.me.id)
    if (!own && !isStaff(c.me)) forbid('Отозвать можно только свою заявку или приглашение')
    await this.db.formationRequest.delete({ where: { id: reqId } })
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async invite(actor: Actor, teamId: string, studentId: string) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c)
    const t = this.draft(c, teamId)
    if (t.initiatorId !== c.me.id && !isStaff(c.me)) forbid('Приглашать может инициатор команды')
    must(c.s.users.find((u) => u.id === studentId && u.role === 'student'), 'Студент не найден')
    if (this.teamOf(c, studentId)) fail('Студент уже в команде')
    if (c.s.formation!.requests.some((r) => r.teamId === teamId && r.studentId === studentId)) fail('Приглашение уже отправлено')
    if (t.memberIds.length >= c.s.settings.teamMax) fail(`В команде уже ${c.s.settings.teamMax} человек`)
    await this.db.formationRequest.create({ data: { courseId: c.courseId, teamId, studentId, kind: 'invite' } })
    await this.notify.send(studentId, `Вас пригласили в команду ${t.name}`, '/teams', 'team', c.courseId)
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async answer(actor: Actor, reqId: string, accept: boolean) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c)
    const rq = must(c.s.formation!.requests.find((r) => r.id === reqId), 'Заявка не найдена')
    const t = this.draft(c, rq.teamId)
    if (rq.kind === 'request' && t.initiatorId !== c.me.id && !isStaff(c.me)) forbid('Заявку принимает инициатор команды')
    if (rq.kind === 'invite' && rq.studentId !== c.me.id) forbid('Приглашение принимает сам студент')
    if (!accept) {
      await this.db.formationRequest.delete({ where: { id: reqId } })
      await this.notify.send(rq.kind === 'request' ? rq.studentId : t.initiatorId, `${rq.kind === 'request' ? 'Заявка в' : 'Приглашение в'} ${t.name} отклонено`, '/teams', 'team', c.courseId)
      this.ctx.done(c.courseId, 'teams')
      return { ok: true }
    }
    if (this.teamOf(c, rq.studentId)) fail('Студент уже в другой команде')
    if (t.memberIds.length >= c.s.settings.teamMax) fail(`В команде максимум ${c.s.settings.teamMax} человек`)
    const student = c.s.users.find((u) => u.id === rq.studentId)
    const wanted = (student?.wantedRoles.find((r) => r !== 'Team Lead') as TeamRole) ?? 'Developer'
    await this.db.$transaction([
      this.db.team.update({
        where: { id: t.id },
        data: { draftMemberIds: [...t.memberIds, rq.studentId], roles: { ...(t.roles ?? {}), [rq.studentId]: wanted }, status: 'draft' },
      }),
      // после вступления остальные заявки и приглашения студента снимаются
      this.db.formationRequest.deleteMany({ where: { courseId: c.courseId, studentId: rq.studentId } }),
    ])
    await this.notify.send(rq.studentId, `Вы в команде ${t.name}`, '/teams', 'team', c.courseId)
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async setMemberRole(actor: Actor, teamId: string, studentId: string, role: TeamRole) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c, true)
    const t = this.draft(c, teamId)
    if (t.initiatorId !== c.me.id && !isStaff(c.me)) forbid('Роли распределяет инициатор команды')
    if (!t.memberIds.includes(studentId)) fail('Студент не в команде')
    if (!c.s.settings.roles.includes(role)) fail('Такой роли нет в списке ролей курса')
    await this.saveDraft(teamId, { roles: { ...(t.roles ?? {}), [studentId]: role }, status: t.status === 'pending' || t.status === 'returned' ? 'draft' : undefined })
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async removeMember(actor: Actor, teamId: string, studentId: string) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c, true)
    const t = this.draft(c, teamId)
    if (t.initiatorId !== c.me.id && studentId !== c.me.id && !isStaff(c.me)) forbid('Нет прав')
    if (studentId === t.initiatorId && t.memberIds.length > 1 && !isStaff(c.me)) fail('Инициатор не может выйти, пока в команде есть участники')
    const memberIds = t.memberIds.filter((x) => x !== studentId)
    if (!memberIds.length) {
      await this.db.team.delete({ where: { id: teamId } })
    } else {
      const roles = { ...(t.roles ?? {}) }
      delete roles[studentId]
      const initiator = studentId === t.initiatorId ? memberIds[0] : t.initiatorId
      await this.db.team.update({ where: { id: teamId }, data: { draftMemberIds: memberIds, roles, status: 'draft', initiatorId: initiator } })
    }
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async check(actor: Actor, teamId: string) {
    const c = await this.ctx.read(actor)
    const t = this.draft(c, teamId)
    return checkTeam(c.s, t, t.roles ?? {})
  }

  async submit(actor: Actor, teamId: string) {
    const c = await this.ctx.write(actor)
    this.requireOpen(c)
    const t = this.draft(c, teamId)
    if (t.initiatorId !== c.me.id) forbid('Отправляет инициатор')
    const bad = checkTeam(c.s, t, t.roles ?? {}).filter((x) => !x.ok)
    if (bad.length) fail(`Не выполнено правило: ${bad[0].label}`)
    await this.saveDraft(teamId, { status: 'pending', returnComment: null })
    const teachers = c.s.users.filter((u) => isStaff(u)).map((u) => u.id)
    await this.notify.sendMany(teachers, `Команда ${t.name} отправлена на утверждение`, '/teacher/teams', 'team', c.courseId)
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  async review(actor: Actor, teamId: string, decision: 'approve' | 'return' | 'override', comment = '') {
    const c = await this.ctx.staff(actor, 'Утверждает преподаватель')
    const t = this.draft(c, teamId)
    let status = t.status
    if (decision === 'return') {
      if (!comment.trim()) fail('Напишите комментарий, что исправить')
      status = 'returned'
      await this.saveDraft(teamId, { status, returnComment: comment.trim() })
    } else if (decision === 'override') {
      if (!comment.trim()) fail('Укажите причину утверждения в обход правил')
      status = 'approved'
      await this.saveDraft(teamId, { status, approvedOverride: comment.trim() })
    } else {
      const bad = checkTeam(c.s, t, t.roles ?? {}).filter((x) => !x.ok)
      if (bad.length) fail(`Нарушено правило: ${bad[0].label}. Можно утвердить в обход правил с причиной`)
      status = 'approved'
      await this.saveDraft(teamId, { status })
    }
    await this.notify.sendMany(t.memberIds, `Команда ${t.name}: ${status === 'approved' ? 'состав утверждён' : `возвращена — «${comment}»`}`, '/teams', 'team', c.courseId)
    await this.audit.log(actor, c.courseId, `Команда ${t.name}: ${decision === 'approve' ? 'утверждена' : decision === 'override' ? `утверждена в обход правил («${comment}»)` : `возвращена («${comment}»)`}`, {
      objectType: 'team', objectId: teamId, oldValue: t.status, newValue: status,
    })
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }

  /** После закрытия окна: распределить студентов без команды по неполным командам */
  async autoDistribute(actor: Actor) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    if (!c.s.formation) fail('Окно формирования команд закрыто')
    const teams = c.s.formation!.teams.map((t) => ({ ...t, memberIds: [...t.memberIds], roles: { ...(t.roles ?? {}) } }))
    const inTeam = new Set(teams.flatMap((t) => t.memberIds))
    const free = c.s.users.filter((u) => u.role === 'student' && !inTeam.has(u.id))
    const changed = new Set<string>()
    let moved = 0
    for (const u of free) {
      const target = teams.filter((t) => t.memberIds.length < c.s.settings.teamMax).sort((a, b) => a.memberIds.length - b.memberIds.length)[0]
      if (!target) break
      target.memberIds.push(u.id)
      target.roles[u.id] = (u.wantedRoles.find((r) => r !== 'Team Lead' && r !== 'Scrum Master') as TeamRole) ?? 'Developer'
      changed.add(target.id)
      moved++
    }
    for (const t of teams.filter((x) => changed.has(x.id))) await this.saveDraft(t.id, { memberIds: t.memberIds, roles: t.roles as Record<string, string> })
    if (moved) await this.db.formationRequest.deleteMany({ where: { courseId: c.courseId, studentId: { in: free.map((u) => u.id) } } })
    await this.audit.log(actor, c.courseId, `Автораспределение: ${moved} студентов добавлены в неполные команды`)
    this.ctx.done(c.courseId, 'teams')
    if (!moved) fail(free.length ? 'Нет свободных мест в командах — создайте новую команду вручную' : 'Все студенты уже в командах')
    return { moved, left: free.length - moved }
  }

  /** Заморозка составов: черновики → команды с каналом и доской; дальше составы меняет только преподаватель */
  async freeze(actor: Actor) {
    const c = await this.ctx.teacher(actor, 'Замораживает составы преподаватель')
    const f = must(c.s.formation, 'Окно формирования команд закрыто')
    const pending = f.teams.filter((t) => t.status !== 'approved')
    if (pending.length) fail(`Не утверждено команд: ${pending.length}. Утвердите или верните их`)
    await this.db.$transaction(async (tx) => {
      for (const t of f.teams) {
        const ch = await tx.channel.create({ data: { courseId: c.courseId, kind: 'team', name: slug(t.name), teamId: t.id } })
        const sm = t.memberIds.filter((id) => t.roles?.[id] === 'Scrum Master')
        await tx.team.update({ where: { id: t.id }, data: { stage: 'active', channelId: ch.id, smHistory: sm, draftMemberIds: [] } })
        for (const id of t.memberIds)
          await tx.enrollment.update({ where: { userId_courseId: { userId: id, courseId: c.courseId } }, data: { teamId: t.id, teamRole: t.roles?.[id] ?? 'Developer' } })
      }
      await tx.formationRequest.deleteMany({ where: { courseId: c.courseId } })
      await tx.course.update({ where: { id: c.courseId }, data: { formationOpen: false, frozenAt: new Date() } })
    })
    const all = f.teams.flatMap((t) => t.memberIds)
    await this.notify.sendMany(all, 'Составы команд заморожены. Начинается командный этап', '/board', 'team', c.courseId)
    await this.audit.log(actor, c.courseId, `Составы команд заморожены (${f.teams.length} команд)`)
    this.ctx.done(c.courseId, 'teams', 'board', 'chat')
    return { teams: f.teams.length }
  }

  /* ───────── после заморозки: управляет преподаватель/ассистент ───────── */

  async createTeam(actor: Actor, name: string, idea: string) {
    const c = await this.ctx.staff(actor)
    if (!name?.trim()) fail('Укажите название')
    if (c.s.teams.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) fail('Команда с таким названием уже есть')
    const t = await this.db.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { courseId: c.courseId, name: name.trim(), idea: idea?.trim() ?? '', initiatorId: c.me.id, stage: 'active', status: 'approved' } })
      const ch = await tx.channel.create({ data: { courseId: c.courseId, kind: 'team', name: slug(team.name), teamId: team.id } })
      return tx.team.update({ where: { id: team.id }, data: { channelId: ch.id } })
    })
    await this.audit.log(actor, c.courseId, `Создана команда ${t.name}`, { objectType: 'team', objectId: t.id })
    this.ctx.done(c.courseId, 'teams', 'chat')
    return { id: t.id }
  }

  async rename(actor: Actor, teamId: string, name: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    if (!name?.trim()) fail('Пустое название')
    const t = must(c.s.teams.find((x) => x.id === teamId), 'Команда не найдена')
    await this.db.$transaction([
      this.db.team.update({ where: { id: teamId }, data: { name: name.trim() } }),
      ...(t.channelId ? [this.db.channel.update({ where: { id: t.channelId }, data: { name: slug(name.trim()) } })] : []),
    ])
    await this.audit.log(actor, c.courseId, `Команда ${t.name} переименована в ${name.trim()}`, { objectType: 'team', objectId: teamId, oldValue: t.name, newValue: name.trim() })
    this.ctx.done(c.courseId, 'teams', 'chat')
    return { ok: true }
  }

  /** Расформировать: участники остаются без команды; доска и переписка сохраняются в архиве */
  async disband(actor: Actor, teamId: string, reason: string) {
    const c = await this.ctx.staff(actor)
    if (!reason?.trim()) fail('Укажите причину')
    const t = must(c.s.teams.find((x) => x.id === teamId), 'Команда не найдена')
    await this.db.$transaction([
      this.db.enrollment.updateMany({ where: { courseId: c.courseId, teamId }, data: { teamId: null, teamRole: null } }),
      this.db.team.update({ where: { id: teamId }, data: { stage: 'disbanded', status: 'returned', returnComment: reason.trim() } }),
    ])
    await this.notify.sendMany(t.memberIds, `Команда ${t.name} расформирована: «${reason.trim()}»`, '/teams', 'team', c.courseId)
    await this.audit.log(actor, c.courseId, `Команда ${t.name} расформирована · «${reason.trim()}»`, { objectType: 'team', objectId: teamId, oldValue: t.memberIds })
    this.ctx.done(c.courseId, 'teams', 'board', 'chat')
    return { ok: true }
  }

  async moveStudent(actor: Actor, studentId: string, teamId: string | null) {
    const c = await this.ctx.staff(actor, 'После заморозки составы меняет только преподаватель')
    const u = must(c.s.users.find((x) => x.id === studentId && x.role === 'student'), 'Студент не найден')
    const from = c.s.teams.find((t) => t.id === u.teamId)
    const to = teamId ? must(c.s.teams.find((t) => t.id === teamId), 'Команда не найдена') : null
    if (to && from?.id === to.id) return { ok: true }
    if (to && to.memberIds.length >= c.s.settings.teamMax) fail(`В команде ${to.name} уже ${c.s.settings.teamMax} человек`)
    const role = u.teamRole === 'Team Lead' || u.teamRole === 'Scrum Master' || !u.teamRole ? 'Developer' : u.teamRole
    await this.db.enrollment.update({ where: { userId_courseId: { userId: studentId, courseId: c.courseId } }, data: { teamId: to?.id ?? null, teamRole: to ? role : null } })
    await this.notify.send(studentId, to ? `Вас перевели в команду ${to.name}` : `Вы исключены из команды ${from?.name ?? ''}`, '/board', 'team', c.courseId)
    await this.audit.log(actor, c.courseId, `${shortName(u.name)}: ${from?.name ?? 'без команды'} → ${to?.name ?? 'без команды'}`, { objectType: 'user', objectId: studentId, oldValue: from?.id, newValue: to?.id })
    this.ctx.done(c.courseId, 'teams', 'board', 'chat')
    return { ok: true }
  }

  async setTeamRole(actor: Actor, studentId: string, role: TeamRole) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    const u = must(c.s.users.find((x) => x.id === studentId), 'Студент не найден')
    if (!u.teamId) fail('Студент не в команде')
    if (!c.s.settings.roles.includes(role)) fail('Такой роли нет в списке ролей курса')
    await this.db.enrollment.update({ where: { userId_courseId: { userId: studentId, courseId: c.courseId } }, data: { teamRole: role } })
    if (role === 'Scrum Master') {
      const t = await this.db.team.findUniqueOrThrow({ where: { id: u.teamId! } })
      const hist = new Set([...((t.smHistory as string[]) ?? []), studentId])
      await this.db.team.update({ where: { id: t.id }, data: { smHistory: [...hist] as Prisma.InputJsonValue } })
    }
    await this.audit.log(actor, c.courseId, `Роль ${shortName(u.name)} → ${role}`, { objectType: 'user', objectId: studentId, oldValue: u.teamRole, newValue: role })
    this.ctx.done(c.courseId, 'teams')
    return { ok: true }
  }
}
