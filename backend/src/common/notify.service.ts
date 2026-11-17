import { Injectable, Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import { PrismaService } from './prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { config } from './config'
import type { Notification, User } from '../domain/types'
import { shortName } from '../domain/util'

type Kind = Notification['kind']

/** Виды уведомлений, которые дублируются на почту (п. 4.2, 12 ТЗ) */
const EMAIL_KINDS: Kind[] = ['assign', 'mention', 'deadline', 'review', 'grade', 'team']

@Injectable()
export class NotifyService {
  private readonly log = new Logger('Notify')
  private transport = config.smtp.host
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      })
    : null

  constructor(
    private readonly db: PrismaService,
    private readonly rt: RealtimeGateway,
  ) {}

  async send(userId: string, text: string, link: string, kind: Kind, courseId?: string | null) {
    const n = await this.db.notification.create({ data: { userId, text, link, kind, courseId: courseId ?? null } })
    this.rt.toUser(userId, 'notification', { notification: { id: n.id, userId, at: n.at.getTime(), text, link, kind } })
    if (this.transport && EMAIL_KINDS.includes(kind)) this.email(n.id, userId, text, link).catch((e) => this.log.warn(`Письмо не отправлено: ${e.message}`))
  }

  async sendMany(userIds: string[], text: string, link: string, kind: Kind, courseId?: string | null) {
    for (const id of new Set(userIds)) await this.send(id, text, link, kind, courseId)
  }

  private async email(notificationId: string, userId: string, text: string, link: string) {
    const u = await this.db.user.findUnique({ where: { id: userId } })
    if (!u || u.blocked) return
    const url = config.frontendUrl.split(',')[0].replace(/\/$/, '') + link
    await this.transport!.sendMail({
      from: config.smtp.from,
      to: u.email,
      subject: `Digital IT Company: ${text.slice(0, 80)}`,
      text: `${text}\n\nОткрыть: ${url}\n\n— Digital IT Company Simulation`,
    })
    await this.db.notification.update({ where: { id: notificationId }, data: { emailedAt: new Date() } })
  }

  /** @упоминания: «@Имя» в тексте → уведомление участникам pool (как на фронтенде) */
  async mentions(text: string, me: User, pool: User[], where: string, link: string, courseId?: string | null) {
    const lower = text.toLowerCase()
    for (const u of pool) {
      if (u.id === me.id) continue
      const first = u.name.split(' ')[0].toLowerCase()
      if (lower.includes('@' + first)) await this.send(u.id, `Вас упомянули ${where} · ${shortName(me.name)}: «${text.slice(0, 60)}»`, link, 'mention', courseId)
    }
  }
}
