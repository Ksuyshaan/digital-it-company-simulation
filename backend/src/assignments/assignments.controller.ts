import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'
import { Me } from '../auth/auth.guard'
import type { Actor } from '../common/actor'
import { AssignmentsService } from './assignments.service'

class CriterionDto {
  @IsString() @MaxLength(500) text!: string
  @IsNumber() @Min(0) points!: number
}

class AssignmentDto {
  @IsString() @MaxLength(200) title!: string
  /** форматированный текст (Markdown/HTML) */
  @IsString() description!: string
  @IsNumber() openAt!: number
  @IsNumber() deadline!: number
  @IsNumber() @Min(0) maxScore!: number
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria!: CriterionDto[]
  @IsIn(['file', 'link', 'text']) format!: 'file' | 'link' | 'text'
  @IsBoolean() peerReview!: boolean
  @IsOptional() @IsBoolean() isControl?: boolean
  @IsOptional() @IsBoolean() locked?: boolean
}

class AssignmentPatchDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsNumber() openAt?: number
  @IsOptional() @IsNumber() deadline?: number
  @IsOptional() @IsNumber() maxScore?: number
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria?: CriterionDto[]
  @IsOptional() @IsIn(['file', 'link', 'text']) format?: 'file' | 'link' | 'text'
  @IsOptional() @IsBoolean() peerReview?: boolean
  @IsOptional() @IsBoolean() isControl?: boolean
  @IsOptional() @IsBoolean() locked?: boolean
}

class SubmitDto {
  /** текст или ссылка; для формата «файл» — fileId загруженного файла */
  @IsOptional() @IsString() content?: string
  @IsOptional() @IsString() fileId?: string
}

class ScoresDto {
  @IsArray() @IsNumber({}, { each: true }) scores!: number[]
  @IsString() @MaxLength(5000) comment!: string
}

class ExtendDto {
  @IsString() studentId!: string
  @IsNumber() until!: number
}

class ReasonDto {
  @IsString() @MaxLength(2000) reason!: string
}

class ResolutionDto {
  @IsIn(['kept', 'removed']) resolution!: 'kept' | 'removed'
}

/** Индивидуальные задания и peer-review (п. 3.2–3.3 ТЗ) */
@ApiTags('assignments')
@Controller()
export class AssignmentsController {
  constructor(private readonly svc: AssignmentsService) {}

  @Post('assignments')
  create(@Me() me: Actor, @Body() dto: AssignmentDto) {
    return this.svc.create(me, dto)
  }

  @Patch('assignments/:id')
  update(@Me() me: Actor, @Param('id') id: string, @Body() dto: AssignmentPatchDto) {
    return this.svc.update(me, id, dto)
  }

  @Get('assignments/:id/submissions')
  submissions(@Me() me: Actor, @Param('id') id: string) {
    return this.svc.submissions(me, id)
  }

  @Post('assignments/:id/submit')
  submit(@Me() me: Actor, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.svc.submit(me, id, dto.content ?? '', dto.fileId)
  }

  @Post('assignments/:id/extend')
  extend(@Me() me: Actor, @Param('id') id: string, @Body() dto: ExtendDto) {
    return this.svc.extend(me, id, dto.studentId, dto.until)
  }

  @Post('assignments/:id/assign-reviewers')
  assignReviewers(@Me() me: Actor, @Param('id') id: string) {
    return this.svc.runReviewAssignment(me, id)
  }

  @Post('submissions/:id/grade')
  grade(@Me() me: Actor, @Param('id') id: string, @Body() dto: ScoresDto) {
    return this.svc.grade(me, id, dto.scores, dto.comment)
  }

  @Post('submissions/:id/reviews/:reviewId')
  review(@Me() me: Actor, @Param('id') id: string, @Param('reviewId') reviewId: string, @Body() dto: ScoresDto) {
    return this.svc.submitReview(me, id, reviewId, dto.scores, dto.comment)
  }

  @Post('submissions/:id/reviews/:reviewId/dispute')
  dispute(@Me() me: Actor, @Param('id') id: string, @Param('reviewId') reviewId: string, @Body() dto: ReasonDto) {
    return this.svc.dispute(me, id, reviewId, dto.reason)
  }

  @Post('submissions/:id/reviews/:reviewId/resolve')
  resolve(@Me() me: Actor, @Param('id') id: string, @Param('reviewId') reviewId: string, @Body() dto: ResolutionDto) {
    return this.svc.resolve(me, id, reviewId, dto.resolution)
  }
}
