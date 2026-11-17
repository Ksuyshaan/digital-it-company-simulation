import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { CourseContext } from '../common/course-context.service'
import { NotifyService } from '../common/notify.service'
import { AuditService } from '../common/audit.service'
import { FilesService } from '../files/files.service'
import { StateService } from '../state/state.service'
import { fail, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { Link, TeamRole } from '../domain/types'
import { BADGES, allScores, badgesOf, isStaff, submittedAt } from '../domain/rules'
import { WEEK, now, shortName } from '../domain/util'

@Injectable()
export class ProfileService {
  constructor(
    private readonly db: PrismaService,
    private readonly ctx: CourseContext,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly state: StateService,
  ) {}

  /** Профиль студента (п. 3.1): ФИО, почта и группа — из учётной записи и не редактируются */
  async update(actor: Actor, p: { about: string; skills: string[]; wantedRoles: TeamRole[]; links: Link[] }) {
    const roles = actor.courseId ? (await this.ctx.read(actor)).s.settings.roles : undefined
    if (!p.about?.trim()) fail('Заполните поле «О себе»')
    if (p.about.length > 500) fail('«О себе» — до 500 символов')
    const skills = [...new Set((p.skills ?? []).map((x) => String(x).trim()).filter(Boolean))]
    if (skills.length < 3 || skills.length > 15) fail('Навыков должно быть от 3 до 15')
    if (skills.some((x) => x.length > 40)) fail('Навык — до 40 символов')
    const wanted = [...new Set(p.wantedRoles ?? [])]
    if (wanted.length < 1 || wanted.length > 2) fail('Выберите 1–2 желаемые роли')
    if (roles && wanted.some((r) => !roles.includes(r))) fail('Роль не из списка ролей курса')
    const links = (p.links ?? []).map((l) => ({ label: String(l.label ?? '').trim().slice(0, 40) || 'Ссылка', url: String(l.url ?? '').trim() }))
    if (links.length > 5) fail('Не больше 5 ссылок')
    for (const l of links) if (!/^https?:\/\/\S+\.\S+/.test(l.url) || l.url.length > 500) fail(`Некорректная ссылка: ${l.url || '(пусто)'}`)
    const u = await this.db.user.findUniqueOrThrow({ where: { id: actor.user.id } })
    await this.db.user.update({
      where: { id: u.id },
      data: { about: p.about.trim(), skills, wantedRoles: wanted, links, profileFilledAt: u.profileFilledAt ?? new Date() },
    })
    for (const e of actor.user.courseIds) this.state.invalidate(e, ['profile'])
    return { ok: true }
  }

  async uploadPhoto(actor: Actor, file: Express.Multer.File) {
    const f = await this.files.upload(actor, file, { context: 'photo' })
    await this.db.user.update({ where: { id: actor.user.id }, data: { photoFileId: f.id } })
    for (const e of actor.user.courseIds) this.state.invalidate(e, ['profile'])
    return { photo: `/api/files/${f.id}` }
  }

  async removePhoto(actor: Actor) {
    await this.db.user.update({ where: { id: actor.user.id }, data: { photoFileId: null } })
    for (const e of actor.user.courseIds) this.state.invalidate(e, ['profile'])
    return { ok: true }
  }

  /** Поиск профилей по имени, навыку и желаемой роли, сортировка по рейтингу (п. 3.1) */
  async search(actor: Actor, q: { q?: string; skill?: string; role?: string; sort?: 'rating' | 'name'; freeOnly?: boolean }) {
    const view = await this.state.view(actor)
    const text = q.q?.trim().toLowerCase()
    const skill = q.skill?.trim().toLowerCase()
    const inDraft = new Set(view.formation?.teams.flatMap((t) => t.memberIds) ?? [])
    let list = view.users.filter((u) => u.role === 'student')
    if (text) list = list.filter((u) => u.name.toLowerCase().includes(text) || u.group.toLowerCase().includes(text))
    if (skill) list = list.filter((u) => u.skills.some((s) => s.toLowerCase().includes(skill)))
    if (q.role) list = list.filter((u) => u.wantedRoles.includes(q.role as TeamRole))
    if (q.freeOnly) list = list.filter((u) => !u.teamId && !inDraft.has(u.id))
    const sc = view.computed.scores
    const place = (id: string) => sc[id]?.place ?? Number.MAX_SAFE_INTEGER
    list.sort(q.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ru') : (a, b) => place(a.id) - place(b.id))
    return list.map((u) => ({ ...u, score: sc[u.id] ?? null, badges: view.computed.badges[u.id] ?? [] }))
  }

  /** Лента активности: сдачи, проверки, начисления баллов (п. 3.1). Причины начислений — только сам студент и преподаватель */
  async activity(actor: Actor, userId: string) {
    const c = await this.ctx.read(actor)
    const u = must(c.s.users.find((x) => x.id === userId), 'Пользователь не найден')
    const own = userId === c.me.id || isStaff(c.me) || c.me.role === 'admin'
    const items: { at: number; kind: string; text: string }[] = []
    for (const sub of c.s.submissions.filter((x) => x.studentId === userId && x.versions.length)) {
      const a = c.s.assignments.find((x) => x.id === sub.assignmentId)
      items.push({ at: submittedAt(sub), kind: 'submission', text: `Сдана работа «${a?.title ?? ''}»` })
    }
    for (const sub of c.s.submissions)
      for (const r of sub.reviews.filter((x) => x.reviewerId === userId && x.doneAt)) {
        const a = c.s.assignments.find((x) => x.id === sub.assignmentId)
        items.push({ at: r.doneAt!, kind: 'review', text: `Проверена работа по «${a?.title ?? ''}»` })
      }
    if (own)
      for (const adj of c.s.adjustments.filter((x) => x.studentId === userId))
        items.push({ at: adj.at, kind: 'points', text: `${adj.delta > 0 ? 'Начислено' : 'Списано'} ${adj.delta > 0 ? '+' : ''}${adj.delta} (${adj.component}) · «${adj.reason}»` })
    if (u.profileFilledAt) items.push({ at: u.profileFilledAt, kind: 'profile', text: 'Профиль заполнен' })
    return items.sort((a, b) => b.at - a.at).slice(0, 200)
  }

  /** Рейтинг курса и команд (п. 3.5) с учётом настройки видимости */
  async rating(actor: Actor) {
    const view = await this.state.view(actor)
    const rows = view.users
      .filter((u) => u.role === 'student' && view.computed.scores[u.id])
      .map((u) => ({ userId: u.id, name: u.name, group: u.group, teamId: u.teamId, ...view.computed.scores[u.id], rdWeekAgo: u.rdWeekAgo }))
      .sort((a, b) => a.place - b.place)
    const me = view.computed.scores[actor.user.id] as { RD?: number } | undefined
    const threshold = view.settings.admissionThreshold
    return {
      visibility: view.settings.ratingVisibility,
      students: rows,
      teams: view.computed.teamScores,
      admission: me?.RD !== undefined ? { threshold, rd: me.RD, missing: Math.max(0, threshold - me.RD) } : undefined,
    }
  }

  /* ───────── баллы (п. 7) ───────── */

  /** Ручное начисление/списание: только с причиной; попадает в журнал и профиль студента */
  async adjustPoints(actor: Actor, studentId: string, component: 'A' | 'K' | 'P', delta: number, reason: string) {
    const c = await this.ctx.staff(actor, 'Начислять баллы может только преподаватель или ассистент')
    if (!['A', 'K', 'P'].includes(component)) fail('Компонент: A, K или P')
    if (!reason?.trim()) fail('Укажите причину — она попадёт в журнал и будет видна студенту')
    if (!delta || !Number.isFinite(delta) || Math.abs(delta) > 60) fail('Укажите количество баллов')
    const u = must(c.s.users.find((x) => x.id === studentId && x.role === 'student'), 'Студент не найден')
    await this.db.pointAdjustment.create({ data: { courseId: c.courseId, studentId, component, delta, reason: reason.trim(), byId: c.me.id } })
    const sign = delta > 0 ? '+' : ''
    await this.audit.log(actor, c.courseId, `Ручное ${delta > 0 ? 'начисление' : 'списание'} ${sign}${delta} (${component}) · ${shortName(u.name)} · «${reason.trim()}»`, {
      objectType: 'user', objectId: studentId, newValue: { component, delta, reason: reason.trim() },
    })
    await this.notify.send(studentId, `${delta > 0 ? 'Начислено' : 'Списано'} ${sign}${delta} балл. · «${reason.trim()}»`, '/profile', 'grade', c.courseId)
    this.ctx.done(c.courseId, 'rating')
    return { ok: true }
  }

  /** Балл проекта команды 0–60 (п. 7.4) — преподаватель */
  async setProjectScore(actor: Actor, teamId: string, score: number) {
    const c = await this.ctx.teacher(actor, 'Изменять итоговые баллы проекта может только преподаватель')
    if (!(score >= 0 && score <= 60)) fail('Балл за проект — от 0 до 60')
    const t = must(c.s.teams.find((x) => x.id === teamId), 'Команда не найдена')
    await this.db.team.update({ where: { id: teamId }, data: { projectScore: score } })
    await this.audit.log(actor, c.courseId, `Балл проекта команды ${t.name}: ${score}`, { objectType: 'team', objectId: teamId, oldValue: t.projectScore, newValue: score })
    await this.notify.sendMany(t.memberIds, `Балл за проект команды ${t.name}: ${score} из 60`, '/profile', 'grade', c.courseId)
    this.ctx.done(c.courseId, 'rating')
    return { ok: true }
  }

  /** Личная корректировка балла проекта не более ±20% с причиной (п. 7.4) */
  async setProjectAdjust(actor: Actor, studentId: string, pct: number, reason: string) {
    const c = await this.ctx.teacher(actor, 'Изменять итоговые баллы проекта может только преподаватель')
    if (!(Math.abs(pct) <= 20)) fail('Изменить балл проекта можно не более чем на 20%')
    if (!reason?.trim()) fail('Укажите причину')
    const u = must(c.s.users.find((x) => x.id === studentId && x.role === 'student'), 'Студент не найден')
    await this.db.enrollment.update({ where: { userId_courseId: { userId: studentId, courseId: c.courseId } }, data: { projectAdjust: pct / 100 } })
    const sign = pct > 0 ? '+' : ''
    await this.audit.log(actor, c.courseId, `Балл проекта ${shortName(u.name)}: ${sign}${pct}% · «${reason.trim()}»`, { objectType: 'user', objectId: studentId, oldValue: u.projectAdjust, newValue: pct / 100 })
    await this.notify.send(studentId, `Балл за проект изменён на ${sign}${pct}% · «${reason.trim()}»`, '/profile', 'grade', c.courseId)
    this.ctx.done(c.courseId, 'rating')
    return { ok: true }
  }

  /* ───────── достижения (п. 3.5) ───────── */

  async grantBadge(actor: Actor, userId: string, key: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    if (!BADGES.some((b) => b.key === key)) fail('Неизвестное достижение')
    const u = must(c.s.users.find((x) => x.id === userId && x.role === 'student'), 'Студент не найден')
    if (c.s.manualBadges.some((b) => b.userId === userId && b.key === key)) fail('Достижение уже выдано')
    await this.db.manualBadge.create({ data: { courseId: c.courseId, userId, key, byId: c.me.id } })
    const title = BADGES.find((b) => b.key === key)!.title
    await this.audit.log(actor, c.courseId, `Выдано достижение «${title}» · ${u.name}`, { objectType: 'user', objectId: userId, newValue: key })
    await this.notify.send(userId, `Новое достижение: «${title}»`, '/profile', 'system', c.courseId)
    this.ctx.done(c.courseId, 'badges')
    return { ok: true }
  }

  async revokeBadge(actor: Actor, userId: string, key: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    await this.db.manualBadge.deleteMany({ where: { courseId: c.courseId, userId, key } })
    await this.audit.log(actor, c.courseId, `Отозвано достижение «${key}»`, { objectType: 'user', objectId: userId, oldValue: key })
    this.ctx.done(c.courseId, 'badges')
    return { ok: true }
  }

  badges(actor: Actor) {
    return this.ctx.read(actor).then((c) => ({
      catalog: BADGES,
      byUser: Object.fromEntries(c.s.users.filter((u) => u.role === 'student').map((u) => [u.id, badgesOf(c.s, u)])),
    }))
  }

  /* ───────── уведомления ───────── */

  async notifications(actor: Actor) {
    const rows = await this.db.notification.findMany({ where: { userId: actor.user.id }, orderBy: { at: 'desc' }, take: 100 })
    return rows.map((n) => ({ id: n.id, userId: n.userId, at: n.at.getTime(), text: n.text, link: n.link, kind: n.kind, read: n.read }))
  }

  async markRead(actor: Actor, ids?: string[]) {
    await this.db.notification.updateMany({ where: { userId: actor.user.id, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { read: true } })
    return { ok: true }
  }

  /** Для дашборда: сколько баллов не хватает до допуска и текущая неделя */
  async summary(actor: Actor) {
    const c = await this.ctx.read(actor)
    const sc = allScores(c.s).get(actor.user.id)
    const week = Math.min(c.s.course.weeks, Math.max(1, Math.floor((now() - c.s.course.start) / WEEK) + 1))
    return {
      week,
      scores: sc ?? null,
      admission: sc ? { threshold: c.s.settings.admissionThreshold, missing: Math.max(0, c.s.settings.admissionThreshold - sc.RD) } : null,
    }
  }
}
