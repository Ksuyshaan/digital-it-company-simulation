import { Controller, Get, Headers } from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'
import { Me, Public } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import { StateService } from './state.service'

@ApiTags('state')
@Controller()
export class StateController {
  constructor(private readonly state: StateService) {}

  /**
   * Состояние курса в формате State фронтенда (frontend/src/types.ts), отфильтрованное по правам пользователя,
   * плюс computed — рейтинг, рейтинг команд, достижения и (для преподавателя) сигналы, посчитанные на сервере.
   * X-Course-Id — курс; X-View-As — «вид студента» для преподавателя (только чтение).
   */
  @Get('state')
  @ApiHeader({ name: 'X-Course-Id', required: false })
  @ApiHeader({ name: 'X-View-As', required: false })
  get(@Me() me: Actor, @Headers('x-view-as') viewAs?: string) {
    return this.state.view(me, viewAs || undefined)
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true, time: Date.now() }
  }
}
