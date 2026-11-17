import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { memoryStorage } from 'multer'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import type { TeamRole } from '../domain/types'
import { ProfileService } from './profile.service'

class LinkDto {
  @IsString() @MaxLength(40) label!: string
  @IsString() @MaxLength(500) url!: string
}
class ProfileDto {
  @IsString() @MaxLength(500) about!: string
  @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) skills!: string[]
  @IsArray() @ArrayMaxSize(2) @IsString({ each: true }) wantedRoles!: TeamRole[]
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => LinkDto) links!: LinkDto[]
}
class AdjustDto {
  @IsString() studentId!: string
  @IsIn(['A', 'K', 'P']) component!: 'A' | 'K' | 'P'
  @IsNumber() delta!: number
  @IsString() @MaxLength(1000) reason!: string
}
class ProjectScoreDto {
  @IsNumber() score!: number
}
class ProjectAdjustDto {
  /** процент −20…+20 */
  @IsNumber() pct!: number
  @IsString() @MaxLength(1000) reason!: string
}
class BadgeDto {
  @IsString() userId!: string
  @IsString() key!: string
}
class ReadDto {
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[]
}

@ApiTags('profile')
@Controller()
export class ProfileController {
  constructor(private readonly svc: ProfileService) {}

  @Put('profile')
  update(@Me() me: Actor, @Body() dto: ProfileDto) {
    return this.svc.update(me, dto)
  }

  /** Фото профиля: JPG/PNG до 5 МБ */
  @Post('profile/photo')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 + 1 } }))
  photo(@Me() me: Actor, @UploadedFile() file: Express.Multer.File) {
    return this.svc.uploadPhoto(me, file)
  }

  @Delete('profile/photo')
  removePhoto(@Me() me: Actor) {
    return this.svc.removePhoto(me)
  }

  /** Поиск профилей: ?q=имя&skill=&role=&sort=rating|name&freeOnly=1 */
  @Get('users')
  search(@Me() me: Actor, @Query('q') q?: string, @Query('skill') skill?: string, @Query('role') role?: string, @Query('sort') sort?: 'rating' | 'name', @Query('freeOnly') freeOnly?: string) {
    return this.svc.search(me, { q, skill, role, sort, freeOnly: freeOnly === '1' || freeOnly === 'true' })
  }

  @Get('users/:id/activity')
  activity(@Me() me: Actor, @Param('id') id: string) {
    return this.svc.activity(me, id)
  }

  @Get('rating')
  rating(@Me() me: Actor) {
    return this.svc.rating(me)
  }

  @Get('me/summary')
  summary(@Me() me: Actor) {
    return this.svc.summary(me)
  }

  @Post('points/adjust')
  adjust(@Me() me: Actor, @Body() dto: AdjustDto) {
    return this.svc.adjustPoints(me, dto.studentId, dto.component, dto.delta, dto.reason)
  }

  @Put('teams/:id/project-score')
  projectScore(@Me() me: Actor, @Param('id') id: string, @Body() dto: ProjectScoreDto) {
    return this.svc.setProjectScore(me, id, dto.score)
  }

  @Put('students/:id/project-adjust')
  projectAdjust(@Me() me: Actor, @Param('id') id: string, @Body() dto: ProjectAdjustDto) {
    return this.svc.setProjectAdjust(me, id, dto.pct, dto.reason)
  }

  @Get('badges')
  badges(@Me() me: Actor) {
    return this.svc.badges(me)
  }

  @Post('badges')
  grant(@Me() me: Actor, @Body() dto: BadgeDto) {
    return this.svc.grantBadge(me, dto.userId, dto.key)
  }

  @Delete('badges/:userId/:key')
  revoke(@Me() me: Actor, @Param('userId') userId: string, @Param('key') key: string) {
    return this.svc.revokeBadge(me, userId, key)
  }

  @Get('notifications')
  notifications(@Me() me: Actor) {
    return this.svc.notifications(me)
  }

  /** Отметить прочитанными: ids или все */
  @Post('notifications/read')
  read(@Me() me: Actor, @Body() dto: ReadDto) {
    return this.svc.markRead(me, dto.ids)
  }
}
