import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../common/prisma.service'
import { RealtimeGateway } from '../realtime/realtime.gateway'
import type {
  AdminSettings, Assignment, Card, Channel, Course, CourseSettings, FormationState, HistoryEntry, Message, Notification, Retro, Sprint, State, Submission, Team, User,
} from '../domain/types'
import { allScores, badgesOf, computeSignals, isStaff, teamScores, type Scores } from '../domain/rules'
import type { Actor } from '../common/actor'
import { DEFAULT_ADMIN, DEFAULT_SETTINGS } from '../domain/defaults'

const ms = (d: Date | null | undefined) => (d ? d.getTime() : undefined)
const json = <T>(v: Prisma.JsonValue | null | undefined, d: T): T => (v === null || v === undefined ? d : (v as unknown as T))

export { DEFAULT_SETTINGS, DEFAULT_ADMIN }

/** Состояние для клиента: State фронтенда + то, что посчитал сервер */
export type StateView = State & {
  computed: {
    /** рейтинг (п. 3.5, 7) с учётом настройки видимости */
    scores: Record<string, Scores | Pick<Scores, 'place' | 'prevPlace'>>
    teamScores: { teamId: string; R1: number; R2: number; RD: number }[]
    badges: Record<string, string[]>
    signals?: ReturnType<typeof computeSignals>
  }
  meta: { meId: string; viewAsId?: string; serverTime: number }
}

interface CacheEntry {
  state: State
  at: number
}

/** Сколько живёт снимок курса без изменений. Рейтинг пересчитывается не реже чем раз в 5 минут (п. 3.5) */
const TTL = 60_000

@Injectable()
export class StateService {
  private readonly log = new Logger('State')
  private cache = new Map<string, CacheEntry>()
  private building = new Map<string, Promise<State>>()

  constructor(
    private readonly db: PrismaService,
    private readonly rt: RealtimeGateway,
  ) {}

  /* ───────── Снимок курса ───────── */

  async load(courseId: string): Promise<State> {
    const hit = this.cache.get(courseId)
    if (hit && Date.now() - hit.at < TTL) return hit.state
    const pending = this.building.get(courseId)
    if (pending) return pending
    const p = this.build(courseId)
      .then((state) => {
        this.cache.set(courseId, { state, at: Date.now() })
        return state
      })
      .finally(() => this.building.delete(courseId))
    this.building.set(courseId, p)
    return p
  }

  /** Сбросить снимок и сообщить клиентам курса, что данные изменились */
  invalidate(courseId: string | null | undefined, topics: string[] = [], broadcast = true) {
    if (!courseId) return
    this.cache.delete(courseId)
    if (broadcast) this.rt.toCourse(courseId, 'changed', { topics, at: Date.now() })
  }

  invalidateAll() {
    const ids = [...this.cache.keys()]
    this.cache.clear()
    ids.forEach((id) => this.rt.toCourse(id, 'changed', { topics: ['all'], at: Date.now() }))
  }

  async adminSettings(): Promise<AdminSettings> {
    const row = await this.db.systemSettings.findUnique({ where: { id: 1 } })
    return { ...DEFAULT_ADMIN(process.env.AUTH_DOMAIN ?? 'university.kz'), ...json<Partial<AdminSettings>>(row?.data, {}) }
  }

  toCourse(c: Prisma.CourseGetPayload<object>, studentsCount?: number): Course {
    return {
      id: c.id,
      name: c.name,
      stream: c.stream,
      start: c.start.getTime(),
      weeks: c.weeks,
      teacherId: c.teacherId,
      status: c.status as Course['status'],
      keepUntil: c.keepUntil ?? undefined,
      studentsCount,
    }
  }

  settingsOf(c: { settings: Prisma.JsonValue }): CourseSettings {
    return { ...DEFAULT_SETTINGS, ...json<Partial<CourseSettings>>(c.settings, {}) }
  }

  toUser(
    u: Prisma.UserGetPayload<{ include: { enrollments: true } }>,
    courseId: string | null,
  ): User {
    const en = courseId ? u.enrollments.find((e) => e.courseId === courseId) : undefined
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      group: u.group,
      role: u.role as User['role'],
      about: u.about,
      skills: json(u.skills, []),
      wantedRoles: json(u.wantedRoles, []),
      links: json(u.links, []),
      photo: u.photoFileId ? `/api/files/${u.photoFileId}` : undefined,
      teamId: en?.teamId ?? undefined,
      teamRole: (en?.teamRole as User['teamRole']) ?? undefined,
      lastActiveAt: ms(u.lastActiveAt) ?? 0,
      blocked: u.blocked || undefined,
      courseIds: u.enrollments.map((e) => e.courseId),
      profileFilledAt: ms(u.profileFilledAt),
      rdWeekAgo: en?.rdWeekAgo ?? 0,
      projectAdjust: en?.projectAdjust ?? undefined,
      consentAt: ms(u.consentAt),
    }
  }

  private async build(courseId: string): Promise<State> {
    const t0 = Date.now()
    const db = this.db
    const course = await db.course.findUniqueOrThrow({ where: { id: courseId } })
    const [admin, courses, users, teams, channels, assignments, locks, dismissed, badges, adjustments, audit, requests] = await Promise.all([
      this.adminSettings(),
      db.course.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { enrollments: true } } } }),
      db.user.findMany({ where: { enrollments: { some: { courseId } } }, include: { enrollments: true } }),
      db.team.findMany({ where: { courseId }, orderBy: { createdAt: 'asc' }, include: { members: true } }),
      db.channel.findMany({ where: { courseId } }),
      db.assignment.findMany({ where: { courseId }, orderBy: { openAt: 'asc' } }),
      db.lock.findMany({ where: { courseId } }),
      db.dismissedSignal.findMany({ where: { courseId } }),
      db.manualBadge.findMany({ where: { courseId } }),
      db.pointAdjustment.findMany({ where: { courseId }, orderBy: { at: 'desc' } }),
      db.auditEntry.findMany({ where: { courseId }, orderBy: { at: 'desc' }, take: 500 }),
      db.formationRequest.findMany({ where: { courseId } }),
    ])
    const teamIds = teams.map((t) => t.id)
    const channelIds = channels.map((c) => c.id)
    const [sprints, cards, history, messages, submissions, retros] = await Promise.all([
      db.sprint.findMany({ where: { teamId: { in: teamIds } }, orderBy: { number: 'asc' } }),
      db.card.findMany({ where: { teamId: { in: teamIds } }, include: { comments: { orderBy: { at: 'asc' } } } }),
      db.historyEntry.findMany({ where: { teamId: { in: teamIds } }, orderBy: { at: 'desc' } }),
      db.message.findMany({ where: { channelId: { in: channelIds } }, orderBy: { at: 'asc' } }),
      db.submission.findMany({
        where: { assignment: { courseId } },
        include: { versions: { orderBy: { at: 'asc' } }, reviews: { orderBy: { assignedAt: 'asc' } } },
      }),
      db.retro.findMany({ where: { teamId: { in: teamIds } }, include: { items: { orderBy: { at: 'asc' } }, ratings: true } }),
    ])

    const active = teams.filter((t) => t.stage === 'active')
    const toTeam = (t: (typeof teams)[number], memberIds: string[]): Team => ({
      id: t.id,
      name: t.name,
      idea: t.idea,
      initiatorId: t.initiatorId,
      memberIds,
      status: t.status as Team['status'],
      returnComment: t.returnComment ?? undefined,
      approvedOverride: t.approvedOverride ?? undefined,
      roles: json(t.roles, undefined),
      projectScore: t.projectScore,
      channelId: t.channelId ?? '',
    })

    const formation: FormationState | null = course.formationOpen
      ? {
          deadline: ms(course.formationDeadline) ?? Date.now(),
          teams: teams.filter((t) => t.stage === 'formation').map((t) => toTeam(t, json<string[]>(t.draftMemberIds, []))),
          requests: requests.map((r) => ({ id: r.id, teamId: r.teamId, studentId: r.studentId, kind: r.kind as 'request' | 'invite', at: r.at.getTime() })),
        }
      : null

    const state: State = {
      version: 3,
      seededAt: course.createdAt.getTime(),
      course: this.toCourse(course, users.filter((u) => u.role === 'student').length),
      courses: courses.map((c) => this.toCourse(c, c._count.enrollments)),
      settings: this.settingsOf(course),
      admin,
      users: users.map((u) => this.toUser(u, courseId)),
      teams: active.map((t) => toTeam(t, t.members.map((m) => m.userId))),
      sprints: sprints.map(
        (s): Sprint => ({
          id: s.id,
          teamId: s.teamId,
          number: s.number,
          name: s.name,
          goal: s.goal,
          start: s.start.getTime(),
          end: s.end.getTime(),
          status: s.status as Sprint['status'],
          closedAt: ms(s.closedAt),
          report: json(s.report, undefined),
        }),
      ),
      cards: cards.map(
        (c): Card => ({
          id: c.id,
          key: c.key,
          teamId: c.teamId,
          sprintId: c.sprintId,
          column: c.column as Card['column'],
          title: c.title,
          description: c.description,
          assigneeId: c.assigneeId,
          deadline: ms(c.deadline) ?? null,
          priority: c.priority as Card['priority'],
          sp: c.sp,
          labels: json(c.labels, []),
          checklist: json(c.checklist, []),
          files: json(c.files, []),
          comments: c.comments.map((m) => ({ id: m.id, authorId: m.authorId, text: m.text, at: m.at.getTime(), files: json(m.files, []) })),
          authorId: c.authorId,
          createdAt: c.createdAt.getTime(),
          startedAt: ms(c.startedAt),
          closedAt: ms(c.closedAt),
          archived: c.archived || undefined,
        }),
      ),
      history: history.map(
        (h): HistoryEntry => ({ id: h.id, cardId: h.cardId, teamId: h.teamId, userId: h.userId, at: h.at.getTime(), field: h.field, from: h.from, to: h.to, note: h.note ?? undefined }),
      ),
      channels: channels.map((c): Channel => ({ id: c.id, kind: c.kind as Channel['kind'], name: c.name, teamId: c.teamId ?? undefined })),
      messages: messages.map(
        (m): Message => ({
          id: m.id,
          channelId: m.channelId,
          authorId: m.authorId,
          text: m.text,
          at: m.at.getTime(),
          parentId: m.parentId ?? undefined,
          files: json(m.files, []),
          reactions: json(m.reactions, {}),
          editedAt: ms(m.editedAt),
          originalText: m.originalText ?? undefined,
          deletedAt: ms(m.deletedAt),
        }),
      ),
      assignments: assignments.map(
        (a): Assignment => ({
          id: a.id,
          title: a.title,
          description: a.description,
          openAt: a.openAt.getTime(),
          deadline: a.deadline.getTime(),
          maxScore: a.maxScore,
          criteria: json(a.criteria, []),
          format: a.format as Assignment['format'],
          peerReview: a.peerReview,
          isControl: a.isControl || undefined,
          locked: a.locked || undefined,
        }),
      ),
      submissions: submissions.map(
        (s): Submission => ({
          id: s.id,
          assignmentId: s.assignmentId,
          studentId: s.studentId,
          versions: s.versions.map((v) => ({ at: v.at.getTime(), content: v.content })),
          teacherScores: json(s.teacherScores, undefined),
          teacherComment: s.teacherComment ?? undefined,
          gradedAt: ms(s.gradedAt),
          extensionUntil: ms(s.extensionUntil),
          reviews: s.reviews.map((r) => ({
            id: r.id,
            reviewerId: r.reviewerId,
            scores: json(r.scores, null),
            comment: r.comment,
            assignedAt: r.assignedAt.getTime(),
            doneAt: ms(r.doneAt),
            disputed: r.disputedAt
              ? { reason: r.disputeReason ?? '', at: r.disputedAt.getTime(), resolution: (r.disputeResolution as 'kept' | 'removed' | null) ?? undefined }
              : undefined,
          })),
        }),
      ),
      retros: retros.map(
        (r): Retro => ({
          id: r.id,
          sprintId: r.sprintId,
          teamId: r.teamId,
          items: r.items.map((i) => ({ id: i.id, authorId: i.authorId, col: i.col as 'good', text: i.text, at: i.at.getTime() })),
          ratings: r.ratings.map((x) => ({ from: x.fromId, to: x.toId, score: x.score })),
        }),
      ),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        component: a.component as 'A' | 'K' | 'P',
        delta: a.delta,
        reason: a.reason,
        byId: a.byId,
        at: a.at.getTime(),
      })),
      audit: audit.map((a) => ({ id: a.id, at: a.at.getTime(), userId: a.userId, text: a.text, ip: a.ip ?? undefined })),
      notifications: [],
      locks: locks.map((l) => ({
        id: l.id,
        scope: l.scope as 'all',
        targetId: l.targetId ?? undefined,
        reason: l.reason,
        from: l.from.getTime(),
        createdBy: l.createdById,
        cancelled: l.cancelled || undefined,
      })),
      dismissedSignals: dismissed.map((d) => d.signalId),
      manualBadges: badges.map((b) => ({ userId: b.userId, key: b.key })),
      formation,
      cardSeq: Object.fromEntries(teams.map((t) => [t.id, t.cardSeq])),
    }
    this.log.debug(`Снимок курса ${courseId} собран за ${Date.now() - t0} мс`)
    return state
  }

  /* ───────── Представление для конкретного пользователя ───────── */

  async view(actor: Actor, viewAsId?: string): Promise<StateView> {
    const real = actor.user
    let courseId = actor.courseId
    if (!courseId) {
      // администратор без курса — показываем первый курс, чтобы у клиента был контекст
      const first = await this.db.course.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'asc' } })
      courseId = first?.id ?? null
    }
    if (!courseId) return this.emptyView(actor)
    const full = await this.load(courseId)

    let viewer: User = full.users.find((u) => u.id === real.id) ?? real
    if (viewAsId && viewAsId !== real.id && (isStaff(real) || real.role === 'admin')) {
      const target = full.users.find((u) => u.id === viewAsId)
      if (target) viewer = target
    }

    const notifications = await this.db.notification.findMany({ where: { userId: viewer.id }, orderBy: { at: 'desc' }, take: 100 })
    const notes: Notification[] = notifications.map((n) => ({ id: n.id, userId: n.userId, at: n.at.getTime(), text: n.text, link: n.link, kind: n.kind as Notification['kind'], read: n.read || undefined }))

    const scores = allScores(full)
    const tScores = teamScores(full).map((x) => ({ teamId: x.team.id, R1: x.R1, R2: x.R2, RD: x.RD }))
    const badges: Record<string, string[]> = {}
    for (const u of full.users) if (u.role === 'student') badges[u.id] = badgesOf(full, u)

    let s: State
    let shownScores: StateView['computed']['scores'] = Object.fromEntries(scores)
    let signals: StateView['computed']['signals']
    if (viewer.role === 'student') {
      s = this.studentView(full, viewer)
      shownScores = this.visibleScores(full, viewer, scores)
    } else {
      s = { ...full, users: full.users }
      signals = computeSignals(full)
      if (real.role === 'admin') {
        const [users, audit] = await Promise.all([
          this.db.user.findMany({ include: { enrollments: true }, orderBy: { name: 'asc' } }),
          this.db.auditEntry.findMany({ orderBy: { at: 'desc' }, take: 500 }),
        ])
        s = { ...s, users: users.map((u) => this.toUser(u, courseId)), audit: audit.map((a) => ({ id: a.id, at: a.at.getTime(), userId: a.userId, text: a.text, ip: a.ip ?? undefined })) }
      }
    }
    if (real.role !== 'admin') s = { ...s, courses: s.courses.filter((c) => real.courseIds.includes(c.id)) }

    return {
      ...s,
      notifications: notes,
      computed: { scores: shownScores, teamScores: viewer.role === 'student' && full.settings.ratingVisibility !== 'full' ? [] : tScores, badges, signals },
      meta: { meId: real.id, viewAsId: viewer.id !== real.id ? viewer.id : undefined, serverTime: Date.now() },
    }
  }

  private async emptyView(actor: Actor): Promise<StateView> {
    const admin = await this.adminSettings()
    const users = actor.user.role === 'admin' ? await this.db.user.findMany({ include: { enrollments: true } }) : []
    return {
      version: 3,
      seededAt: Date.now(),
      course: { id: '', name: '', stream: '', start: Date.now(), weeks: 15, teacherId: '', status: 'active' },
      courses: [],
      settings: DEFAULT_SETTINGS,
      admin,
      users: users.length ? users.map((u) => this.toUser(u, null)) : [actor.user],
      teams: [], sprints: [], cards: [], history: [], channels: [], messages: [], assignments: [], submissions: [], retros: [],
      adjustments: [], audit: [], notifications: [], locks: [], dismissedSignals: [], manualBadges: [], formation: null, cardSeq: {},
      computed: { scores: {}, teamScores: [], badges: {} },
      meta: { meId: actor.user.id, serverTime: Date.now() },
    }
  }

  /** Рейтинг для студента с учётом настройки «скрыть баллы / только топ-10» (п. 3.5) */
  private visibleScores(s: State, me: User, scores: Map<string, Scores>): StateView['computed']['scores'] {
    const mode = s.settings.ratingVisibility
    const res: StateView['computed']['scores'] = {}
    for (const [id, sc] of scores) {
      if (id === me.id || mode === 'full') res[id] = sc
      else if (mode === 'places') res[id] = { place: sc.place, prevPlace: sc.prevPlace }
      else if (mode === 'top10' && sc.place <= 10) res[id] = sc
    }
    return res
  }

  /**
   * Права студента (раздел 2, 3.3, 4, 5, 6 ТЗ): своя команда, свои каналы и общий, без удалённых сообщений
   * и исходного текста правок, анонимные рецензии, без оценок коллег, журнала и сигналов.
   */
  private studentView(s: State, me: User): State {
    const myTeam = me.teamId
    const readable = new Set(s.channels.filter((c) => c.kind !== 'team' || c.teamId === myTeam).map((c) => c.id))
    const myCards = s.cards.filter((c) => c.teamId === myTeam && !c.archived)

    const submissions: Submission[] = []
    for (const sub of s.submissions) {
      if (sub.studentId === me.id) {
        submissions.push({ ...sub, reviews: sub.reviews.map((r) => ({ ...r, reviewerId: 'anonymous' })) })
      } else {
        const mine = sub.reviews.filter((r) => r.reviewerId === me.id)
        if (mine.length)
          submissions.push({
            id: sub.id,
            assignmentId: sub.assignmentId,
            studentId: 'anonymous',
            versions: sub.versions.slice(-1),
            reviews: mine.map((r) => ({ ...r, disputed: r.disputed ? { reason: '', at: r.disputed.at, resolution: r.disputed.resolution } : undefined })),
          })
      }
    }

    const formation = s.formation
      ? {
          ...s.formation,
          requests: s.formation.requests.filter((r) => {
            const t = s.formation!.teams.find((x) => x.id === r.teamId)
            return r.studentId === me.id || t?.initiatorId === me.id || t?.memberIds.includes(me.id)
          }),
        }
      : null

    return {
      ...s,
      users: s.users.map((u) => (u.id === me.id ? u : { ...u, projectAdjust: undefined, blocked: undefined, consentAt: undefined })),
      sprints: s.sprints.filter((x) => x.teamId === myTeam),
      cards: myCards,
      history: s.history.filter((h) => h.teamId === myTeam && myCards.some((c) => c.id === h.cardId)),
      channels: s.channels.filter((c) => readable.has(c.id)),
      messages: s.messages.filter((m) => readable.has(m.channelId) && !m.deletedAt).map((m) => ({ ...m, originalText: undefined })),
      submissions,
      retros: s.retros.filter((r) => r.teamId === myTeam).map((r) => ({ ...r, ratings: r.ratings.filter((x) => x.from === me.id) })),
      adjustments: s.adjustments.filter((a) => a.studentId === me.id),
      audit: [],
      dismissedSignals: [],
      formation,
    }
  }
}
