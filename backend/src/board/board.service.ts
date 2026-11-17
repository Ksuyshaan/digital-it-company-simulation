import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../common/prisma.service'
import { CourseContext, type Ctx } from '../common/course-context.service'
import { NotifyService } from '../common/notify.service'
import { AuditService } from '../common/audit.service'
import { FilesService } from '../files/files.service'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { Card, Column, Priority, State, User } from '../domain/types'
import { COL_TITLE, PRIORITY, SP_VALUES, activeSprint, burndown, colIndex, isLocked, isStaff, moveError, needsReturnComment, wipOverflow } from '../domain/rules'
import { HOUR, MIN, fmtDateTime, now, shortName, sum } from '../domain/util'

const COLUMNS: Column[] = ['backlog', 'todo', 'progress', 'review', 'done']
const FIELD_LABEL: Record<string, string> = {
  title: 'Название', description: 'Описание', assigneeId: 'Исполнитель', deadline: 'Дедлайн', priority: 'Приоритет', sp: 'Story points', labels: 'Метки', sprintId: 'Спринт',
}

export interface CardFields {
  title?: string
  description?: string
  assigneeId?: string | null
  deadline?: number | null
  priority?: Priority
  sp?: number | null
  labels?: string[]
  sprintId?: string | null
}

const userName = (s: State, id: string | null | undefined) => (id ? s.users.find((u) => u.id === id)?.name ?? '—' : '—')

@Injectable()
export class BoardService {
  constructor(
    private readonly db: PrismaService,
    private readonly ctx: CourseContext,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  /* ───────── проверки ───────── */

  private canEditBoard(c: Ctx, teamId: string) {
    const team = c.s.teams.find((t) => t.id === teamId)
    if (!team) fail('Команда не найдена')
    if (isStaff(c.me)) return team!
    if (c.me.teamId !== teamId) forbid('Редактировать можно только доску своей команды')
    const lock = isLocked(c.s, teamId)
    if (lock) fail(`Доска только для чтения: ${lock.reason}`)
    return team!
  }

  private card(c: Ctx, cardId: string) {
    return must(c.s.cards.find((x) => x.id === cardId), 'Карточка не найдена')
  }

  private fmtField(s: State, field: string, v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    if (field === 'assigneeId') return userName(s, v as string)
    if (field === 'deadline') return fmtDateTime(v as number)
    if (field === 'priority') return PRIORITY[v as Priority]
    if (field === 'labels') return (v as string[]).join(', ') || '—'
    if (field === 'sprintId') return s.sprints.find((x) => x.id === v)?.name ?? 'Backlog'
    if (field === 'description') return String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v)
    return String(v)
  }

  private validateFields(c: Ctx, teamId: string, f: CardFields) {
    if (f.title !== undefined) {
      if (!f.title.trim()) fail('Укажите название')
      if (f.title.trim().length > 120) fail('Название — до 120 символов')
    }
    if (f.description !== undefined && f.description.length > 20_000) fail('Описание слишком длинное')
    if (f.assigneeId) {
      const team = c.s.teams.find((t) => t.id === teamId)!
      if (!team.memberIds.includes(f.assigneeId)) fail('Исполнитель — ровно один участник команды')
    }
    if (f.priority !== undefined && !['low', 'mid', 'high'].includes(f.priority)) fail('Приоритет: низкий, средний или высокий')
    if (f.sp !== undefined && f.sp !== null && !SP_VALUES.includes(f.sp)) fail('Story points: 1, 2, 3, 5, 8 или 13')
    if (f.labels !== undefined && (f.labels.length > 20 || f.labels.some((l) => typeof l !== 'string' || l.length > 40))) fail('Метки — до 20 штук, до 40 символов')
    if (f.sprintId) {
      const sp = c.s.sprints.find((x) => x.id === f.sprintId)
      if (!sp || sp.teamId !== teamId) fail('Спринт не найден')
      if (sp!.status === 'closed') fail('Спринт уже закрыт')
    }
  }

  private hist(cardId: string, teamId: string, userId: string, field: string, from: string, to: string, note?: string): Prisma.HistoryEntryCreateManyInput {
    return { cardId, teamId, userId, field, from, to, note, at: new Date() }
  }

  /* ───────── карточки ───────── */

  async createCard(actor: Actor, teamId: string, f: CardFields & { title: string; inSprint?: boolean }) {
    const c = await this.ctx.write(actor)
    const team = this.canEditBoard(c, teamId)
    this.validateFields(c, teamId, f)
    const { cardSeq } = await this.db.team.update({ where: { id: teamId }, data: { cardSeq: { increment: 1 } }, select: { cardSeq: true } })
    const pfx = team.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2).padEnd(2, 'X')
    const sprint = activeSprint(c.s, teamId)
    const card = await this.db.card.create({
      data: {
        key: `${pfx}-${String(cardSeq).padStart(2, '0')}`,
        teamId,
        sprintId: f.inSprint && sprint ? sprint.id : null,
        column: 'backlog',
        title: f.title.trim(),
        description: f.description ?? '',
        assigneeId: f.assigneeId ?? null,
        deadline: f.deadline ? new Date(f.deadline) : null,
        priority: f.priority ?? 'mid',
        sp: f.sp ?? null,
        labels: f.labels ?? [],
        authorId: c.me.id,
      },
    })
    await this.db.historyEntry.create({ data: this.hist(card.id, teamId, c.me.id, 'Создана', '—', card.title) })
    if (card.assigneeId && card.assigneeId !== c.me.id)
      await this.notify.send(card.assigneeId, `Вас назначили исполнителем ${card.key} «${card.title}»`, `/board?card=${card.id}`, 'assign', c.courseId)
    this.ctx.done(c.courseId, 'board')
    return { id: card.id, key: card.key }
  }

  async updateCard(actor: Actor, cardId: string, patch: CardFields) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    return this.applyPatch(c, card, patch)
  }

  private async applyPatch(c: Ctx, card: Card, patch: CardFields) {
    const allowed: (keyof CardFields)[] = ['title', 'description', 'assigneeId', 'deadline', 'priority', 'sp', 'labels', 'sprintId']
    const p = Object.fromEntries(Object.entries(patch).filter(([k, v]) => allowed.includes(k as keyof CardFields) && v !== undefined)) as CardFields
    this.validateFields(c, card.teamId, p)
    if (colIndex(card.column) >= 1) {
      if (p.assigneeId === null) fail('В колонке To Do и далее у карточки должен быть исполнитель')
      if (p.deadline === null) fail('В колонке To Do и далее у карточки должен быть дедлайн')
      if (p.description !== undefined && !p.description.trim()) fail('В колонке To Do и далее нужно описание')
      if (c.s.settings.boardMode === 'scrum' && p.sp === null) fail('В Scrum-режиме нужна оценка в story points')
    }
    const data: Prisma.CardUpdateInput = {}
    const history: Prisma.HistoryEntryCreateManyInput[] = []
    for (const [k, v] of Object.entries(p)) {
      const old = (card as unknown as Record<string, unknown>)[k]
      const val = k === 'title' ? String(v).trim() : v
      if (JSON.stringify(old ?? null) === JSON.stringify(val ?? null)) continue
      history.push(this.hist(card.id, card.teamId, c.me.id, FIELD_LABEL[k] ?? k, this.fmtField(c.s, k, old), this.fmtField(c.s, k, val)))
      if (k === 'deadline') {
        data.deadline = val ? new Date(val as number) : null
        data.notifiedDeadlineAt = null
        data.notifiedOverdueAt = null
      } else if (k === 'sprintId') data.sprintId = (val as string) ?? null
      else (data as Record<string, unknown>)[k] = val
    }
    if (!history.length) return { ok: true }
    await this.db.$transaction([this.db.card.update({ where: { id: card.id }, data }), this.db.historyEntry.createMany({ data: history })])
    if (p.assigneeId && p.assigneeId !== card.assigneeId && p.assigneeId !== c.me.id)
      await this.notify.send(p.assigneeId, `Вас назначили исполнителем ${card.key} «${p.title ?? card.title}»`, `/board?card=${card.id}`, 'assign', c.courseId)
    this.ctx.done(c.courseId, 'board')
    return { ok: true }
  }

  async moveCard(actor: Actor, cardId: string, to: Column, comment?: string) {
    if (!COLUMNS.includes(to)) fail('Неизвестная колонка')
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    if (card.archived) fail('Карточка в архиве')
    if (card.column === to) return { ok: true }
    this.canEditBoard(c, card.teamId)
    const err = moveError(c.s, card, to, c.me)
    if (err) fail(err)
    if (needsReturnComment(card, to) && !comment?.trim()) fail('Возврат из Review требует комментария')
    const from = card.column
    const data: Prisma.CardUpdateInput = { column: to }
    if (to === 'progress' && !card.startedAt) data.startedAt = new Date()
    if (to === 'done') data.closedAt = new Date()
    if (from === 'done') data.closedAt = null
    if (to !== 'backlog' && !card.sprintId) {
      const sp = activeSprint(c.s, card.teamId)
      if (sp) data.sprintId = sp.id
    }
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.db.card.update({ where: { id: cardId }, data }),
      this.db.historyEntry.create({ data: this.hist(cardId, card.teamId, c.me.id, 'Колонка', COL_TITLE[from], COL_TITLE[to], comment?.trim() || undefined) }),
    ]
    if (comment?.trim()) ops.push(this.db.cardComment.create({ data: { cardId, authorId: c.me.id, text: `Возврат в ${COL_TITLE[to]}: ${comment.trim()}` } }))
    await this.db.$transaction(ops)
    if (from === 'review' && colIndex(to) < colIndex('review') && card.assigneeId && card.assigneeId !== c.me.id)
      await this.notify.send(card.assigneeId, `${card.key} вернули из Review · ${shortName(c.me.name)}: «${comment}»`, `/board?card=${card.id}`, 'review', c.courseId)
    this.ctx.done(c.courseId, 'board')
    // WIP-лимит — предупреждение, не запрет (п. 4.1)
    let warning: string | undefined
    if (to === 'progress' && card.assigneeId) {
      const count = c.s.cards.filter((x) => x.teamId === card.teamId && x.column === 'progress' && !x.archived && x.assigneeId === card.assigneeId).length + 1
      if (count > c.s.settings.wipLimit) warning = `У ${shortName(userName(c.s, card.assigneeId))} в работе ${count} карточки — лимит ${c.s.settings.wipLimit}`
    }
    return { ok: true, warning }
  }

  async archiveCard(actor: Actor, cardId: string) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    if (card.archived) return { ok: true }
    await this.db.$transaction([
      this.db.card.update({ where: { id: cardId }, data: { archived: true } }),
      this.db.historyEntry.create({ data: this.hist(cardId, card.teamId, c.me.id, 'Архив', COL_TITLE[card.column], 'в архиве') }),
    ])
    this.ctx.done(c.courseId, 'board')
    return { ok: true }
  }

  async restoreCard(actor: Actor, cardId: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    const card = this.card(c, cardId)
    await this.db.$transaction([
      this.db.card.update({ where: { id: cardId }, data: { archived: false } }),
      this.db.historyEntry.create({ data: this.hist(cardId, card.teamId, c.me.id, 'Архив', 'в архиве', COL_TITLE[card.column]) }),
    ])
    this.ctx.done(c.courseId, 'board')
    return { ok: true }
  }

  async comment(actor: Actor, cardId: string, text: string, fileIds?: string[]) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    const team = this.canEditBoard(c, card.teamId)
    const files = await this.files.attachments(actor, fileIds)
    if (!text?.trim() && !files.length) fail('Пустой комментарий')
    if (text.length > 4000) fail('Комментарий — до 4000 символов')
    const cm = await this.db.cardComment.create({ data: { cardId, authorId: c.me.id, text: text.trim(), files: files as unknown as Prisma.InputJsonValue } })
    const pool = c.s.users.filter((u) => team.memberIds.includes(u.id))
    await this.notify.mentions(text, c.me, pool, `в ${card.key}`, `/board?card=${card.id}`, c.courseId)
    this.ctx.done(c.courseId, 'board')
    return { id: cm.id }
  }

  async checklistAdd(actor: Actor, cardId: string, text: string) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    if (!text?.trim()) fail('Пустой пункт')
    if (text.length > 300) fail('Пункт — до 300 символов')
    if (card.checklist.length >= 20) fail('В чек-листе не больше 20 пунктов')
    const item = { id: `ck_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: text.trim(), done: false }
    await this.db.card.update({ where: { id: cardId }, data: { checklist: [...card.checklist, item] as unknown as Prisma.InputJsonValue } })
    this.ctx.done(c.courseId, 'board')
    return item
  }

  async checklistToggle(actor: Actor, cardId: string, itemId: string) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    const it = must(card.checklist.find((x) => x.id === itemId), 'Пункт не найден')
    const list = card.checklist.map((x) => (x.id === itemId ? { ...x, done: !x.done } : x))
    await this.db.$transaction([
      this.db.card.update({ where: { id: cardId }, data: { checklist: list as unknown as Prisma.InputJsonValue } }),
      this.db.historyEntry.create({ data: this.hist(cardId, card.teamId, c.me.id, 'Чек-лист', it.text, !it.done ? 'выполнено' : 'не выполнено') }),
    ])
    this.ctx.done(c.courseId, 'board')
    return { ok: true }
  }

  async checklistRemove(actor: Actor, cardId: string, itemId: string) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    const it = card.checklist.find((x) => x.id === itemId)
    if (!it) return { ok: true }
    await this.db.$transaction([
      this.db.card.update({ where: { id: cardId }, data: { checklist: card.checklist.filter((x) => x.id !== itemId) as unknown as Prisma.InputJsonValue } }),
      this.db.historyEntry.create({ data: this.hist(cardId, card.teamId, c.me.id, 'Чек-лист', it.text, 'удалён') }),
    ])
    this.ctx.done(c.courseId, 'board')
    return { ok: true }
  }

  async attach(actor: Actor, cardId: string, fileIds: string[]) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    const files = await this.files.attachments(actor, fileIds)
    if (!files.length) fail('Выберите файлы')
    if (card.files.length + files.length > 10) fail('К карточке можно прикрепить не больше 10 файлов')
    await this.db.$transaction([
      this.db.card.update({ where: { id: cardId }, data: { files: [...card.files, ...files] as unknown as Prisma.InputJsonValue } }),
      this.db.historyEntry.createMany({ data: files.map((f) => this.hist(cardId, card.teamId, c.me.id, 'Файл', '—', f.name)) }),
    ])
    this.ctx.done(c.courseId, 'board')
    return { ok: true, files }
  }

  async setCardSprint(actor: Actor, cardId: string, sprintId: string | null) {
    const c = await this.ctx.write(actor)
    const card = this.card(c, cardId)
    this.canEditBoard(c, card.teamId)
    if (!sprintId && card.column !== 'backlog') fail('Вернуть в Product Backlog можно только карточку из колонки Backlog')
    if (c.s.settings.boardMode === 'scrum' && sprintId && !card.sp) fail('Перед переносом в спринт оцените задачу в story points')
    return this.applyPatch(c, card, { sprintId })
  }

  async history(actor: Actor, cardId: string) {
    const c = await this.ctx.read(actor)
    const card = this.card(c, cardId)
    if (!isStaff(c.me) && c.me.role !== 'admin' && c.me.teamId !== card.teamId) forbid('История видна только своей команде')
    return c.s.history.filter((h) => h.cardId === cardId)
  }

  /* ───────── спринты (п. 4.3) ───────── */

  private isSM(me: User, teamId: string) {
    return isStaff(me) || (me.teamId === teamId && me.teamRole === 'Scrum Master')
  }

  async startSprint(actor: Actor, teamId: string, f: { name: string; goal: string; start: number; end: number }) {
    const c = await this.ctx.write(actor)
    const team = must(c.s.teams.find((t) => t.id === teamId), 'Команда не найдена')
    if (c.s.settings.boardMode !== 'scrum') fail('Спринты доступны только в Scrum-режиме')
    if (!this.isSM(c.me, teamId)) forbid('Открыть спринт может только Scrum Master команды')
    if (!isStaff(c.me) && isLocked(c.s, teamId)) fail(`Доска только для чтения: ${isLocked(c.s, teamId)!.reason}`)
    if (activeSprint(c.s, teamId)) fail('Активен только один спринт — сначала закройте текущий')
    if (!f.name?.trim() || !f.goal?.trim()) fail('Укажите название и цель')
    if (f.goal.length > 300) fail('Цель спринта — до 300 символов')
    if (!(f.end > f.start)) fail('Дата конца должна быть позже начала')
    const number = c.s.sprints.filter((x) => x.teamId === teamId).length + 1
    const sp = await this.db.sprint.create({
      data: { teamId, number, name: f.name.trim(), goal: f.goal.trim(), start: new Date(f.start), end: new Date(f.end), status: 'active' },
    })
    await this.audit.log(actor, c.courseId, `Открыт ${sp.name} · ${team.name}`, { objectType: 'sprint', objectId: sp.id })
    this.ctx.done(c.courseId, 'board', 'sprints')
    return { id: sp.id }
  }

  async closeSprint(actor: Actor, sprintId: string, unfinished: 'backlog' | 'next') {
    const c = await this.ctx.write(actor)
    const sp = must(c.s.sprints.find((x) => x.id === sprintId), 'Спринт не найден')
    if (!this.isSM(c.me, sp.teamId)) forbid('Закрыть спринт может только Scrum Master')
    if (sp.status !== 'active') fail('Спринт уже закрыт')
    const t = now()
    const cards = c.s.cards.filter((x) => x.sprintId === sp.id && !x.archived)
    const done = cards.filter((x) => x.column === 'done')
    const overdue = cards.filter((x) => x.deadline && ((x.closedAt && x.closedAt > x.deadline) || (!x.closedAt && x.deadline < t)))
    const report = {
      planned: cards.length,
      done: done.length,
      overdue: overdue.length,
      plannedSp: sum(cards.map((x) => x.sp ?? 0)),
      doneSp: sum(done.map((x) => x.sp ?? 0)),
    }
    const team = c.s.teams.find((x) => x.id === sp.teamId)!
    await this.db.$transaction(async (tx) => {
      await tx.sprint.update({ where: { id: sp.id }, data: { status: 'closed', closedAt: new Date(t), report } })
      let next: string | null = null
      if (unfinished === 'next') {
        const number = c.s.sprints.filter((x) => x.teamId === sp.teamId).length + 1
        const len = sp.end - sp.start
        const n = await tx.sprint.create({
          data: { teamId: sp.teamId, number, name: `Спринт ${number}`, goal: 'Цель будет уточнена на planning', start: new Date(sp.end + MIN), end: new Date(sp.end + len), status: 'active' },
        })
        next = n.id
      }
      const rest = cards.filter((x) => x.column !== 'done')
      for (const card of rest)
        await tx.card.update({ where: { id: card.id }, data: { sprintId: next, ...(next ? {} : { column: 'backlog' }) } })
      if (rest.length)
        await tx.historyEntry.createMany({ data: rest.map((card) => this.hist(card.id, card.teamId, c.me.id, 'Спринт', sp.name, next ? 'следующий спринт' : 'Backlog')) })
    })
    await this.notify.sendMany(team.memberIds, `${sp.name} закрыт. Заполните ретроспективу в течение 48 часов`, `/board?retro=${sp.id}`, 'system', c.courseId)
    await this.audit.log(actor, c.courseId, `Закрыт ${sp.name} · ${team.name}: сделано ${report.done} из ${report.planned}`, { objectType: 'sprint', objectId: sp.id, newValue: report })
    this.ctx.done(c.courseId, 'board', 'sprints')
    return { ok: true, report }
  }

  /** Sprint planning: SP на каждого участника, скорость прошлого спринта, предложение следующего SM при ротации */
  async planning(actor: Actor, teamId: string) {
    const c = await this.ctx.read(actor)
    const team = must(c.s.teams.find((t) => t.id === teamId), 'Команда не найдена')
    if (!isStaff(c.me) && c.me.role !== 'admin' && c.me.teamId !== teamId) forbid('Нет доступа к доске команды')
    const sprints = c.s.sprints.filter((x) => x.teamId === teamId)
    const current = sprints.find((x) => x.status === 'active')
    const lastClosed = [...sprints].filter((x) => x.status === 'closed').sort((a, b) => b.number - a.number)[0]
    const scope = c.s.cards.filter((x) => x.teamId === teamId && !x.archived && current && x.sprintId === current.id)
    const perMember = team.memberIds.map((id) => ({ userId: id, sp: sum(scope.filter((x) => x.assigneeId === id).map((x) => x.sp ?? 0)) }))
    let nextScrumMaster: string | null = null
    if (c.s.settings.smRotation) {
      const row = await this.db.team.findUnique({ where: { id: teamId }, select: { smHistory: true } })
      const was = new Set([...((row?.smHistory as string[]) ?? []), ...c.s.users.filter((u) => u.teamId === teamId && u.teamRole === 'Scrum Master').map((u) => u.id)])
      nextScrumMaster = team.memberIds.find((id) => !was.has(id) && c.s.users.find((u) => u.id === id)?.teamRole !== 'Team Lead') ?? null
    }
    return {
      sprintId: current?.id ?? null,
      perMember,
      totalSp: sum(perMember.map((x) => x.sp)),
      lastVelocity: lastClosed?.report?.doneSp ?? null,
      nextScrumMaster,
      wip: wipOverflow(c.s, teamId),
    }
  }

  async burndown(actor: Actor, sprintId: string) {
    const c = await this.ctx.read(actor)
    const sp = must(c.s.sprints.find((x) => x.id === sprintId), 'Спринт не найден')
    if (!isStaff(c.me) && c.me.role !== 'admin' && c.me.teamId !== sp.teamId) forbid('Нет доступа')
    const b = burndown(c.s, sp)
    return { ...b, ideal: Array.from({ length: b.days + 1 }, (_, d) => b.ideal(d)) }
  }

  /* ───────── ретроспектива ───────── */

  private retroWindow(c: Ctx, sprintId: string) {
    const sp = must(c.s.sprints.find((x) => x.id === sprintId), 'Спринт не найден')
    if (c.me.teamId !== sp.teamId) forbid('Ретроспективу заполняют участники команды')
    if (sp.status !== 'closed') fail('Ретроспектива открывается после закрытия спринта')
    if (now() - (sp.closedAt ?? sp.end) > 48 * HOUR) fail('Ретроспективу можно заполнить в течение 48 часов после закрытия спринта')
    return sp
  }

  private async retroId(sprintId: string, teamId: string) {
    const r = await this.db.retro.upsert({ where: { sprintId }, create: { sprintId, teamId }, update: {} })
    return r.id
  }

  async addRetroItem(actor: Actor, sprintId: string, col: 'good' | 'bad' | 'change', text: string) {
    const c = await this.ctx.write(actor)
    const sp = this.retroWindow(c, sprintId)
    if (!['good', 'bad', 'change'].includes(col)) fail('Неизвестная колонка ретроспективы')
    if (!text?.trim()) fail('Пустой пункт')
    if (text.length > 1000) fail('Пункт — до 1000 символов')
    const retroId = await this.retroId(sprintId, sp.teamId)
    const item = await this.db.retroItem.create({ data: { retroId, authorId: c.me.id, col, text: text.trim() } })
    this.ctx.done(c.courseId, 'retro')
    return { id: item.id }
  }

  /** Оценка вклада коллег 1–5 — видна только преподавателю */
  async rateTeammates(actor: Actor, sprintId: string, ratings: Record<string, number>) {
    const c = await this.ctx.write(actor)
    const sp = this.retroWindow(c, sprintId)
    const team = c.s.teams.find((t) => t.id === sp.teamId)!
    const rows = Object.entries(ratings ?? {}).filter(([, v]) => Number.isInteger(v) && v >= 1 && v <= 5)
    for (const [to] of rows) {
      if (to === c.me.id) fail('Себя оценивать нельзя')
      if (!team.memberIds.includes(to)) fail('Оценивать можно только участников своей команды')
    }
    const retroId = await this.retroId(sprintId, sp.teamId)
    await this.db.$transaction([
      this.db.retroRating.deleteMany({ where: { retroId, fromId: c.me.id } }),
      this.db.retroRating.createMany({ data: rows.map(([to, score]) => ({ retroId, fromId: c.me.id, toId: to, score })) }),
    ])
    this.ctx.done(c.courseId, 'retro')
    return { ok: true }
  }
}
