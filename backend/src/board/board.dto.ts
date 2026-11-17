import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import type { Column, Priority } from '../domain/types'

export class CardFieldsDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string
  @IsOptional() @IsString() description?: string
  /** id участника команды или null */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() assigneeId?: string | null
  /** дедлайн, мс от эпохи, или null */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() deadline?: number | null
  @IsOptional() @IsIn(['low', 'mid', 'high']) priority?: Priority
  /** 1, 2, 3, 5, 8, 13 или null */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() sp?: number | null
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[]
}

export class CreateCardDto extends CardFieldsDto {
  @IsString() @MaxLength(120) override title!: string
  /** сразу добавить в активный спринт */
  @IsOptional() @IsBoolean() inSprint?: boolean
}

export class MoveCardDto {
  @IsIn(['backlog', 'todo', 'progress', 'review', 'done']) to!: Column
  /** обязателен при возврате из Review */
  @IsOptional() @IsString() @MaxLength(4000) comment?: string
}

export class CommentDto {
  @IsString() @MaxLength(4000) text!: string
  @IsOptional() @IsArray() @IsString({ each: true }) fileIds?: string[]
}

export class TextDto {
  @IsString() @MaxLength(4000) text!: string
}

export class FileIdsDto {
  @IsArray() @IsString({ each: true }) fileIds!: string[]
}

export class CardSprintDto {
  @ValidateIf((_, v) => v !== null) @IsString() sprintId!: string | null
}

export class StartSprintDto {
  @IsString() @MaxLength(100) name!: string
  @IsString() @MaxLength(300) goal!: string
  @IsNumber() start!: number
  @IsNumber() end!: number
}

export class CloseSprintDto {
  /** куда деть незавершённые карточки */
  @IsIn(['backlog', 'next']) unfinished!: 'backlog' | 'next'
}

export class RetroItemDto {
  @IsIn(['good', 'bad', 'change']) col!: 'good' | 'bad' | 'change'
  @IsString() @MaxLength(1000) text!: string
}

export class RatingsDto {
  /** { userId: 1..5 } */
  @IsObject() ratings!: Record<string, number>
}
