import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { HeadBucketCommand } from '@aws-sdk/client-s3'
import ExcelJS from 'exceljs'
import { PrismaService } from '../common/prisma.service'
import { AuditService } from '../common/audit.service'
import { StateService, DEFAULT_SETTINGS } from '../state/state.service'
import { SessionService } from '../auth/session.service'
import { FilesService } from '../files/files.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { BackupService } from './backup.service'
import { config } from '../common/config'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { AdminSettings, SystemRole } from '../domain/types'
import { shortName } from '../domain/util'

export const ROLE_RU: Record<SystemRole, string> = { student: 'Студент', teacher: 'Преподаватель', assistant: 'Ассистент', admin: 'Администратор' }
const ROLES: SystemRole[] = ['student', 'teacher', 'assistant', 'admin']

export interface ImportRow {
  name: string
  email: string
  group: string
}

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly sessions: SessionService,
    private readonly files: FilesService,
    private readonly rt: RealtimeGateway,
    private readonly backups: BackupService,
  ) {}

  private admin(actor: Actor, msg = 'Только администратор') {
    if (actor.user.role !== 'admin') forbid(msg)
  }

  private invalidateUser(courseIds: string[]) {
    courseIds.forEach((id) => this.state.invalidate(id, ['users']))
  }

  /* ───────── пользователи и роли ───────── */

  async users(actor: Actor, q?: string, role?: string) {
    this.admin(actor)
    const rows = await this.db.user.findMany({
      where: {
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { group: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(role ? { role } : {}),
      },
      include: { enrollments: true },
      orderBy: { name: 'asc' },
      take: 1000,
    })
    return rows.map((u) => this.state.toUser(u, null))
  }

  async addUser(actor: Actor, f: { name: string; email: string; group?: string; role: SystemRole; courseId?: string }) {
    this.admin(actor)
    if (!f.name?.trim()) fail('Укажите ФИО')
    if (!ROLES.includes(f.role)) fail('Неизвестная роль')
    const { domain } = await this.state.adminSettings()
    const email = f.email?.trim().toLowerCase()
    if (!email) fail('Укажите почту')
    if (!email.endsWith('@' + domain)) fail(`Почта должна быть в домене @${domain}`)
    if (await this.db.user.findUnique({ where: { email } })) fail('Пользователь с такой почтой уже есть')
    if (f.courseId) must(await this.db.course.findUnique({ where: { id: f.courseId } }), 'Курс не найден')
    const u = await this.db.user.create({
      data: { name: f.name.trim(), email, group: f.group?.trim() ?? '', role: f.role, ...(f.courseId ? { enrollments: { create: { courseId: f.courseId } } } : {}) },
    })
    await this.audit.log(actor, f.courseId, `Добавлен пользователь ${u.name} (${ROLE_RU[f.role]})`, { objectType: 'user', objectId: u.id })
    if (f.courseId) {
      this.rt.joinCourse(u.id, f.courseId)
      this.invalidateUser([f.courseId])
    }
    return { id: u.id }
  }

  /** Роль преподавателя выдаёт администратор (п. 8) */
  async setRole(actor: Actor, userId: string, role: SystemRole) {
    this.admin(actor, 'Роли выдаёт администратор')
    if (!ROLES.includes(role)) fail('Неизвестная роль')
    const u = must(await this.db.user.findUnique({ where: { id: userId }, include: { enrollments: true } }), 'Пользователь не найден')
    if (u.id === actor.user.id) fail('Нельзя изменить свою роль')
    if (u.role === role) return { ok: true }
    await this.db.user.update({ where: { id: userId }, data: { role } })
    await this.audit.log(actor, null, `${shortName(u.name)}: ${ROLE_RU[u.role as SystemRole]} → ${ROLE_RU[role]}`, { objectType: 'user', objectId: userId, oldValue: u.role, newValue: role })
    this.invalidateUser(u.enrollments.map((e) => e.courseId))
    return { ok: true }
  }

  async toggleBlock(actor: Actor, userId: string) {
    this.admin(actor)
    const u = must(await this.db.user.findUnique({ where: { id: userId }, include: { enrollments: true } }), 'Пользователь не найден')
    if (u.id === actor.user.id) fail('Нельзя заблокировать себя')
    await this.db.user.update({ where: { id: userId }, data: { blocked: !u.blocked } })
    if (!u.blocked) await this.sessions.destroyAllFor(userId)
    await this.audit.log(actor, null, `${shortName(u.name)}: ${!u.blocked ? 'заблокирован' : 'разблокирован'}`, { objectType: 'user', objectId: userId, oldValue: u.blocked, newValue: !u.blocked })
    this.invalidateUser(u.enrollments.map((e) => e.courseId))
    return { blocked: !u.blocked }
  }

  async enroll(actor: Actor, courseId: string, userId: string) {
    await this.canManageCourse(actor, courseId)
    must(await this.db.user.findUnique({ where: { id: userId } }), 'Пользователь не найден')
    await this.db.enrollment.upsert({ where: { userId_courseId: { userId, courseId } }, create: { userId, courseId }, update: {} })
    await this.audit.log(actor, courseId, `Пользователь добавлен на курс`, { objectType: 'user', objectId: userId })
    this.rt.joinCourse(userId, courseId)
    this.invalidateUser([courseId])
    return { ok: true }
  }

  async unenroll(actor: Actor, courseId: string, userId: string) {
    await this.canManageCourse(actor, courseId)
    await this.db.enrollment.deleteMany({ where: { userId, courseId } })
    await this.audit.log(actor, courseId, `Пользователь исключён с курса`, { objectType: 'user', objectId: userId })
    this.invalidateUser([courseId])
    return { ok: true }
  }

  /* ───────── импорт студентов (CSV / Excel) ───────── */

  async parseFile(file: Express.Multer.File): Promise<ImportRow[]> {
    if (!file) fail('Файл не передан')
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').toLowerCase()
    let table: string[][] = []
    if (name.endsWith('.xlsx')) {
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer)
      const ws = wb.worksheets[0]
      ws?.eachRow((row) => table.push((row.values as unknown[]).slice(1).map((v) => String((v as { text?: string })?.text ?? v ?? '').trim())))
    } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = file.buffer.toString('utf8').replace(/^﻿/, '')
      const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) >= (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
      table = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => this.csvLine(l, sep))
    } else fail('Поддерживаются файлы .csv и .xlsx')
    if (!table.length) fail('Файл пустой')
    // заголовок: ФИО / Name, Почта / Email, Группа / Group
    const head = table[0].map((h) => h.toLowerCase())
    const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)))
    let iName = find('фио', 'name', 'имя')
    let iEmail = find('почт', 'mail', 'e-mail')
    let iGroup = find('групп', 'group')
    let rows = table.slice(1)
    if (iEmail < 0) {
      // без заголовка: ФИО; почта; группа
      ;[iName, iEmail, iGroup] = [0, 1, 2]
      rows = table
    }
    return rows.map((r) => ({ name: r[iName] ?? '', email: r[iEmail] ?? '', group: iGroup >= 0 ? r[iGroup] ?? '' : '' })).filter((r) => r.name || r.email)
  }

  private csvLine(line: string, sep: string) {
    const out: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++
        else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === sep) out.push(cur.trim()), (cur = '')
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }

  /** Студенты попадают на курс по списку (п. 8). Уже существующие пользователи — зачисляются */
  async importUsers(actor: Actor, rows: ImportRow[], courseId: string, fileName: string) {
    await this.canManageCourse(actor, courseId)
    const { domain } = await this.state.adminSettings()
    const report = { added: 0, enrolled: 0, skipped: [] as { row: number; reason: string }[] }
    for (const [i, r] of rows.entries()) {
      const email = r.email.trim().toLowerCase()
      if (!r.name.trim()) {
        report.skipped.push({ row: i + 1, reason: 'нет ФИО' })
        continue
      }
      if (!/^\S+@\S+$/.test(email) || !email.endsWith('@' + domain)) {
        report.skipped.push({ row: i + 1, reason: `почта не в домене @${domain}` })
        continue
      }
      const existing = await this.db.user.findUnique({ where: { email }, include: { enrollments: true } })
      if (existing) {
        if (existing.enrollments.some((e) => e.courseId === courseId)) {
          report.skipped.push({ row: i + 1, reason: 'уже на курсе' })
          continue
        }
        await this.db.enrollment.create({ data: { userId: existing.id, courseId } })
        report.enrolled++
        continue
      }
      await this.db.user.create({ data: { name: r.name.trim(), email, group: r.group?.trim() ?? '', role: 'student', enrollments: { create: { courseId } } } })
      report.added++
    }
    await this.audit.log(actor, courseId, `Импорт ${report.added} студентов из ${fileName}${report.enrolled ? `, зачислено существующих: ${report.enrolled}` : ''}`, { objectType: 'course', objectId: courseId })
    this.invalidateUser([courseId])
    if (!report.added && !report.enrolled) fail(`Не найдено новых студентов с почтой @${domain}`)
    return report
  }

  /* ───────── курсы ───────── */

  private async canManageCourse(actor: Actor, courseId: string) {
    const course = must(await this.db.course.findUnique({ where: { id: courseId } }), 'Курс не найден')
    if (actor.user.role === 'admin') return course
    if (actor.user.role === 'teacher' && actor.user.courseIds.includes(courseId)) return course
    forbid('Управлять курсом может администратор или преподаватель курса')
    return course
  }

  async courses(actor: Actor) {
    const rows = await this.db.course.findMany({
      where: actor.user.role === 'admin' ? {} : { enrollments: { some: { userId: actor.user.id } } },
      include: { _count: { select: { enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((c) => ({ ...this.state.toCourse(c, c._count.enrollments), inviteCode: actor.user.role === 'student' ? undefined : c.inviteCode }))
  }

  /** Создание курса: каналы «общий» и «объявления» создаются сразу (п. 5) */
  async createCourse(actor: Actor, f: { name: string; stream: string; start: number; weeks?: number; teacherId: string }) {
    if (actor.user.role !== 'admin' && actor.user.role !== 'teacher') forbid('Создать курс может преподаватель или администратор')
    if (!f.name?.trim() || !f.stream?.trim()) fail('Укажите название и поток')
    const teacherId = actor.user.role === 'teacher' ? actor.user.id : f.teacherId
    const teacher = must(await this.db.user.findUnique({ where: { id: teacherId } }), 'Преподаватель не найден')
    if (teacher.role !== 'teacher') fail('Выбранный пользователь — не преподаватель')
    const code = Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()
    const course = await this.db.course.create({
      data: {
        name: f.name.trim(),
        stream: f.stream.trim(),
        start: new Date(f.start),
        weeks: f.weeks ?? 15,
        teacherId,
        settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
        inviteCode: code,
        enrollments: { create: [{ userId: teacherId }] },
        channels: { create: [{ kind: 'general', name: 'общий' }, { kind: 'announcements', name: 'объявления' }] },
      },
    })
    await this.audit.log(actor, course.id, `Создан курс ${course.name} · ${course.stream}`, { objectType: 'course', objectId: course.id })
    this.rt.joinCourse(teacherId, course.id)
    return { id: course.id, inviteCode: code }
  }

  /** Закрытый курс переходит в архив «только чтение»; данные хранятся не менее года (п. 8) */
  async updateCourse(actor: Actor, id: string, f: { status?: 'active' | 'archive'; keepUntil?: string; teacherId?: string; name?: string; stream?: string }) {
    const course = await this.canManageCourse(actor, id)
    const data: Prisma.CourseUpdateInput = {}
    if (f.status) {
      data.status = f.status
      if (f.status === 'archive' && !f.keepUntil && !course.keepUntil) {
        const d = new Date(Date.now() + 366 * 86_400_000)
        data.keepUntil = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
      }
    }
    if (f.keepUntil) data.keepUntil = f.keepUntil
    if (f.name) data.name = f.name.trim()
    if (f.stream) data.stream = f.stream.trim()
    if (f.teacherId) {
      this.admin(actor, 'Сменить преподавателя курса может администратор')
      const t = must(await this.db.user.findUnique({ where: { id: f.teacherId } }), 'Преподаватель не найден')
      if (t.role !== 'teacher') fail('Выбранный пользователь — не преподаватель')
      data.teacherId = t.id
      await this.db.enrollment.upsert({ where: { userId_courseId: { userId: t.id, courseId: id } }, create: { userId: t.id, courseId: id }, update: {} })
    }
    await this.db.course.update({ where: { id }, data })
    await this.audit.log(actor, id, `Курс ${course.name} · ${course.stream}: ${f.status === 'archive' ? 'переведён в архив' : f.status === 'active' ? 'восстановлен из архива' : 'изменён'}`, { objectType: 'course', objectId: id, newValue: f })
    this.state.invalidate(id, ['course'])
    return { ok: true }
  }

  /* ───────── вход, система ───────── */

  async updateSettings(actor: Actor, patch: Partial<AdminSettings>) {
    this.admin(actor)
    const cur = await this.state.adminSettings()
    const next: AdminSettings = { ...cur, ...patch, lastBackup: cur.lastBackup }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(next.domain)) fail('Некорректный домен')
    if (!(next.sessionHours >= 1 && next.sessionHours <= 72)) fail('Время сессии — от 1 до 72 часов')
    await this.db.systemSettings.upsert({ where: { id: 1 }, create: { id: 1, data: next as unknown as Prisma.InputJsonValue }, update: { data: next as unknown as Prisma.InputJsonValue } })
    await this.audit.log(actor, null, `Изменены настройки входа: ${Object.keys(patch).join(', ')}`, { objectType: 'system', oldValue: cur, newValue: patch })
    this.state.invalidateAll()
    return next
  }

  async backupNow(actor: Actor) {
    this.admin(actor)
    const r = await this.backups.run('manual')
    this.state.invalidateAll()
    return r
  }

  async backupsList(actor: Actor) {
    this.admin(actor)
    return this.backups.list()
  }

  async health(actor: Actor) {
    this.admin(actor)
    const t0 = Date.now()
    let dbOk = true
    try {
      await this.db.$queryRaw`SELECT 1`
    } catch {
      dbOk = false
    }
    const dbMs = Date.now() - t0
    let storageOk = true
    try {
      await this.files.s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }))
    } catch {
      storageOk = false
    }
    const [users, online, courses, files, admin] = await Promise.all([
      this.db.user.count(),
      this.db.session.count({ where: { lastSeenAt: { gt: new Date(Date.now() - 5 * 60_000) } } }),
      this.db.course.count({ where: { status: 'active' } }),
      this.db.fileObject.aggregate({ _sum: { size: true }, _count: true }),
      this.state.adminSettings(),
    ])
    return {
      database: { ok: dbOk, latencyMs: dbMs },
      storage: { ok: storageOk, files: files._count, bytes: files._sum.size ?? 0 },
      antivirus: { enabled: !!config.clamav.host },
      email: { enabled: !!config.smtp.host },
      users,
      online,
      activeCourses: courses,
      lastBackup: admin.lastBackup,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    }
  }
}
