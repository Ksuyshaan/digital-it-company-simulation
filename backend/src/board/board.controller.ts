import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import { BoardService } from './board.service'
import { CardFieldsDto, CardSprintDto, CloseSprintDto, CommentDto, CreateCardDto, FileIdsDto, MoveCardDto, RatingsDto, RetroItemDto, StartSprintDto, TextDto } from './board.dto'

/** Доска команды: карточки, спринты, ретроспектива (п. 4 ТЗ) */
@ApiTags('board')
@Controller()
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Post('teams/:teamId/cards')
  create(@Me() me: Actor, @Param('teamId') teamId: string, @Body() dto: CreateCardDto) {
    return this.board.createCard(me, teamId, dto)
  }

  @Patch('cards/:id')
  update(@Me() me: Actor, @Param('id') id: string, @Body() dto: CardFieldsDto) {
    return this.board.updateCard(me, id, dto)
  }

  @Post('cards/:id/move')
  move(@Me() me: Actor, @Param('id') id: string, @Body() dto: MoveCardDto) {
    return this.board.moveCard(me, id, dto.to, dto.comment)
  }

  @Post('cards/:id/archive')
  archive(@Me() me: Actor, @Param('id') id: string) {
    return this.board.archiveCard(me, id)
  }

  @Post('cards/:id/restore')
  restore(@Me() me: Actor, @Param('id') id: string) {
    return this.board.restoreCard(me, id)
  }

  @Post('cards/:id/comments')
  comment(@Me() me: Actor, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.board.comment(me, id, dto.text, dto.fileIds)
  }

  @Post('cards/:id/checklist')
  checklistAdd(@Me() me: Actor, @Param('id') id: string, @Body() dto: TextDto) {
    return this.board.checklistAdd(me, id, dto.text)
  }

  @Post('cards/:id/checklist/:itemId/toggle')
  checklistToggle(@Me() me: Actor, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.board.checklistToggle(me, id, itemId)
  }

  @Delete('cards/:id/checklist/:itemId')
  checklistRemove(@Me() me: Actor, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.board.checklistRemove(me, id, itemId)
  }

  @Post('cards/:id/files')
  attach(@Me() me: Actor, @Param('id') id: string, @Body() dto: FileIdsDto) {
    return this.board.attach(me, id, dto.fileIds)
  }

  @Put('cards/:id/sprint')
  setSprint(@Me() me: Actor, @Param('id') id: string, @Body() dto: CardSprintDto) {
    return this.board.setCardSprint(me, id, dto.sprintId)
  }

  @Get('cards/:id/history')
  history(@Me() me: Actor, @Param('id') id: string) {
    return this.board.history(me, id)
  }

  @Post('teams/:teamId/sprints')
  startSprint(@Me() me: Actor, @Param('teamId') teamId: string, @Body() dto: StartSprintDto) {
    return this.board.startSprint(me, teamId, dto)
  }

  @Post('sprints/:id/close')
  closeSprint(@Me() me: Actor, @Param('id') id: string, @Body() dto: CloseSprintDto) {
    return this.board.closeSprint(me, id, dto.unfinished)
  }

  @Get('teams/:teamId/planning')
  planning(@Me() me: Actor, @Param('teamId') teamId: string) {
    return this.board.planning(me, teamId)
  }

  @Get('sprints/:id/burndown')
  burndown(@Me() me: Actor, @Param('id') id: string) {
    return this.board.burndown(me, id)
  }

  @Post('sprints/:id/retro/items')
  retroItem(@Me() me: Actor, @Param('id') id: string, @Body() dto: RetroItemDto) {
    return this.board.addRetroItem(me, id, dto.col, dto.text)
  }

  @Put('sprints/:id/retro/ratings')
  rate(@Me() me: Actor, @Param('id') id: string, @Body() dto: RatingsDto) {
    return this.board.rateTeammates(me, id, dto.ratings)
  }
}
