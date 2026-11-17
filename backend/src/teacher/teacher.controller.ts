import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import type { Course, CourseSettings } from '../domain/types'
import { TeacherService, type PeriodQuery } from './teacher.service'

class LockDto {
  @IsIn(['all', 'team', 'assignment']) scope!: 'all' | 'team' | 'assignment'
  @IsOptional() @IsString() targetId?: string
  @IsString() @MaxLength(500) reason!: string
  /** момент включения, мс; в будущем — блокировка по расписанию */
  @IsOptional() @IsNumber() from?: number
}
class SettingsDto {
  @IsObject() settings!: Partial<CourseSettings>
  @IsOptional() @IsObject() course?: Partial<Pick<Course, 'name' | 'stream' | 'start' | 'weeks'>>
}

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v))

@ApiTags('teacher')
@Controller()
export class TeacherController {
  constructor(private readonly svc: TeacherService) {}

  @Post('locks')
  addLock(@Me() me: Actor, @Body() dto: LockDto) {
    return this.svc.addLock(me, dto.scope, dto.targetId, dto.reason, dto.from ?? Date.now())
  }

  @Delete('locks/:id')
  cancelLock(@Me() me: Actor, @Param('id') id: string) {
    return this.svc.cancelLock(me, id)
  }

  @Get('analytics/signals')
  signals(@Me() me: Actor) {
    return this.svc.signals(me)
  }

  @Post('analytics/signals/:id/dismiss')
  dismiss(@Me() me: Actor, @Param('id') id: string) {
    return this.svc.dismissSignal(me, id)
  }

  /**
   * Метрики: scope=course|team|student, id, period=week|sprint|stage|all|custom,
   * week=N, sprintId=, stage=1|2, from/to (мс) для custom
   */
  @Get('analytics/metrics')
  metrics(
    @Me() me: Actor,
    @Query('scope') scope: 'course' | 'team' | 'student' = 'course',
    @Query('id') id?: string,
    @Query('period') period?: PeriodQuery['period'],
    @Query('week') week?: string,
    @Query('sprintId') sprintId?: string,
    @Query('stage') stage?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.metrics(me, scope, id, { period, week: num(week), sprintId, stage: num(stage) as 1 | 2 | undefined, from: num(from), to: num(to) })
  }

  @Put('course/settings')
  settings(@Me() me: Actor, @Body() dto: SettingsDto) {
    return this.svc.updateSettings(me, dto.settings, dto.course)
  }

  @Get('course/invite-code')
  inviteCode(@Me() me: Actor) {
    return this.svc.inviteCode(me)
  }

  @Post('course/invite-code')
  regenerateInvite(@Me() me: Actor) {
    return this.svc.regenerateInvite(me)
  }

  @Get('audit')
  audit(@Me() me: Actor, @Query('before') before?: string, @Query('limit') limit?: string, @Query('userId') userId?: string, @Query('q') q?: string) {
    return this.svc.auditLog(me, { before: num(before), limit: num(limit), userId, text: q })
  }
}
