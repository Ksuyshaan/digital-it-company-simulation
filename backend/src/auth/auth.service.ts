import { Injectable, Logger } from '@nestjs/common'
import { Issuer, generators, type Client } from 'openid-client'
import { PrismaService } from '../common/prisma.service'
import { AuditService } from '../common/audit.service'
import { StateService } from '../state/state.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import { SessionService } from './session.service'
import { config } from '../common/config'
import { fail, forbid } from '../common/errors'
import type { Actor } from '../common/actor'

interface Pending {
  nonce: string
  verifier: string
  invite?: string
  redirect?: string
  at: number
}

export class LoginError extends Error {}

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth')
  private client: Client | null = null
  private pending = new Map<string, Pending>()

  constructor(
    private readonly db: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly rt: RealtimeGateway,
  ) {}

  get oidcEnabled() {
    return !!(config.oidc.issuer && config.oidc.clientId)
  }

  private async oidc() {
    if (this.client) return this.client
    if (!this.oidcEnabled) fail('Вход через корпоративную почту не настроен (OIDC_ISSUER, OIDC_CLIENT_ID)')
    const issuer = await Issuer.discover(config.oidc.issuer)
    this.client = new issuer.Client({
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret,
      redirect_uris: [this.redirectUri],
      response_types: ['code'],
    })
    return this.client
  }

  private get redirectUri() {
    return `${config.publicUrl.replace(/\/$/, '')}/api/auth/callback`
  }

  async publicConfig() {
    const a = await this.state.adminSettings()
    return { provider: a.provider, domain: a.domain, blockOtherDomains: a.blockOtherDomains, inviteCodes: a.inviteCodes, oidc: this.oidcEnabled, devLogin: config.devLogin }
  }

  /** Шаг 1 OIDC: адрес провайдера (Authorization Code + PKCE) */
  async loginUrl(invite?: string, redirect?: string) {
    const client = await this.oidc()
    const state = generators.state()
    const nonce = generators.nonce()
    const verifier = generators.codeVerifier()
    for (const [k, v] of this.pending) if (Date.now() - v.at > 10 * 60_000) this.pending.delete(k)
    this.pending.set(state, { nonce, verifier, invite, redirect: redirect?.startsWith('/') ? redirect : undefined, at: Date.now() })
    const { domain } = await this.state.adminSettings()
    return client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: generators.codeChallenge(verifier),
      code_challenge_method: 'S256',
      // подсказка провайдеру: корпоративный домен
      ...(config.oidc.provider === 'google' ? { hd: domain } : { domain_hint: domain }),
    })
  }

  /** Шаг 2 OIDC: обмен кода, проверка домена, поиск/создание пользователя */
  async callback(params: Record<string, string>, ip: string, ua?: string) {
    const client = await this.oidc()
    const p = this.pending.get(params.state)
    if (!p) throw new LoginError('Сеанс входа устарел, попробуйте ещё раз')
    this.pending.delete(params.state)
    const tokens = await client.callback(this.redirectUri, client.callbackParams(`/?${new URLSearchParams(params)}`), { state: params.state, nonce: p.nonce, code_verifier: p.verifier })
    const claims = tokens.claims()
    const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? '').toLowerCase()
    const name = String(claims.name ?? email.split('@')[0])
    const user = await this.resolveUser(email, name, p.invite)
    const token = await this.sessions.create(user.id, ip, ua)
    await this.audit.log({ user: { id: user.id } as Actor['user'], ip, courseId: null, sessionId: '' }, null, `Вход в систему (${config.oidc.provider})`, { objectType: 'user', objectId: user.id })
    return { token, user, redirect: p.redirect }
  }

  /** Вход по почте без провайдера — только при AUTH_DEV_LOGIN=true (демо и разработка) */
  async devLogin(email: string, invite: string | undefined, ip: string, ua?: string) {
    if (!config.devLogin) forbid('Вход по почте без провайдера отключён')
    const user = await this.resolveUser(email.trim().toLowerCase(), email.split('@')[0], invite).catch((e) => {
      if (e instanceof LoginError) fail(e.message)
      throw e
    })
    const token = await this.sessions.create(user.id, ip, ua)
    await this.audit.log({ user: { id: user.id } as Actor['user'], ip, courseId: null, sessionId: '' }, null, 'Вход в систему (демо-вход)', { objectType: 'user', objectId: user.id })
    return { token, user }
  }

  private async resolveUser(email: string, name: string, invite?: string) {
    const a = await this.state.adminSettings()
    if (!email) throw new LoginError('Провайдер не передал адрес почты')
    if (a.blockOtherDomains && !email.endsWith('@' + a.domain))
      throw new LoginError(`Вход разрешён только с корпоративной почты @${a.domain}. Адрес «${email}» отклонён.`)
    let user = await this.db.user.findUnique({ where: { email } })
    if (!user) {
      const course = invite && a.inviteCodes ? await this.db.course.findUnique({ where: { inviteCode: invite.trim().toUpperCase() } }) : null
      if (!course) throw new LoginError('Учётная запись не найдена в списках курса. Обратитесь к преподавателю или войдите по коду приглашения.')
      if (course.status === 'archive') throw new LoginError('Курс в архиве — записаться нельзя')
      user = await this.db.user.create({ data: { email, name, role: 'student', enrollments: { create: { courseId: course.id } } } })
      await this.audit.log('system', course.id, `Студент ${name} записался на курс по коду приглашения`, { objectType: 'user', objectId: user.id })
      this.state.invalidate(course.id, ['users'])
    }
    if (user.blocked) throw new LoginError('Учётная запись заблокирована администратором')
    return user
  }

  /** Записаться на ещё один курс по коду приглашения */
  async join(actor: Actor, code: string) {
    const a = await this.state.adminSettings()
    if (!a.inviteCodes) forbid('Запись по коду приглашения отключена администратором')
    const course = await this.db.course.findUnique({ where: { inviteCode: code.trim().toUpperCase() } })
    if (!course) fail('Код приглашения не найден')
    if (course!.status === 'archive') fail('Курс в архиве')
    await this.db.enrollment.upsert({ where: { userId_courseId: { userId: actor.user.id, courseId: course!.id } }, create: { userId: actor.user.id, courseId: course!.id }, update: {} })
    await this.audit.log(actor, course!.id, `${actor.user.name} записался на курс по коду приглашения`, { objectType: 'user', objectId: actor.user.id })
    this.rt.joinCourse(actor.user.id, course!.id)
    this.state.invalidate(course!.id, ['users'])
    return { courseId: course!.id }
  }

  async consent(actor: Actor) {
    await this.db.user.update({ where: { id: actor.user.id }, data: { consentAt: new Date() } })
    await this.audit.log(actor, actor.courseId, 'Согласие: переписку и работу в системе видит преподаватель', { objectType: 'user', objectId: actor.user.id })
    actor.user.courseIds.forEach((id) => this.state.invalidate(id, ['users'], false))
    return { ok: true }
  }

  async me(actor: Actor) {
    const courses = await this.db.course.findMany({
      where: actor.user.role === 'admin' ? {} : { id: { in: actor.user.courseIds } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    })
    return {
      user: actor.user,
      courseId: actor.courseId,
      courses: courses.map((c) => this.state.toCourse(c)),
      consentRequired: actor.user.role === 'student' && !actor.user.consentAt,
    }
  }
}
