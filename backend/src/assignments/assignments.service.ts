import { Injectable } from '@nestjs/common'
import { randomInt } from 'crypto'
import { PrismaService } from '../common/prisma.service'
import { CourseContext, type Ctx } from '../common/course-context.service'
import { NotifyService } from '../common/notify.service'
import { AuditService } from '../common/audit.service'
import { FilesService } from '../files/files.service'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { Assignment, Criterion, State } from '../domain/types'
import { isLocked, isStaff, lateInfo } from '../domain/rules'
import { HOUR, fmtDateTime, now, shortName, sum } from '../domain/util'

export interface AssignmentInput {
  title: string
  description: string
  openAt: number
  deadline: number
  maxScore: number
  criteria: Criterion[]
  format: 'file' | 'link' | 'text'
  peerReview: boolean
  isControl?: boolean
  locked?: boolean
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly ctx: CourseContext,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private assignment(c: Ctx, id: string) {
    return must(c.s.assignments.find((a) => a.id === id), 'Задание не найдено')
  }

  private validate(a: AssignmentInput) {
    if (!a.title?.trim()) fail('Укажите название')
    if (!(a.deadline > a.openAt)) fail('Дедлайн должен быть позже даты открытия')
    if (!a.criteria?.length) fail('Добавьте хотя бы один критерий')
    if (a.criteria.some((c) => !c.text?.trim() || !(c.points > 0))) fail('У каждого критерия — текст и баллы больше 0')
    if (!(a.maxScore > 0)) fail('Максимальный балл больше 0')
    const total = sum(a.criteria.map((c) => c.points))
    if (Math.abs(total - a.maxScore) > 1e-9) fail(`Сумма баллов критериев (${total}) должна совпадать с максимальным баллом (${a.maxScore})`)
    if (!['file', 'link', 'text'].includes(a.format)) fail('Формат сдачи: файл, ссылка или текст')
  }

  async create(actor: Actor, a: AssignmentInput) {
    const c = await this.ctx.staff(actor, 'Создавать задания может преподаватель')
    this.validate(a)
    const row = await this.db.assignment.create({
      data: {
        courseId: c.courseId,
        title: a.title.trim(),
        description: a.description ?? '',
        openAt: new Date(a.openAt),
        deadline: new Date(a.deadline),
        maxScore: a.maxScore,
        criteria: a.criteria.map((x) => ({ text: x.text.trim(), points: x.points })),
        format: a.format,
        peerReview: !!a.peerReview,
        isControl: !!a.isControl,
        locked: !!a.locked,
      },
    })
    const students = c.s.users.filter((u) => u.role === 'student').map((u) => u.id)
    await this.notify.sendMany(students, `Новое задание: «${row.title}»`, '/assignments', 'system', c.courseId)
    await this.audit.log(actor, c.courseId, `Создано задание «${row.title}»`, { objectType: 'assignment', objectId: row.id })
    this.ctx.done(c.courseId, 'assignments')
    return { id: row.id }
  }

  async update(actor: Actor, id: string, patch: Partial<AssignmentInput>) {
    const c = await this.ctx.staff(actor, 'Изменять задания может преподаватель')
    const a = this.assignment(c, id)
    const graded = c.s.submissions.some((x) => x.assignmentId === id && x.teacherScores)
    if (graded && (patch.criteria || patch.maxScore !== undefined)) fail('Работы уже оценены — критерии и максимальный балл менять нельзя')
    const next = { ...a, ...patch } as AssignmentInput
    this.validate(next)
    await this.db.assignment.update({
      where: { id },
      data: {
        title: next.title.trim(),
        description: next.description,
        openAt: new Date(next.openAt),
        deadline: new Date(next.deadline),
        maxScore: next.maxScore,
        criteria: next.criteria.map((x) => ({ text: x.text, points: x.points })),
        format: next.format,
        peerReview: !!next.peerReview,
        isControl: !!next.isControl,
        locked: !!next.locked,
      },
    })
    await this.audit.log(actor, c.courseId, `Изменено задание «${next.title}»`, { objectType: 'assignment', objectId: id, oldValue: a, newValue: patch })
    this.ctx.done(c.courseId, 'assignments')
    return { ok: true }
  }

  /** Сдача: пересдача до дедлайна любое число раз, поздняя — со штрафом, через 72 ч закрывается (п. 3.2) */
  async submit(actor: Actor, assignmentId: string, content: string, fileId?: string) {
    const c = await this.ctx.write(actor)
    const a = this.assignment(c, assignmentId)
    if (c.me.role !== 'student') forbid('Сдавать работы могут студенты')
    if (fileId) {
      const [f] = await this.files.attachments(actor, [fileId])
      content = `${f.name} (/api/files/${f.id})`
    }
    if (!content?.trim()) fail('Добавьте ответ')
    if (content.length > 50_000) fail('Ответ слишком длинный')
    if (a.format === 'link' && !/^https?:\/\/\S+/.test(content.trim())) fail('Нужна ссылка, начинающаяся с http(s)://')
    if (a.format === 'file' && !fileId && !/\/api\/files\//.test(content)) fail('Прикрепите файл')
    if (now() < a.openAt) fail('Задание ещё не открыто')
    const lock = isLocked(c.s, undefined, a.id)
    if (lock || a.locked) fail(`Задание только для чтения${lock ? `: ${lock.reason}` : ''}`)
    const sub = c.s.submissions.find((x) => x.assignmentId === a.id && x.studentId === c.me.id)
    const info = lateInfo(a, sub, c.s)
    if (now() > info.closeAt) fail('Сдача закрыта: прошло 72 часа после дедлайна. Обратитесь к преподавателю за продлением')
    if (sub && sub.reviews.length && now() > info.deadline) fail('После назначения рецензентов пересдать работу нельзя')
    const row = await this.db.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: a.id, studentId: c.me.id } },
      create: { assignmentId: a.id, studentId: c.me.id },
      update: {},
    })
    await this.db.submissionVersion.create({ data: { submissionId: row.id, content: content.trim() } })
    this.ctx.done(c.courseId, 'assignments')
    const late = now() > info.deadline
    return { id: row.id, late, warning: late ? `Сдано после дедлайна: штраф ${c.s.settings.latePenaltyPct}% от максимального балла за каждые начатые сутки` : undefined }
  }

  async grade(actor: Actor, subId: string, scores: number[], comment: string) {
    const c = await this.ctx.staff(actor, 'Оценивает преподаватель')
    const sub = must(c.s.submissions.find((x) => x.id === subId), 'Работа не найдена')
    const a = this.assignment(c, sub.assignmentId)
    if (sub.teacherScores && c.me.role !== 'teacher') forbid('Изменить выставленную оценку может только преподаватель')
    if (!Array.isArray(scores) || scores.length !== a.criteria.length) fail('Оцените каждый критерий')
    for (const [i, cr] of a.criteria.entries()) if (!(scores[i] >= 0 && scores[i] <= cr.points)) fail(`Критерий «${cr.text}»: от 0 до ${cr.points}`)
    if (!sub.versions.length) fail('Работа не сдана')
    await this.db.submission.update({ where: { id: subId }, data: { teacherScores: scores, teacherComment: comment ?? '', gradedAt: new Date() } })
    const student = c.s.users.find((u) => u.id === sub.studentId)
    await this.notify.send(sub.studentId, `Работа «${a.title}» оценена`, '/assignments', 'grade', c.courseId)
    await this.audit.log(actor, c.courseId, `Оценка за «${a.title}» · ${student?.name ?? '—'}: ${sum(scores)} из ${a.maxScore}`, {
      objectType: 'submission', objectId: subId, oldValue: sub.teacherScores, newValue: scores,
    })
    this.ctx.done(c.courseId, 'assignments', 'rating')
    return { ok: true }
  }

  async extend(actor: Actor, assignmentId: string, studentId: string, until: number) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    const a = this.assignment(c, assignmentId)
    const student = must(c.s.users.find((u) => u.id === studentId && u.role === 'student'), 'Студент не найден')
    if (!(until > now())) fail('Новый срок должен быть в будущем')
    await this.db.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      create: { assignmentId, studentId, extensionUntil: new Date(until) },
      update: { extensionUntil: new Date(until) },
    })
    await this.notify.send(studentId, `Срок сдачи «${a.title}» продлён до ${fmtDateTime(until)}`, '/assignments', 'system', c.courseId)
    await this.audit.log(actor, c.courseId, `Продление срока «${a.title}» до ${fmtDateTime(until)} · ${student.name}`, { objectType: 'assignment', objectId: assignmentId, newValue: until })
    this.ctx.done(c.courseId, 'assignments')
    return { ok: true }
  }

  /**
   * После дедлайна каждой сданной работе случайно назначаются 2 рецензента из сдавших (не сам автор),
   * с выравниванием нагрузки. Возвращает число назначений.
   */
  async assignReviewers(s: State, a: Assignment, courseId: string): Promise<number> {
    const subs = s.submissions.filter((x) => x.assignmentId === a.id && x.versions.length)
    if (subs.length < 3) return 0
    const authors = subs.map((x) => x.studentId)
    // перемешивание Фишера — Йетса криптостойким генератором
    const shuffled = [...authors]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const load = new Map<string, number>()
    subs.forEach((sub) => sub.reviews.forEach((r) => load.set(r.reviewerId, (load.get(r.reviewerId) ?? 0) + 1)))
    const created: { submissionId: string; reviewerId: string }[] = []
    for (const sub of subs) {
      if (sub.reviews.length >= 2) continue
      const cand = shuffled
        .filter((id) => id !== sub.studentId && !sub.reviews.some((r) => r.reviewerId === id))
        .sort((x, y) => (load.get(x) ?? 0) - (load.get(y) ?? 0))
      for (const rid of cand.slice(0, 2 - sub.reviews.length)) {
        load.set(rid, (load.get(rid) ?? 0) + 1)
        created.push({ submissionId: sub.id, reviewerId: rid })
      }
    }
    if (!created.length) return 0
    await this.db.$transaction([
      this.db.review.createMany({ data: created.map((x) => ({ ...x, assignedAt: new Date() })) }),
      this.db.assignment.update({ where: { id: a.id }, data: { reviewersAt: new Date() } }),
    ])
    for (const x of created) await this.notify.send(x.reviewerId, `Вам назначена анонимная проверка работы по «${a.title}» · 48 часов`, '/assignments', 'review', courseId)
    return created.length
  }

  async runReviewAssignment(actor: Actor, assignmentId: string) {
    const c = await this.ctx.staff(actor, 'Только преподаватель')
    const a = this.assignment(c, assignmentId)
    if (!a.peerReview) fail('Для задания выключен peer-review')
    if (now() < a.deadline) fail('Рецензенты назначаются после дедлайна')
    const n = await this.assignReviewers(c.s, a, c.courseId)
    if (!n) fail('Нечего назначать: нужно минимум 3 сданные работы, или рецензенты уже назначены')
    await this.audit.log(actor, c.courseId, `Назначены рецензенты по «${a.title}»: ${n}`, { objectType: 'assignment', objectId: a.id })
    this.ctx.done(c.courseId, 'assignments')
    return { assigned: n }
  }

  private review(c: Ctx, subId: string, reviewId: string) {
    const sub = must(c.s.submissions.find((x) => x.id === subId), 'Работа не найдена')
    const r = must(sub.reviews.find((x) => x.id === reviewId), 'Рецензия не найдена')
    return { sub, r, a: this.assignment(c, sub.assignmentId) }
  }

  async submitReview(actor: Actor, subId: string, reviewId: string, scores: number[], comment: string) {
    const c = await this.ctx.write(actor)
    const { sub, r, a } = this.review(c, subId, reviewId)
    if (r.reviewerId !== c.me.id) forbid('Это не ваша проверка')
    if (r.scores) fail('Проверка уже отправлена')
    if (now() - r.assignedAt > 48 * HOUR) fail('Срок проверки (48 часов) истёк')
    if ((comment ?? '').trim().length < 100) fail(`Комментарий — не короче 100 символов (сейчас ${(comment ?? '').trim().length})`)
    if (!Array.isArray(scores) || scores.length !== a.criteria.length) fail('Оцените каждый критерий')
    for (const [i, cr] of a.criteria.entries()) if (!(scores[i] >= 0 && scores[i] <= cr.points)) fail(`Критерий «${cr.text}»: от 0 до ${cr.points}`)
    await this.db.review.update({ where: { id: reviewId }, data: { scores, comment: comment.trim(), doneAt: new Date() } })
    await this.notify.send(sub.studentId, `Вашу работу «${a.title}» проверил рецензент`, '/assignments', 'review', c.courseId)
    this.ctx.done(c.courseId, 'assignments', 'rating')
    return { ok: true }
  }

  async dispute(actor: Actor, subId: string, reviewId: string, reason: string) {
    const c = await this.ctx.write(actor)
    const { sub, r } = this.review(c, subId, reviewId)
    if (sub.studentId !== c.me.id) forbid('Оспорить может только автор работы')
    if (!r.doneAt || now() - r.doneAt > 48 * HOUR) fail('Оспорить рецензию можно в течение 48 часов')
    if (r.disputed) fail('Рецензия уже оспорена')
    if (!reason?.trim()) fail('Опишите причину')
    await this.db.review.update({ where: { id: reviewId }, data: { disputeReason: reason.trim(), disputedAt: new Date() } })
    const teachers = c.s.users.filter((u) => u.role === 'teacher').map((u) => u.id)
    await this.notify.sendMany(teachers, `Оспорена рецензия · ${shortName(c.me.name)}`, '/assignments', 'review', c.courseId)
    this.ctx.done(c.courseId, 'assignments')
    return { ok: true }
  }

  async resolve(actor: Actor, subId: string, reviewId: string, resolution: 'kept' | 'removed') {
    const c = await this.ctx.staff(actor, 'Решение принимает преподаватель')
    const { sub, r } = this.review(c, subId, reviewId)
    if (!r.disputed) fail('Спора нет')
    await this.db.review.update({ where: { id: reviewId }, data: { disputeResolution: resolution } })
    const student = c.s.users.find((u) => u.id === sub.studentId)
    await this.notify.send(sub.studentId, `Спор по рецензии рассмотрен: ${resolution === 'removed' ? 'рецензия исключена из оценки' : 'рецензия оставлена'}`, '/assignments', 'review', c.courseId)
    await this.audit.log(actor, c.courseId, `Спор по рецензии · ${student?.name ?? '—'}: ${resolution === 'removed' ? 'исключена' : 'оставлена'}`, { objectType: 'review', objectId: reviewId, newValue: resolution })
    this.ctx.done(c.courseId, 'assignments', 'rating')
    return { ok: true }
  }

  /** Просмотр сдач задания для преподавателя (с именами рецензентов) */
  async submissions(actor: Actor, assignmentId: string) {
    const c = await this.ctx.read(actor)
    if (!isStaff(c.me)) forbid('Только преподаватель')
    this.assignment(c, assignmentId)
    return c.s.submissions.filter((x) => x.assignmentId === assignmentId)
  }
}
