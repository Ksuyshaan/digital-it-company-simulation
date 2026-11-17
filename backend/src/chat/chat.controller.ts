import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import { ChatService } from './chat.service'

class SendDto {
  @IsString() @MaxLength(4000) text!: string
  /** id сообщения-родителя — ответ в ветке */
  @IsOptional() @IsString() parentId?: string
  @IsOptional() @IsArray() @IsString({ each: true }) fileIds?: string[]
}
class EditDto {
  @IsString() @MaxLength(4000) text!: string
}
class ReactDto {
  @IsString() @MaxLength(16) emoji!: string
}

@ApiTags('chat')
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('channels/:id/messages')
  list(@Me() me: Actor, @Param('id') id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.chat.list(me, id, before ? Number(before) : undefined, limit ? Number(limit) : undefined)
  }

  @Post('channels/:id/messages')
  send(@Me() me: Actor, @Param('id') id: string, @Body() dto: SendDto) {
    return this.chat.send(me, id, dto.text, dto.parentId, dto.fileIds)
  }

  @Patch('messages/:id')
  edit(@Me() me: Actor, @Param('id') id: string, @Body() dto: EditDto) {
    return this.chat.edit(me, id, dto.text)
  }

  @Delete('messages/:id')
  remove(@Me() me: Actor, @Param('id') id: string) {
    return this.chat.remove(me, id)
  }

  @Post('messages/:id/reactions')
  react(@Me() me: Actor, @Param('id') id: string, @Body() dto: ReactDto) {
    return this.chat.react(me, id, dto.emoji)
  }

  /** Поиск: ?q=текст&authorId=&from=мс&to=мс&channelId= */
  @Get('messages/search')
  search(@Me() me: Actor, @Query('q') q?: string, @Query('authorId') authorId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('channelId') channelId?: string) {
    return this.chat.search(me, { text: q, authorId, from: from ? Number(from) : undefined, to: to ? Number(to) : undefined, channelId })
  }
}
