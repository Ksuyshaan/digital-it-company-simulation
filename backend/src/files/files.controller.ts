import { Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { memoryStorage } from 'multer'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import { FilesService, type FileContext } from './files.service'
import { MAX_FILE } from '../domain/util'

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * Загрузить файл (multipart, поле file). Возвращает {id, name, size} — id передаётся в fileIds
   * сообщений, комментариев и карточек. teamId — для учёта квоты команды 2 ГБ.
   */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE + 1 } }))
  upload(@Me() me: Actor, @UploadedFile() file: Express.Multer.File, @Query('context') context?: FileContext, @Query('teamId') teamId?: string) {
    const ctx: FileContext = ['channel', 'card', 'submission', 'assignment', 'photo'].includes(String(context)) ? (context as FileContext) : 'other'
    return this.files.upload(me, file, { context: ctx, teamId: teamId ?? (ctx === 'channel' || ctx === 'card' ? me.user.teamId : null) })
  }

  @Get(':id')
  async download(@Me() me: Actor, @Param('id') id: string, @Res() res: Response) {
    const f = await this.files.open(me, id)
    res.setHeader('Content-Type', f.mime)
    res.setHeader('Content-Length', String(f.size))
    res.setHeader('Content-Disposition', `${f.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    f.body.pipe(res)
  }
}
