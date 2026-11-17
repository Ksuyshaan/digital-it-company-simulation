import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import type { TeamRole } from '../domain/types'
import { TeamsService } from './teams.service'

class OpenFormationDto {
  /** срок окна, мс; по умолчанию — воскресенье 9 недели, 23:59 */
  @IsOptional() @IsNumber() deadline?: number
}
class DeadlineDto {
  @IsNumber() deadline!: number
}
class DraftTeamDto {
  @IsString() @MaxLength(60) name!: string
  @IsString() @MaxLength(1000) idea!: string
}
class InviteDto {
  @IsString() studentId!: string
}
class AnswerDto {
  @IsBoolean() accept!: boolean
}
class RoleDto {
  @IsString() role!: TeamRole
}
class ReviewTeamDto {
  @IsIn(['approve', 'return', 'override']) decision!: 'approve' | 'return' | 'override'
  @IsOptional() @IsString() @MaxLength(2000) comment?: string
}
class NameDto {
  @IsString() @MaxLength(60) name!: string
}
class CreateTeamDto {
  @IsString() @MaxLength(60) name!: string
  @IsOptional() @IsString() @MaxLength(1000) idea?: string
}
class ReasonDto {
  @IsString() @MaxLength(2000) reason!: string
}
class MoveDto {
  /** null — исключить из команды */
  @ValidateIf((_, v) => v !== null) @IsString() teamId!: string | null
}

/** Формирование команд (п. 3.4 ТЗ) и управление составами */
@ApiTags('teams')
@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post('formation/open')
  open(@Me() me: Actor, @Body() dto: OpenFormationDto) {
    return this.teams.openFormation(me, dto.deadline)
  }

  @Put('formation/deadline')
  deadline(@Me() me: Actor, @Body() dto: DeadlineDto) {
    return this.teams.setFormationDeadline(me, dto.deadline)
  }

  @Post('formation/teams')
  createDraft(@Me() me: Actor, @Body() dto: DraftTeamDto) {
    return this.teams.createDraftTeam(me, dto.name, dto.idea)
  }

  @Post('formation/teams/:id/requests')
  request(@Me() me: Actor, @Param('id') id: string) {
    return this.teams.requestJoin(me, id)
  }

  @Post('formation/teams/:id/invites')
  invite(@Me() me: Actor, @Param('id') id: string, @Body() dto: InviteDto) {
    return this.teams.invite(me, id, dto.studentId)
  }

  @Post('formation/requests/:id/answer')
  answer(@Me() me: Actor, @Param('id') id: string, @Body() dto: AnswerDto) {
    return this.teams.answer(me, id, dto.accept)
  }

  @Delete('formation/requests/:id')
  cancel(@Me() me: Actor, @Param('id') id: string) {
    return this.teams.cancelRequest(me, id)
  }

  @Put('formation/teams/:id/roles/:studentId')
  role(@Me() me: Actor, @Param('id') id: string, @Param('studentId') studentId: string, @Body() dto: RoleDto) {
    return this.teams.setMemberRole(me, id, studentId, dto.role)
  }

  @Delete('formation/teams/:id/members/:studentId')
  removeMember(@Me() me: Actor, @Param('id') id: string, @Param('studentId') studentId: string) {
    return this.teams.removeMember(me, id, studentId)
  }

  /** Проверка правил команды с указанием нарушенного */
  @Get('formation/teams/:id/check')
  check(@Me() me: Actor, @Param('id') id: string) {
    return this.teams.check(me, id)
  }

  @Post('formation/teams/:id/submit')
  submit(@Me() me: Actor, @Param('id') id: string) {
    return this.teams.submit(me, id)
  }

  @Post('formation/teams/:id/review')
  review(@Me() me: Actor, @Param('id') id: string, @Body() dto: ReviewTeamDto) {
    return this.teams.review(me, id, dto.decision, dto.comment)
  }

  @Post('formation/auto-distribute')
  auto(@Me() me: Actor) {
    return this.teams.autoDistribute(me)
  }

  @Post('formation/freeze')
  freeze(@Me() me: Actor) {
    return this.teams.freeze(me)
  }

  @Post('teams')
  create(@Me() me: Actor, @Body() dto: CreateTeamDto) {
    return this.teams.createTeam(me, dto.name, dto.idea ?? '')
  }

  @Patch('teams/:id')
  rename(@Me() me: Actor, @Param('id') id: string, @Body() dto: NameDto) {
    return this.teams.rename(me, id, dto.name)
  }

  @Post('teams/:id/disband')
  disband(@Me() me: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.teams.disband(me, id, dto.reason)
  }

  @Put('students/:id/team')
  move(@Me() me: Actor, @Param('id') id: string, @Body() dto: MoveDto) {
    return this.teams.moveStudent(me, id, dto.teamId)
  }

  @Put('students/:id/team-role')
  setRole(@Me() me: Actor, @Param('id') id: string, @Body() dto: RoleDto) {
    return this.teams.setTeamRole(me, id, dto.role)
  }
}
