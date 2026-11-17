import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../common/prisma.service'
import { CourseContext, type Ctx } from '../common/course-context.service'
import { NotifyService } from '../common/notify.service'
import { AuditService } from '../common/audit.service'
import { FilesService } from '../files/files.service'
import { StateService } from '../state/state.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { Channel, Message, State, User } from '../domain/types'
import { isStaff } from '../domain/rules'
import { MIN, now } from '../domain/util'

export function canWrite(s: State, me: User, ch: Channel) {
  if (ch.kind === 'general') return true
  if (ch.kind === 'announcements') return isStaff(me)
  return me.teamId === ch.teamId || me.role === 'teacher'
}

export function canRead(me: User, ch: Channel) {
  if (ch.kind !== 'team') return true
  return isStaff(me) || me.role === 'admin' || me.teamId === ch.teamId
}

const toMessage = (m: Prisma.MessageGetPayload<object>): Message => ({
  id: m.id,
  channelId: m.channelId,
  authorId: m.authorId,
  text: m.text,
  at: m.at.getTime(),
  parentId: m.parentId ?? undefined,
  files: (m.files as unknown as Message['files']) ?? [],
  reactions: (m.reactions as unknown as Message['reactions']) ?? {},
  editedAt: m.editedAt?.getTime(),
  originalText: m.originalText ?? undefined,
  deletedAt: m.deletedAt?.getTime(),
})

/** Для студента: удалённое скрыто, исходный текст правок не виден (п. 5 ТЗ) */
const forStudent = (m: Message): Message | null => (m.deletedAt ? null : { ...m, originalText: undefined })

/** Каналы: общий, объявления, команды. Личных сообщений нет. Переписку видит преподаватель (п. 5 ТЗ) */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: PrismaService,
    private readonly ctx: CourseContext,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly state: StateService,
    private readonly rt: RealtimeGateway,
  ) {}

  private channel(c: Ctx, id: string) {
    return must(c.s.channels.find((x) => x.id === id), 'Канал не найден')
  }

  /** Рассылка изменения сообщения: преподавателям — полная версия, студентам — без скрытого */
  private push(c: Ctx, ch: Channel, m: Message, action: 'new' | 'update' | 'delete') {
    this.state.invalidate(c.courseId, [], false)
    const readers = c.s.users.filter((u) => canRead(u, ch))
    const staff = readers.filter((u) => u.role !== 'student').map((u) => u.id)
    const students = readers.filter((u) => u.role === 'student').map((u) => u.id)
    this.rt.toUsers(staff, 'message', { courseId: c.courseId, channelId: ch.id, action, message: m })
    const sm = forStudent(m)
    this.rt.toUsers(students, 'message', sm ? { courseId: c.courseId, channelId: ch.id, action, message: sm } : { courseId: c.courseId, channelId: ch.id, action: 'delete', message: { id: m.id } })
  }

  async list(actor: Actor, channelId: string, before?: number, limit = 100) {
    const c = await this.ctx.read(actor)
    const ch = this.channel(c, channelId)
    if (!canRead(c.me, ch)) forbid('Нет доступа к каналу')
    const rows = await this.db.message.findMany({
      where: { channelId, ...(before ? { at: { lt: new Date(before) } } : {}) },
      orderBy: { at: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    })
    const msgs = rows.reverse().map(toMessage)
    const items = c.me.role === 'student' ? (msgs.map(forStudent).filter(Boolean) as Message[]) : msgs
    return { channel: ch, notice: 'Переписку видит преподаватель', items }
  }

  async send(actor: Actor, channelId: string, text: string, parentId?: string, fileIds?: string[]) {
    const c = await this.ctx.write(actor)
    const ch = this.channel(c, channelId)
    if (!canWrite(c.s, c.me, ch)) forbid('В этот канал у вас нет прав писать')
    const files = await this.files.attachments(actor, fileIds)
    if (!text?.trim() && !files.length) fail('Пустое сообщение')
    if (text.length > 4000) fail('Сообщение — до 4000 символов')
    if (parentId) {
      const p = await this.db.message.findUnique({ where: { id: parentId } })
      if (!p || p.channelId !== channelId) fail('Ветка не найдена')
      if (p!.parentId) parentId = p!.parentId // ответы — в одну ветку
    }
    const row = await this.db.message.create({
      data: { channelId, authorId: c.me.id, text: text.trim(), parentId: parentId ?? null, files: files as unknown as Prisma.InputJsonValue },
    })
    const m = toMessage(row)
    this.push(c, ch, m, 'new')
    const pool = ch.teamId ? c.s.users.filter((u) => c.s.teams.find((t) => t.id === ch.teamId)?.memberIds.includes(u.id)) : c.s.users
    await this.notify.mentions(text, c.me, pool, `в #${ch.name}`, ch.kind === 'team' && !isStaff(c.me) ? '/chat' : `/channels/${ch.id}`, c.courseId)
    return m
  }

  async edit(actor: Actor, id: string, text: string) {
    const c = await this.ctx.write(actor)
    const row = must(await this.db.message.findUnique({ where: { id } }), 'Сообщение не найдено')
    const ch = this.channel(c, row.channelId)
    if (row.authorId !== c.me.id) forbid('Редактировать можно только свои сообщения')
    if (row.deletedAt) fail('Сообщение удалено')
    if (now() - row.at.getTime() > 15 * MIN) fail('Редактировать можно в течение 15 минут после отправки')
    if (!text?.trim()) fail('Пустое сообщение')
    if (text.length > 4000) fail('Сообщение — до 4000 символов')
    const upd = await this.db.message.update({
      where: { id },
      data: { text: text.trim(), editedAt: new Date(), originalText: row.originalText ?? row.text },
    })
    const m = toMessage(upd)
    this.push(c, ch, m, 'update')
    return m
  }

  async remove(actor: Actor, id: string) {
    const c = await this.ctx.write(actor)
    const row = must(await this.db.message.findUnique({ where: { id } }), 'Сообщение не найдено')
    const ch = this.channel(c, row.channelId)
    if (row.authorId !== c.me.id && !isStaff(c.me)) forbid('Удалять можно только свои сообщения')
    if (row.deletedAt) return { ok: true }
    const upd = await this.db.message.update({ where: { id }, data: { deletedAt: new Date(), deletedById: c.me.id } })
    if (isStaff(c.me) && row.authorId !== c.me.id) {
      const author = c.s.users.find((u) => u.id === row.authorId)?.name ?? '—'
      await this.audit.log(actor, c.courseId, `Скрыто сообщение ${author} в #${ch.name}`, { objectType: 'message', objectId: id, oldValue: row.text })
    }
    this.push(c, ch, toMessage(upd), 'delete')
    return { ok: true }
  }

  async react(actor: Actor, id: string, emoji: string) {
    const c = await this.ctx.write(actor)
    if (!emoji || emoji.length > 16) fail('Некорректная реакция')
    const m = await this.db.$transaction(async (tx) => {
      const row = must(await tx.message.findUnique({ where: { id } }), 'Сообщение не найдено')
      const ch = this.channel(c, row.channelId)
      if (!canRead(c.me, ch)) forbid('Нет доступа')
      if (row.deletedAt) fail('Сообщение удалено')
      const reactions = { ...((row.reactions as Record<string, string[]>) ?? {}) }
      const arr = reactions[emoji] ?? []
      reactions[emoji] = arr.includes(c.me.id) ? arr.filter((x) => x !== c.me.id) : [...arr, c.me.id]
      if (!reactions[emoji].length) delete reactions[emoji]
      return toMessage(await tx.message.update({ where: { id }, data: { reactions } }))
    })
    this.push(c, this.channel(c, m.channelId), m, 'update')
    return m
  }

  /** Поиск по тексту, автору и дате; преподаватель ищет по всем каналам сразу (п. 5 ТЗ) */
  async search(actor: Actor, q: { text?: string; authorId?: string; from?: number; to?: number; channelId?: string }) {
    const c = await this.ctx.read(actor)
    const readable = c.s.channels.filter((ch) => canRead(c.me, ch)).map((ch) => ch.id)
    const channelIds = q.channelId ? readable.filter((x) => x === q.channelId) : readable
    const student = c.me.role === 'student'
    const rows = await this.db.message.findMany({
      where: {
        channelId: { in: channelIds },
        ...(q.text ? { OR: [{ text: { contains: q.text, mode: 'insensitive' } }, ...(student ? [] : [{ originalText: { contains: q.text, mode: 'insensitive' as const } }])] } : {}),
        ...(q.authorId ? { authorId: q.authorId } : {}),
        ...(q.from || q.to ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
        ...(student ? { deletedAt: null } : {}),
      },
      orderBy: { at: 'desc' },
      take: 200,
    })
    const msgs = rows.map(toMessage)
    return student ? (msgs.map(forStudent).filter(Boolean) as Message[]) : msgs
  }
}
