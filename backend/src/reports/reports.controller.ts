import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import { ReportsService, type Format, type Report } from './reports.service'

const send = (res: Response, r: Report) => {
  res.setHeader('Content-Type', r.mime)
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`)
  res.send(r.body)
}

/** Отчёты: ?format=pdf|xlsx */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Ведомость баллов курса */
  @Get('gradebook')
  async gradebook(@Me() me: Actor, @Res() res: Response, @Query('format') format: Format = 'xlsx') {
    send(res, await this.reports.build(me, 'gradebook', undefined, format))
  }

  @Get('teams/:id')
  async team(@Me() me: Actor, @Res() res: Response, @Param('id') id: string, @Query('format') format: Format = 'xlsx') {
    send(res, await this.reports.build(me, 'team', id, format))
  }

  /** Карточка студента; студент — только свою (id = me) */
  @Get('students/:id')
  async student(@Me() me: Actor, @Res() res: Response, @Param('id') id: string, @Query('format') format: Format = 'pdf') {
    send(res, await this.reports.build(me, 'student', id === 'me' ? me.user.id : id, format))
  }

  /** История чата команды, включая удалённые и отредактированные сообщения */
  @Get('teams/:id/chat')
  async chat(@Me() me: Actor, @Res() res: Response, @Param('id') id: string, @Query('format') format: Format = 'pdf') {
    send(res, await this.reports.build(me, 'chat', id, format))
  }
}
