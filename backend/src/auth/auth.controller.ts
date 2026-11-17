import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { Response } from 'express'
import { AuthService, LoginError } from './auth.service'
import { SessionService, SESSION_COOKIE } from './session.service'
import { Me, NoConsent, Public, clientIp, type AppRequest } from './auth.guard'
import type { Actor } from '../common/actor'
import { config } from '../common/config'

class DevLoginDto {
  @IsString() @MaxLength(200) email!: string
  @IsOptional() @IsString() @MaxLength(20) invite?: string
}
class JoinDto {
  @IsString() @MaxLength(20) code!: string
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private async setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: (await this.sessions.idleHours()) * 3600_000 * 3,
    })
  }

  /** Что показать на экране входа: провайдер, домен, доступные способы */
  @Public()
  @Get('config')
  config() {
    return this.auth.publicConfig()
  }

  /** Перенаправление на Microsoft 365 / Google Workspace. ?invite=КОД&redirect=/путь */
  @Public()
  @Get('login')
  async login(@Res() res: Response, @Query('invite') invite?: string, @Query('redirect') redirect?: string) {
    res.redirect(await this.auth.loginUrl(invite, redirect))
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: AppRequest, @Res() res: Response) {
    const front = config.frontendUrl.split(',')[0].replace(/\/$/, '')
    try {
      const { token, user, redirect } = await this.auth.callback(req.query as Record<string, string>, clientIp(req), req.headers['user-agent'])
      await this.setCookie(res, token)
      res.redirect(front + (redirect ?? (user.role === 'student' ? '/dashboard' : user.role === 'admin' ? '/admin' : '/analytics')))
    } catch (e) {
      const msg = e instanceof LoginError ? e.message : 'Не удалось войти через корпоративную почту'
      res.redirect(`${front}/login?error=${encodeURIComponent(msg)}`)
    }
  }

  /** Демо-вход по почте (AUTH_DEV_LOGIN=true). Домен и блокировка проверяются так же, как при OIDC */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @Body() dto: DevLoginDto) {
    const { token, user } = await this.auth.devLogin(dto.email, dto.invite, clientIp(req), req.headers['user-agent'])
    await this.setCookie(res, token)
    return { userId: user.id, role: user.role, token }
  }

  @NoConsent()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req.sessionToken)
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  }

  @Get('me')
  me(@Me() me: Actor) {
    return this.auth.me(me)
  }

  /** Согласие при первом входе: переписку видит преподаватель (п. 8) */
  @NoConsent()
  @Post('consent')
  @HttpCode(200)
  consent(@Me() me: Actor) {
    return this.auth.consent(me)
  }

  @Post('join')
  join(@Me() me: Actor, @Body() dto: JoinDto) {
    return this.auth.join(me, dto.code)
  }
}
