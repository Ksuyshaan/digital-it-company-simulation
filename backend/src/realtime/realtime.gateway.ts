import { Logger } from '@nestjs/common'
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import { SessionService, tokenFrom } from '../auth/session.service'
import { config } from '../common/config'

/**
 * Realtime: новые сообщения и изменения доски приходят без перезагрузки (п. 5 ТЗ, задержка ≤ 3 с).
 * Клиент подключается к socket.io с cookie сессии (или auth.token) и попадает в комнаты:
 *   user:{id} — личные уведомления; course:{id} — события курса.
 * События: `changed` {topics} — данные курса изменились, нужно перезапросить /api/state (или нужный раздел);
 *          `message` {channelId, message} — новое сообщение в доступном канале;
 *          `notification` {notification} — новое уведомление пользователю.
 */
@WebSocketGateway({ cors: { origin: config.frontendUrl.split(','), credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server
  private readonly log = new Logger('Realtime')

  constructor(private readonly sessions: SessionService) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? tokenFrom(client.handshake.headers.cookie, client.handshake.headers.authorization)
      const s = await this.sessions.resolve(token)
      if (!s || s.user.blocked) {
        client.emit('error', { message: 'Требуется вход' })
        client.disconnect(true)
        return
      }
      client.data.userId = s.userId
      client.data.role = s.user.role
      await client.join(`user:${s.userId}`)
      for (const e of s.user.enrollments) await client.join(`course:${e.courseId}`)
      if (s.user.role === 'admin') await client.join('admin')
    } catch (e) {
      this.log.warn(`Ошибка подключения: ${(e as Error).message}`)
      client.disconnect(true)
    }
  }

  toCourse(courseId: string, event: string, payload: unknown) {
    this.server?.to(`course:${courseId}`).emit(event, { courseId, ...(payload as object) })
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload)
  }

  toUsers(userIds: string[], event: string, payload: unknown) {
    if (!userIds.length || !this.server) return
    this.server.to(userIds.map((id) => `user:${id}`)).emit(event, payload)
  }

  /** Подписать уже подключённые сокеты пользователя на новый курс (после зачисления) */
  joinCourse(userId: string, courseId: string) {
    this.server?.in(`user:${userId}`).socketsJoin(`course:${courseId}`)
  }
}
