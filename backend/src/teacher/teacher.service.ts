import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../common/prisma.service'
import { CourseContext } from '../common/course-context.service'
import { AuditService } from '../common/audit.service'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { Course, CourseSettings, State } from '../domain/types'
import { allScores, computeSignals, isStaff, memberMetrics, teamMetrics, type Period } from '../domain/rules'
import { WEEK, fmtDateTime, now } from '../domain/util'

export type PeriodQuery = { period?: 'week' | 'sprint' | 'stage' | 'all' | 'custom'; from?: number; to?: number; week?: number; sprintId?: string; stage?: 1 | 2 }

@Injectable()
export class TeacherService {
  constructor(
    private readonly db: PrismaService,
    private readonly ctx: CourseContext,
    private readonly audit: AuditService,
  ) {}

  /* ───────── блокировки (п. 4.4) ───────── */

  /** «Только чтение» для доски команды, всех досок или задания; может включаться по расписанию (from в будущем) */
  async addLock(actor: Actor, scope: 'all' | 'team' | 'assignment', targetId: string | undefined, reason: string, from: number) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    if (!reason?.trim()) fail('Укажите причину — её увидят студенты на баннере')
    let what = 'все доски'
    if (scope === 'team') what = `доска ${must(c.s.teams.find((t) => t.id === targetId), 'Команда не найдена').name}`
    if (scope === 'assignment') what = `задание «${must(c.s.assignments.find((a) => a.id === targetId), 'Задание не найдено').title}»`
    const start = from || now()
    const l = await this.db.lock.create({ data: { courseId: c.courseId, scope, targetId: scope === 'all' ? null : targetId, reason: reason.trim(), from: new Date(start), createdById: c.me.id, firedAt: start <= now() ? new Date() : null } })
    await this.audit.log(actor, c.courseId, `Блокировка: ${what} с ${fmtDateTime(start)} · «${reason.trim()}»`, { objectType: 'lock', objectId: l.id, newValue: { scope, targetId, from: start } })
    this.ctx.done(c.courseId, 'locks')
    return { id: l.id }
  }

  async cancelLock(actor: Actor, id: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    const l = must(c.s.locks.find((x) => x.id === id), 'Блокировка не найдена')
    await this.db.lock.update({ where: { id }, data: { cancelled: true } })
    await this.audit.log(actor, c.courseId, `Блокировка снята · «${l.reason}»`, { objectType: 'lock', objectId: id })
    this.ctx.done(c.courseId, 'locks')
    return { ok: true }
  }

  /* ───────── сигналы (п. 6) ───────── */

  async signals(actor: Actor) {
    const c = await this.ctx.read(actor)
    if (!isStaff(c.me)) forbid('Сигналы видит преподаватель')
    return computeSignals(c.s)
  }

  async dismissSignal(actor: Actor, id: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    await this.db.dismissedSignal.upsert({ where: { courseId_signalId: { courseId: c.courseId, signalId: id } }, create: { courseId: c.courseId, signalId: id }, update: {} })
    this.ctx.done(c.courseId, 'signals')
    return { ok: true }
  }

  /* ───────── аналитика (п. 6) ───────── */

  resolvePeriod(s: State, q: PeriodQuery, teamId?: string): { p: Period; sprintId?: string } {
    const start = s.course.start
    const t = now()
    switch (q.period) {
      case 'week': {
        const w = q.week ?? Math.max(1, Math.floor((t - start) / WEEK) + 1)
        return { p: { from: start + (w - 1) * WEEK, to: start + w * WEEK - 1, label: `Неделя ${w}` } }
      }
      case 'sprint': {
        const sp = q.sprintId ? s.sprints.find((x) => x.id === q.sprintId) : s.sprints.find((x) => x.teamId === teamId && x.status === 'active')
        if (!sp) return { p: { from: start, to: t, label: 'Весь курс' } }
        return { p: { from: sp.start, to: sp.end, label: sp.name }, sprintId: sp.id }
      }
      case 'stage':
        return q.stage === 1
          ? { p: { from: start, to: start + 8 * WEEK - 1, label: 'Этап 1 (недели 1–8)' } }
          : { p: { from: start + 8 * WEEK, to: start + s.course.weeks * WEEK, label: 'Этап 2 (недели 9–15)' } }
      case 'custom':
        return { p: { from: q.from ?? start, to: q.to ?? t, label: 'Период' } }
      default:
        return { p: { from: start, to: start + s.course.weeks * WEEK, label: 'Весь курс' } }
    }
  }

  /** Метрики по курсу, команде или студенту за период */
  async metrics(actor: Actor, scope: 'course' | 'team' | 'student', id: string | undefined, q: PeriodQuery) {
    const c = await this.ctx.read(actor)
    const staff = isStaff(c.me) || c.me.role === 'admin'
    const s = c.s
    const sc = allScores(s)
    if (scope === 'student') {
      const uid = id ?? c.me.id
      if (!staff && uid !== c.me.id) forbid('Студент видит только свои метрики')
      const u = must(s.users.find((x) => x.id === uid), 'Студент не найден')
      const { p } = this.resolvePeriod(s, q, u.teamId)
      return { period: p, metrics: memberMetrics(s, u, p), scores: sc.get(uid) ?? null }
    }
    if (scope === 'team') {
      const tid = id ?? c.me.teamId
      if (!staff && tid !== c.me.teamId) forbid('Студент видит метрики только своей команды')
      const team = must(s.teams.find((x) => x.id === tid), 'Команда не найдена')
      const { p, sprintId } = this.resolvePeriod(s, q, team.id)
      const tm = teamMetrics(s, team, p, sprintId)
      const members = team.memberIds.map((mid) => {
        const u = s.users.find((x) => x.id === mid)!
        return { userId: mid, name: u?.name, teamRole: u?.teamRole, metrics: memberMetrics(s, u, p), ...(staff ? { scores: sc.get(mid) ?? null } : {}) }
      })
      const ms = members.map((m) => sc.get(m.userId)).filter(Boolean)
      const avgOf = (k: 'R1' | 'R2' | 'RD') => (ms.length ? ms.reduce((a, x) => a + x![k], 0) / ms.length : 0)
      return { period: p, team: { id: team.id, name: team.name }, metrics: tm, members: staff ? members : members.map(({ userId, name, teamRole }) => ({ userId, name, teamRole })), rating: { R1: avgOf('R1'), R2: avgOf('R2'), RD: avgOf('RD') } }
    }
    if (!staff) forbid('Метрики курса видит преподаватель')
    const { p } = this.resolvePeriod(s, q)
    const teams = s.teams.map((team) => {
      const sp = q.period === 'sprint' ? this.resolvePeriod(s, q, team.id) : { p, sprintId: undefined }
      return { teamId: team.id, name: team.name, metrics: teamMetrics(s, team, sp.p, sp.sprintId) }
    })
    const students = s.users
      .filter((u) => u.role === 'student')
      .map((u) => ({ userId: u.id, name: u.name, teamId: u.teamId, metrics: memberMetrics(s, u, p), scores: sc.get(u.id) ?? null }))
    return {
      period: p,
      totals: {
        students: students.length,
        teams: teams.length,
        cardsDone: teams.reduce((a, t) => a + t.metrics.doneCount, 0),
        overdue: teams.reduce((a, t) => a + t.metrics.overdue, 0),
        admitted: students.filter((x) => (x.scores?.RD ?? 0) >= s.settings.admissionThreshold).length,
      },
      teams,
      students,
      signals: computeSignals(s),
    }
  }

  /* ───────── настройки курса ───────── */

  /** Формула оценивания и веса — только преподаватель (раздел 2) */
  async updateSettings(actor: Actor, patch: Partial<CourseSettings>, course?: Partial<Pick<Course, 'name' | 'stream' | 'start' | 'weeks'>>) {
    const c = await this.ctx.teacher(actor, 'Изменять настройки курса может только преподаватель')
    const next = { ...c.s.settings, ...patch }
    if (Math.abs(next.teacherWeight + next.peerWeight - 1) > 0.001) fail('Сумма весов преподавателя и рецензентов должна быть равна 1')
    if (next.teacherWeight < 0 || next.peerWeight < 0) fail('Веса не могут быть отрицательными')
    if (next.teamMin < 1 || next.teamMin > next.teamMax) fail('Минимальный размер команды больше максимального')
    if (next.teamMax > 20) fail('Размер команды — не больше 20')
    if (![1, 2].includes(next.sprintWeeks)) fail('Длительность спринта — 1 или 2 недели')
    if (!['scrum', 'kanban'].includes(next.boardMode)) fail('Режим доски: Scrum или Kanban')
    if (!['full', 'places', 'top10'].includes(next.ratingVisibility)) fail('Неизвестный режим видимости рейтинга')
    if (next.latePenaltyPct < 0 || next.latePenaltyPct > 100) fail('Штраф — от 0 до 100%')
    if (next.lateCloseHours < 0 || next.lateCloseHours > 24 * 30) fail('Закрытие сдачи — от 0 до 720 часов')
    if (next.admissionThreshold < 0 || next.admissionThreshold > 100) fail('Порог допуска — от 0 до 100')
    if (next.wipLimit < 1) fail('WIP-лимит — не меньше 1')
    if (!next.roles.includes('Team Lead')) fail('Роль Team Lead обязательна')
    if (next.boardMode === 'scrum' && !next.roles.includes('Scrum Master')) fail('В Scrum-режиме нужна роль Scrum Master')
    const data: Prisma.CourseUpdateInput = { settings: next as unknown as Prisma.InputJsonValue }
    if (course?.name !== undefined) data.name = String(course.name).trim() || c.s.course.name
    if (course?.stream !== undefined) data.stream = String(course.stream).trim() || c.s.course.stream
    if (course?.start !== undefined) data.start = new Date(course.start)
    if (course?.weeks !== undefined) {
      if (!(course.weeks >= 1 && course.weeks <= 30)) fail('Длительность курса — от 1 до 30 недель')
      data.weeks = course.weeks
    }
    await this.db.course.update({ where: { id: c.courseId }, data })
    const changed = Object.keys(patch).filter((k) => JSON.stringify((c.s.settings as unknown as Record<string, unknown>)[k]) !== JSON.stringify((patch as Record<string, unknown>)[k]))
    await this.audit.log(actor, c.courseId, `Изменены настройки курса${changed.length ? ': ' + changed.join(', ') : ''}`, {
      objectType: 'course', objectId: c.courseId,
      oldValue: Object.fromEntries(changed.map((k) => [k, (c.s.settings as unknown as Record<string, unknown>)[k]])),
      newValue: { ...Object.fromEntries(changed.map((k) => [k, (patch as Record<string, unknown>)[k]])), ...(course ?? {}) },
    })
    this.ctx.done(c.courseId, 'settings', 'rating')
    return { ok: true, settings: next }
  }

  /** Код приглашения на курс (п. 8: «по коду приглашения») */
  async regenerateInvite(actor: Actor) {
    const c = await this.ctx.teacher(actor)
    const code = Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    await this.db.course.update({ where: { id: c.courseId }, data: { inviteCode: code } })
    await this.audit.log(actor, c.courseId, 'Создан новый код приглашения на курс')
    return { inviteCode: code }
  }

  async inviteCode(actor: Actor) {
    const c = await this.ctx.read(actor)
    if (!isStaff(c.me)) forbid()
    const course = await this.db.course.findUniqueOrThrow({ where: { id: c.courseId } })
    return { inviteCode: course.inviteCode }
  }

  /* ───────── журнал ───────── */

  /** Журнал действий: преподаватель — по курсу, администратор — по системе. Только чтение */
  async auditLog(actor: Actor, q: { before?: number; limit?: number; userId?: string; text?: string }) {
    const admin = actor.user.role === 'admin'
    if (!admin) {
      const c = await this.ctx.read(actor)
      if (!isStaff(c.me)) forbid('Журнал видит преподаватель')
    }
    const rows = await this.db.auditEntry.findMany({
      where: {
        ...(admin ? {} : { courseId: actor.courseId }),
        ...(q.before ? { at: { lt: new Date(q.before) } } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.text ? { text: { contains: q.text, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { at: 'desc' },
      take: Math.min(q.limit ?? 200, 1000),
    })
    return rows.map((a) => ({ ...a, at: a.at.getTime() }))
  }
}
