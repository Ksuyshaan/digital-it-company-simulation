import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { memoryStorage } from 'multer'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import type { SystemRole } from '../domain/types'
import { AdminService } from './admin.service'

const ROLES = ['student', 'teacher', 'assistant', 'admin']

class AddUserDto {
  @IsString() @MaxLength(200) name!: string
  @IsString() @MaxLength(200) email!: string
  @IsOptional() @IsString() @MaxLength(50) group?: string
  @IsIn(ROLES) role!: SystemRole
  @IsOptional() @IsString() courseId?: string
}
class RoleDto {
  @IsIn(ROLES) role!: SystemRole
}
class ImportRowDto {
  @IsString() name!: string
  @IsString() email!: string
  @IsOptional() @IsString() group!: string
}
class ImportJsonDto {
  @IsString() courseId!: string
  @IsArray() @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows!: ImportRowDto[]
  @IsOptional() @IsString() fileName?: string
}
class CourseDto {
  @IsString() @MaxLength(200) name!: string
  @IsString() @MaxLength(100) stream!: string
  @IsNumber() start!: number
  @IsOptional() @IsInt() weeks?: number
  @IsString() teacherId!: string
}
class CoursePatchDto {
  @IsOptional() @IsIn(['active', 'archive']) status?: 'active' | 'archive'
  @IsOptional() @IsString() keepUntil?: string
  @IsOptional() @IsString() teacherId?: string
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() stream?: string
}
class EnrollDto {
  @IsString() userId!: string
}
class AdminSettingsDto {
  @IsOptional() @IsString() provider?: string
  @IsOptional() @IsString() domain?: string
  @IsOptional() @IsBoolean() blockOtherDomains?: boolean
  @IsOptional() @IsBoolean() inviteCodes?: boolean
  @IsOptional() @IsNumber() sessionHours?: number
}

/** Администрирование: пользователи, роли, курсы, импорт, вход, резервные копии */
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('users')
  users(@Me() me: Actor, @Query('q') q?: string, @Query('role') role?: string) {
    return this.svc.users(me, q, role)
  }

  @Post('users')
  addUser(@Me() me: Actor, @Body() dto: AddUserDto) {
    return this.svc.addUser(me, dto)
  }

  @Put('users/:id/role')
  setRole(@Me() me: Actor, @Param('id') id: string, @Body() dto: RoleDto) {
    return this.svc.setRole(me, id, dto.role)
  }

  @Post('users/:id/toggle-block')
  toggleBlock(@Me() me: Actor, @Param('id') id: string) {
    return this.svc.toggleBlock(me, id)
  }

  /** Импорт студентов из CSV/Excel (колонки: ФИО; Почта; Группа). courseId — в query */
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async importFile(@Me() me: Actor, @UploadedFile() file: Express.Multer.File, @Query('courseId') courseId: string) {
    const rows = await this.svc.parseFile(file)
    return this.svc.importUsers(me, rows, courseId, Buffer.from(file.originalname, 'latin1').toString('utf8'))
  }

  /** Импорт уже разобранных строк (например, из предпросмотра на фронтенде) */
  @Post('import/rows')
  importRows(@Me() me: Actor, @Body() dto: ImportJsonDto) {
    return this.svc.importUsers(me, dto.rows.map((r) => ({ ...r, group: r.group ?? '' })), dto.courseId, dto.fileName ?? 'списка')
  }

  @Get('courses')
  courses(@Me() me: Actor) {
    return this.svc.courses(me)
  }

  @Post('courses')
  createCourse(@Me() me: Actor, @Body() dto: CourseDto) {
    return this.svc.createCourse(me, dto)
  }

  @Patch('courses/:id')
  updateCourse(@Me() me: Actor, @Param('id') id: string, @Body() dto: CoursePatchDto) {
    return this.svc.updateCourse(me, id, dto)
  }

  @Post('courses/:id/members')
  enroll(@Me() me: Actor, @Param('id') id: string, @Body() dto: EnrollDto) {
    return this.svc.enroll(me, id, dto.userId)
  }

  @Delete('courses/:id/members/:userId')
  unenroll(@Me() me: Actor, @Param('id') id: string, @Param('userId') userId: string) {
    return this.svc.unenroll(me, id, userId)
  }

  @Put('settings')
  settings(@Me() me: Actor, @Body() dto: AdminSettingsDto) {
    return this.svc.updateSettings(me, dto)
  }

  @Post('backup')
  backup(@Me() me: Actor) {
    return this.svc.backupNow(me)
  }

  @Get('backups')
  backups(@Me() me: Actor) {
    return this.svc.backupsList(me)
  }

  @Get('health')
  health(@Me() me: Actor) {
    return this.svc.health(me)
  }
}
