import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { PrismaService } from '../common/prisma.service'
import { SessionService, tokenFrom } from './session.service'
import { StateService } from '../state/state.service'
import type { Actor } from '../common/actor'
import { config } from '../common/config'

export const PUBLIC = 'isPublic'
/** Эндпоинт доступен без входа */
export const Public = () => SetMetadata(PUBLIC, true)

const NO_CONSENT = 'noConsentRequired'
/** Эндпоинт доступен до согласия с правилами (п. 8 ТЗ) */
export const NoConsent = () => SetMetadata(NO_CONSENT, true)

export type AppRequest = Request & { actor?: Actor; sessionToken?: string }

/** Текущий пользователь запроса */
export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AppRequest>()
  return req.actor!
})

export const clientIp = (req: Request) => (String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '').replace('::ffff:', '')

/**
 * Проверка прав на сервере для каждого запроса (п. 8 ТЗ):
 * сессия → пользователь → курс (X-Course-Id) → участие в курсе.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly db: PrismaService,
    private readonly state: StateService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true
    const req = ctx.switchToHttp().getRequest<AppRequest>()
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])
    const token = tokenFrom(req.headers.cookie, req.headers.authorization, req.cookies)
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)

    // защита от CSRF: изменяющий запрос с cookie должен прийти с нашего origin
    if (mutating && !req.headers.authorization && req.headers.origin) {
      const allowed = [...config.frontendUrl.split(','), config.publicUrl].map((x) => x.trim().replace(/\/$/, ''))
      if (!allowed.includes(String(req.headers.origin).replace(/\/$/, ''))) throw new ForbiddenException('Запрос с чужого сайта отклонён')
    }

    const session = await this.sessions.resolve(token)
    if (!session) {
      if (isPublic) return true
      throw new UnauthorizedException('Сессия истекла или вы не вошли')
    }
    const u = session.user
    if (u.blocked) throw new ForbiddenException('Учётная запись заблокирована администратором')

    // курс запроса
    const wanted = String(req.headers['x-course-id'] ?? req.query.courseId ?? '') || null
    let courseId: string | null = null
    if (wanted) {
      if (u.role !== 'admin' && !u.enrollments.some((e) => e.courseId === wanted)) throw new ForbiddenException('Вы не участник этого курса')
      courseId = wanted
    } else if (u.enrollments.length) {
      const courses = await this.db.course.findMany({ where: { id: { in: u.enrollments.map((e) => e.courseId) } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] })
      courseId = courses[0]?.id ?? null
    }

    req.sessionToken = token
    req.actor = { user: this.state.toUser(u, courseId), courseId, ip: clientIp(req), sessionId: session.id }

    const noConsent = this.reflector.getAllAndOverride<boolean>(NO_CONSENT, [ctx.getHandler(), ctx.getClass()])
    if (mutating && u.role === 'student' && !u.consentAt && !noConsent && !isPublic)
      throw new ForbiddenException('Подтвердите, что знаете: переписку и работу в системе видит преподаватель')

    // «Последнее действие (не просмотра)» — п. 6 ТЗ
    if (mutating) {
      const nowD = new Date()
      req.actor.user.lastActiveAt = nowD.getTime()
      this.db.user.update({ where: { id: u.id }, data: { lastActiveAt: nowD } }).catch(() => undefined)
    }
    return true
  }
}
