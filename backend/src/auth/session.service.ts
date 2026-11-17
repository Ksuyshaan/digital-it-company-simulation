import { Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { PrismaService } from '../common/prisma.service'

export const SESSION_COOKIE = 'dits_session'
const hash = (t: string) => createHash('sha256').update(t).digest('hex')

/**
 * Серверные сессии: в БД хранится только хэш токена.
 * Сессия закрывается после N часов бездействия (по умолчанию 8, п. 8 ТЗ; настраивается администратором).
 */
@Injectable()
export class SessionService {
  private idleHoursCache: { v: number; at: number } | null = null

  constructor(private readonly db: PrismaService) {}

  async idleHours() {
    if (this.idleHoursCache && Date.now() - this.idleHoursCache.at < 60_000) return this.idleHoursCache.v
    const row = await this.db.systemSettings.findUnique({ where: { id: 1 } })
    const v = Number((row?.data as { sessionHours?: number } | null)?.sessionHours ?? 8) || 8
    this.idleHoursCache = { v, at: Date.now() }
    return v
  }

  async create(userId: string, ip?: string, userAgent?: string) {
    const token = randomBytes(32).toString('base64url')
    await this.db.session.create({ data: { id: hash(token), userId, ip, userAgent: userAgent?.slice(0, 300) } })
    return token
  }

  /** Найти живую сессию по токену; продлевает её (скользящее окно бездействия) */
  async resolve(token: string | undefined) {
    if (!token) return null
    const id = hash(token)
    const s = await this.db.session.findUnique({ where: { id }, include: { user: { include: { enrollments: true } } } })
    if (!s) return null
    const idleMs = (await this.idleHours()) * 3600_000
    if (Date.now() - s.lastSeenAt.getTime() > idleMs) {
      await this.db.session.delete({ where: { id } }).catch(() => undefined)
      return null
    }
    if (Date.now() - s.lastSeenAt.getTime() > 60_000) await this.db.session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => undefined)
    return s
  }

  async destroy(token: string | undefined) {
    if (!token) return
    await this.db.session.delete({ where: { id: hash(token) } }).catch(() => undefined)
  }

  async destroyAllFor(userId: string) {
    await this.db.session.deleteMany({ where: { userId } })
  }

  async cleanup() {
    const idleMs = (await this.idleHours()) * 3600_000
    await this.db.session.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - idleMs) } } })
  }
}

/** Достаёт токен из cookie или заголовка Authorization: Bearer */
export function tokenFrom(cookieHeader: string | undefined, authHeader: string | undefined, cookies?: Record<string, string>) {
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim()
  if (cookies?.[SESSION_COOKIE]) return cookies[SESSION_COOKIE]
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='))
  }
  return undefined
}
