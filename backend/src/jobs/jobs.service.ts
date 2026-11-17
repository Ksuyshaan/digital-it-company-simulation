import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../common/prisma.service'
import { StateService } from '../state/state.service'
import { NotifyService } from '../common/notify.service'
import { AuditService } from '../common/audit.service'
import { SessionService } from '../auth/session.service'
import { AssignmentsService } from '../assignments/assignments.service'
import { BackupService } from '../admin/backup.service'
import { allScores } from '../domain/rules'
import { DAY, HOUR, MIN, WEEK, fmtDateTime } from '../domain/util'

const TZ = process.env.APP_TIMEZONE ?? 'Asia/Almaty'

/** Серверное расписание: блокировки, рецензенты, напоминания, переходы этапов, снимки рейтинга, бэкапы */
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs')
  private busy = false

  constructor(
    private readonly db: PrismaService,
    private readonly state: StateService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly assignments: AssignmentsService,
    private readonly backups: BackupService,
  ) {}

  /** Каждую минуту — блокировка по расписанию срабатывает в заданную минуту (приёмка, п. 11) */
  @Cron(CronExpression.EVERY_MINUTE)
  async everyMinute() {
    if (this.busy) return
    this.busy = true
    try {
      await this.fireLocks()
      await this.reviewers()
      await this.deadlines()
      await this.formationWindow()
    } catch (e) {
      this.log.error(`Ошибка планировщика: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }

  private async fireLocks() {
    const due = await this.db.lock.findMany({ where: { cancelled: false, firedAt: null, from: { lte: new Date() } } })
    for (const l of due) {
      await this.db.lock.update({ where: { id: l.id }, data: { firedAt: new Date() } })
      await this.audit.log('system', l.courseId, `Сработала блокировка по расписанию · «${l.reason}»`, { objectType: 'lock', objectId: l.id })
      this.state.invalidate(l.courseId, ['locks', 'board'])
    }
  }

  /** После дедлайна — автоматическое назначение 2 рецензентов (п. 3.3) */
  private async reviewers() {
    const now = Date.now()
    const list = await this.db.assignment.findMany({
      where: { peerReview: true, deadline: { lte: new Date(now), gte: new Date(now - 7 * DAY) }, course: { status: 'active' } },
    })
    for (const a of list) {
      const s = await this.state.load(a.courseId)
      const sa = s.assignments.find((x) => x.id === a.id)
      if (!sa) continue
      const subs = s.submissions.filter((x) => x.assignmentId === a.id && x.versions.length)
      if (subs.length < 3 || !subs.some((x) => x.reviews.length < 2)) continue
      // поздние сдачи получают рецензентов при следующем запуске
      const n = await this.assignments.assignReviewers(s, sa, a.courseId)
      if (n) {
        await this.audit.log('system', a.courseId, `Автоматически назначены рецензенты по «${a.title}»: ${n}`, { objectType: 'assignment', objectId: a.id })
        this.state.invalidate(a.courseId, ['assignments'])
      }
    }
  }

  /** Уведомления: за 24 часа до дедлайна карточки и о просрочке (п. 4.2) */
  private async deadlines() {
    const now = new Date()
    const soon = await this.db.card.findMany({
      where: { archived: false, column: { not: 'done' }, assigneeId: { not: null }, notifiedDeadlineAt: null, deadline: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } },
      include: { team: { select: { courseId: true } } },
    })
    for (const c of soon) {
      await this.db.card.update({ where: { id: c.id }, data: { notifiedDeadlineAt: now } })
      await this.notify.send(c.assigneeId!, `Дедлайн ${c.key} «${c.title}» через 24 часа — ${fmtDateTime(c.deadline!.getTime())}`, `/board?card=${c.id}`, 'deadline', c.team.courseId)
    }
    const overdue = await this.db.card.findMany({
      where: { archived: false, column: { not: 'done' }, assigneeId: { not: null }, notifiedOverdueAt: null, deadline: { lte: now } },
      include: { team: { select: { courseId: true } } },
    })
    for (const c of overdue) {
      await this.db.card.update({ where: { id: c.id }, data: { notifiedOverdueAt: now } })
      // старые просрочки (больше суток) не спамим — только помечаем
      if (now.getTime() - c.deadline!.getTime() < DAY)
        await this.notify.send(c.assigneeId!, `Просрочена карточка ${c.key} «${c.title}»`, `/board?card=${c.id}`, 'deadline', c.team.courseId)
    }
  }

  /** Переход этапов по датам курса: окно формирования открывается в понедельник 8 недели (п. 3, 3.4) */
  private async formationWindow() {
    const now = Date.now()
    const courses = await this.db.course.findMany({ where: { status: 'active', frozenAt: null, formationOpen: false } })
    for (const c of courses) {
      const open = c.start.getTime() + 7 * WEEK
      const close = c.start.getTime() + 9 * WEEK - MIN
      if (now < open || now > close) continue
      const hasTeams = await this.db.team.count({ where: { courseId: c.id, stage: 'active' } })
      if (hasTeams) continue
      await this.db.course.update({ where: { id: c.id }, data: { formationOpen: true, formationDeadline: new Date(close) } })
      const students = await this.db.enrollment.findMany({ where: { courseId: c.id, user: { role: 'student' } }, select: { userId: true } })
      await this.notify.sendMany(students.map((x) => x.userId), `Открыто формирование команд до ${fmtDateTime(close)}`, '/teams', 'team', c.id)
      await this.audit.log('system', c.id, `Автоматически открыто окно формирования команд до ${fmtDateTime(close)}`)
      this.state.invalidate(c.id, ['teams'])
    }
    // напомнить преподавателю, что окно закрылось — пора распределить и заморозить
    const closed = await this.db.course.findMany({ where: { status: 'active', frozenAt: null, formationOpen: true, formationDeadline: { lte: new Date(now), gt: new Date(now - MIN * 2) } } })
    for (const c of closed) {
      const staff = await this.db.enrollment.findMany({ where: { courseId: c.id, user: { role: { in: ['teacher', 'assistant'] } } }, select: { userId: true } })
      await this.notify.sendMany(staff.map((x) => x.userId), 'Окно формирования команд закрыто: распределите студентов без команды и заморозьте составы', '/teacher/teams', 'team', c.id)
      this.state.invalidate(c.id, ['teams'])
    }
  }

  /** Ежедневный снимок РД — для колонки «изменение за неделю» */
  @Cron('10 0 * * *', { timeZone: TZ })
  async ratingSnapshots() {
    const courses = await this.db.course.findMany({ where: { status: 'active' } })
    for (const c of courses) {
      const s = await this.state.load(c.id)
      const sc = allScores(s)
      await this.db.ratingSnapshot.createMany({ data: [...sc.entries()].map(([userId, v]) => ({ courseId: c.id, userId, rd: v.RD })) })
      const weekAgo = new Date(Date.now() - WEEK)
      const old = await this.db.ratingSnapshot.findMany({ where: { courseId: c.id, at: { gte: new Date(weekAgo.getTime() - DAY), lte: new Date(weekAgo.getTime() + HOUR) } } })
      for (const snap of old) await this.db.enrollment.updateMany({ where: { courseId: c.id, userId: snap.userId }, data: { rdWeekAgo: snap.rd } })
      await this.db.ratingSnapshot.deleteMany({ where: { courseId: c.id, at: { lt: new Date(Date.now() - 30 * DAY) } } })
      this.state.invalidate(c.id, ['rating'])
    }
  }

  /** Ежедневное резервное копирование в 03:00 (ночью, вне учебного времени) */
  @Cron('0 3 * * *', { timeZone: TZ })
  async backup() {
    if (process.env.BACKUP_ENABLED === 'false') return
    await this.backups.run('system').catch(() => undefined)
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup() {
    await this.sessions.cleanup()
  }
}
