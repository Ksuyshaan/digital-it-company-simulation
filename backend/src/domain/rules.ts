/**
 * Бизнес-правила и формулы ТЗ — перенесены с фронтенда (frontend/src/lib/rules.ts) один в один,
 * чтобы сервер и клиент считали рейтинг, штрафы, проверки и сигналы одинаково.
 */
import type { Assignment, Card, Column, Review, Sprint, State, Submission, Team, User } from './types'
import { DAY, HOUR, WEEK, avg, clamp, now, sum } from './util'

/* ───────────── Календарь курса ───────────── */

export function courseWeek(s: State, t = now()) {
  return clamp(Math.floor((t - s.course.start) / WEEK) + 1, 1, s.course.weeks)
}

export const weekStart = (s: State, w: number) => s.course.start + (w - 1) * WEEK

export function stageOf(week: number) {
  if (week <= 7) return 'Индивидуальный этап'
  if (week <= 9) return 'Формирование команд'
  return 'Командный этап'
}

/* ───────────── Задания, поздняя сдача, peer-review (п. 3.2–3.3) ───────────── */

export const submittedAt = (sub: Submission) => sub.versions[sub.versions.length - 1]?.at ?? 0

export function lateInfo(a: Assignment, sub: Submission | undefined, s: State) {
  const deadline = sub?.extensionUntil ?? a.deadline
  const closeAt = deadline + s.settings.lateCloseHours * HOUR
  const at = sub ? submittedAt(sub) : 0
  const lateMs = sub ? at - deadline : 0
  const lateDays = lateMs > 0 ? Math.ceil(lateMs / DAY) : 0
  const penalty = Math.min(a.maxScore, (lateDays * s.settings.latePenaltyPct * a.maxScore) / 100)
  return { deadline, closeAt, lateDays, penalty, closed: now() > closeAt }
}

export const reviewScore = (r: Review) => (r.scores ? sum(r.scores) : null)

export function activeReviews(sub: Submission) {
  return sub.reviews.filter((r) => r.scores && r.disputed?.resolution !== 'removed')
}

export function peerAvg(sub: Submission) {
  const rs = activeReviews(sub).map((r) => reviewScore(r) as number)
  return rs.length ? avg(rs) : null
}

export const teacherScore = (sub: Submission) => (sub.teacherScores ? sum(sub.teacherScores) : null)

/** Итог = tw × преподаватель + pw × среднее рецензентов − штраф за опоздание */
export function finalGrade(a: Assignment, sub: Submission | undefined, s: State) {
  if (!sub) return null
  const t = teacherScore(sub)
  if (t === null) return null
  const p = a.peerReview ? peerAvg(sub) : null
  const base = p === null ? t : s.settings.teacherWeight * t + s.settings.peerWeight * p
  const { penalty } = lateInfo(a, sub, s)
  return clamp(Math.round((base - penalty) * 10) / 10, 0, a.maxScore)
}

/** Рецензия засчитывается: сделана за 48 ч и отличается от оценки преподавателя не более чем на 30% макс. балла */
export function reviewCounts(r: Review, sub: Submission, a: Assignment, s: State) {
  if (!r.scores || !r.doneAt) return false
  if (r.doneAt - r.assignedAt > 48 * HOUR) return false
  if (r.disputed?.resolution === 'removed') return false
  const t = teacherScore(sub)
  if (t === null) return false
  return Math.abs(sum(r.scores) - t) <= (s.settings.peerDeviationPct / 100) * a.maxScore
}

/* ───────────── Рейтинг (раздел 7) ───────────── */

export interface Scores {
  I: number
  A: number
  R1: number
  K: number
  P: number
  R2: number
  RD: number
  K_parts: { onTime: number; volume: number; peers: number; retro: number }
  A_parts: { profile: number; reviews: number; onTime: number; manual: number }
  place: number
  prevPlace: number
}

const cache = new WeakMap<State, Map<string, Scores>>()

export function allScores(s: State): Map<string, Scores> {
  const hit = cache.get(s)
  if (hit) return hit
  const res = new Map<string, Scores>()
  const students = s.users.filter((u) => u.role === 'student' && u.courseIds.includes(s.course.id))
  const subsBy = new Map<string, Submission[]>()
  for (const sub of s.submissions) {
    const arr = subsBy.get(sub.studentId) ?? []
    arr.push(sub)
    subsBy.set(sub.studentId, arr)
  }
  const aById = new Map(s.assignments.map((a) => [a.id, a]))
  const validReviews = new Map<string, number>()
  for (const sub of s.submissions) {
    const a = aById.get(sub.assignmentId)
    if (!a) continue
    for (const r of sub.reviews) if (reviewCounts(r, sub, a, s)) validReviews.set(r.reviewerId, (validReviews.get(r.reviewerId) ?? 0) + 1)
  }
  const gradedAssignments = s.assignments.filter((a) => a.deadline < now())
  const maxTotal = sum(gradedAssignments.map((a) => a.maxScore))

  for (const u of students) {
    const subs = subsBy.get(u.id) ?? []
    let got = 0
    let onTime = 0
    for (const a of gradedAssignments) {
      const sub = subs.find((x) => x.assignmentId === a.id)
      got += finalGrade(a, sub, s) ?? 0
      if (sub && !a.isControl && submittedAt(sub) <= a.deadline) onTime++
    }
    const I = maxTotal ? (60 * got) / maxTotal : 0
    const adj = (c: 'A' | 'K' | 'P') => sum(s.adjustments.filter((x) => x.studentId === u.id && x.component === c).map((x) => x.delta))
    const profile = u.profileFilledAt && u.profileFilledAt < s.course.start + WEEK ? 5 : 0
    const A_parts = {
      profile,
      reviews: Math.min(20, 2 * (validReviews.get(u.id) ?? 0)),
      onTime: Math.min(8, onTime),
      manual: clamp(adj('A'), 0, 7),
    }
    const A = A_parts.profile + A_parts.reviews + A_parts.onTime + A_parts.manual
    const kp = teamworkParts(s, u)
    const K = clamp(kp.onTime + kp.volume + kp.peers + kp.retro + adj('K'), 0, 40)
    const team = s.teams.find((t) => t.id === u.teamId)
    const P = team ? clamp(team.projectScore * (1 + (u.projectAdjust ?? 0)) + adj('P'), 0, 60) : 0
    const R1 = Math.min(100, I + A)
    const R2 = Math.min(100, K + P)
    res.set(u.id, { I, A, R1, K, P, R2, RD: (R1 + R2) / 2, K_parts: kp, A_parts, place: 0, prevPlace: 0 })
  }
  const order = [...res.entries()].sort((a, b) => b[1].RD - a[1].RD)
  order.forEach(([, v], i) => (v.place = i + 1))
  const prev = students.map((u) => ({ id: u.id, rd: u.rdWeekAgo })).sort((a, b) => b.rd - a.rd)
  prev.forEach((p, i) => {
    const v = res.get(p.id)
    if (v) v.prevPlace = i + 1
  })
  cache.set(s, res)
  return res
}

export const scoresOf = (s: State, id: string) => allScores(s).get(id)

/** К — работа в команде, п. 7.3 */
export function teamworkParts(s: State, u: User) {
  const zero = { onTime: 0, volume: 0, peers: 0, retro: 0 }
  const team = s.teams.find((t) => t.id === u.teamId)
  if (!team) return zero
  const t = now()
  const cards = s.cards.filter((c) => c.teamId === team.id && !c.archived)
  const mine = cards.filter((c) => c.assigneeId === u.id && c.deadline)
  const relevant = mine.filter((c) => c.closedAt || (c.deadline! < t && c.column !== 'done'))
  const ontime = relevant.filter((c) => c.closedAt && c.closedAt <= c.deadline!)
  const onTime = relevant.length ? (15 * ontime.length) / relevant.length : 0
  const done = cards.filter((c) => c.column === 'done')
  const totalSp = sum(done.map((c) => c.sp ?? 0))
  const mySp = sum(done.filter((c) => c.assigneeId === u.id).map((c) => c.sp ?? 0))
  const volume = totalSp ? 10 * Math.min(1, (mySp / totalSp) * team.memberIds.length) : 0
  const retros = s.retros.filter((r) => r.teamId === team.id)
  const ratings = retros.flatMap((r) => r.ratings.filter((x) => x.to === u.id).map((x) => x.score))
  const peers = ratings.length ? (10 * avg(ratings)) / 5 : 0
  const closed = s.sprints.filter((sp) => sp.teamId === team.id && sp.status === 'closed')
  const filled = closed.filter((sp) => s.retros.some((r) => r.sprintId === sp.id && r.items.some((i) => i.authorId === u.id)))
  const retro = closed.length ? (5 * filled.length) / closed.length : 0
  return { onTime, volume, peers, retro }
}

export function teamScores(s: State) {
  const sc = allScores(s)
  return s.teams
    .filter((t) => t.status === 'approved')
    .map((t) => {
      const ms = t.memberIds.map((id) => sc.get(id)).filter(Boolean) as Scores[]
      return { team: t, R1: avg(ms.map((m) => m.R1)), R2: avg(ms.map((m) => m.R2)), RD: avg(ms.map((m) => m.RD)) }
    })
    .sort((a, b) => b.RD - a.RD)
}

/* ───────────── Формирование команд (п. 3.4) ───────────── */

export interface RuleCheck {
  ok: boolean
  label: string
  value: string
}

export function checkTeam(s: State, team: Team, roles: Record<string, string | undefined>): RuleCheck[] {
  const st = s.settings
  const n = team.memberIds.length
  const sc = allScores(s)
  const avgR1 = avg(team.memberIds.map((id) => sc.get(id)?.R1 ?? 0))
  const tl = team.memberIds.filter((id) => roles[id] === 'Team Lead').length
  const sm = team.memberIds.filter((id) => roles[id] === 'Scrum Master').length
  const checks: RuleCheck[] = [
    { ok: n >= st.teamMin && n <= st.teamMax, label: `Размер команды ${st.teamMin}–${st.teamMax} человек`, value: `${n} чел.` },
    { ok: avgR1 >= st.minAvgR1, label: `Средний Р1 участников не ниже ${st.minAvgR1}`, value: String(Math.round(avgR1)) },
    { ok: tl === 1, label: 'Ровно один Team Lead', value: `${tl} из 1` },
  ]
  if (st.boardMode === 'scrum')
    checks.push({
      ok: sm === 1,
      label: 'Ровно один Scrum Master (не Team Lead)',
      value: sm === 0 ? 'не назначен' : sm === 1 ? '1 из 1' : `${sm} — лишние`,
    })
  return checks
}

/* ───────────── Доска (п. 4.1) ───────────── */

export const COLUMNS: { id: Column; title: string }[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'todo', title: 'To Do' },
  { id: 'progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
]
export const COL_TITLE: Record<Column, string> = Object.fromEntries(COLUMNS.map((c) => [c.id, c.title])) as Record<Column, string>
export const colIndex = (c: Column) => COLUMNS.findIndex((x) => x.id === c)
export const PRIORITY: Record<string, string> = { low: 'Низкий', mid: 'Средний', high: 'Высокий' }
export const SP_VALUES = [1, 2, 3, 5, 8, 13]

/** Возвращает текст ошибки, если перенос запрещён правилами */
export function moveError(s: State, card: Card, to: Column, actor: User): string | null {
  if (card.column === to) return null
  const fi = colIndex(card.column)
  const ti = colIndex(to)
  if (ti > fi) {
    if (ti >= 1) {
      if (!card.description.trim()) return 'Для To Do и далее нужно описание задачи'
      if (!card.assigneeId) return 'Для To Do и далее нужен исполнитель'
      if (!card.deadline) return 'Для To Do и далее нужен дедлайн'
      if (s.settings.boardMode === 'scrum' && !card.sp) return 'В Scrum-режиме нужна оценка в story points'
    }
    if (to === 'done') {
      if (card.column !== 'review') return 'В Done можно перенести только из Review'
      if (card.assigneeId === actor.id) return 'Исполнитель не может сам перенести свою карточку в Done — это делает другой участник или Team Lead'
    }
  }
  return null
}

export const needsReturnComment = (card: Card, to: Column) => card.column === 'review' && colIndex(to) < colIndex('review')

export function wipOverflow(s: State, teamId: string) {
  const res: { userId: string; count: number }[] = []
  const cards = s.cards.filter((c) => c.teamId === teamId && c.column === 'progress' && !c.archived)
  const by = new Map<string, number>()
  cards.forEach((c) => c.assigneeId && by.set(c.assigneeId, (by.get(c.assigneeId) ?? 0) + 1))
  by.forEach((count, userId) => count > s.settings.wipLimit && res.push({ userId, count }))
  return res
}

export function isLocked(s: State, teamId?: string, assignmentId?: string) {
  const t = now()
  return s.locks.find(
    (l) =>
      !l.cancelled &&
      l.from <= t &&
      (l.scope === 'all' || (l.scope === 'team' && l.targetId === teamId) || (l.scope === 'assignment' && l.targetId === assignmentId)),
  )
}

export const activeSprint = (s: State, teamId: string): Sprint | undefined =>
  s.sprints.find((sp) => sp.teamId === teamId && sp.status === 'active')

export function burndown(s: State, sprint: Sprint) {
  const cards = s.cards.filter((c) => c.sprintId === sprint.id && !c.archived)
  const total = sum(cards.map((c) => c.sp ?? 0))
  const days = Math.max(1, Math.round((sprint.end - sprint.start) / DAY))
  const today = Math.min(days, Math.floor((now() - sprint.start) / DAY) + 1)
  const actual: number[] = []
  for (let d = 0; d <= Math.min(days, sprint.status === 'closed' ? days : today); d++) {
    const edge = sprint.start + d * DAY
    actual.push(total - sum(cards.filter((c) => c.closedAt && c.closedAt <= edge && c.column === 'done').map((c) => c.sp ?? 0)))
  }
  const doneSp = sum(cards.filter((c) => c.column === 'done').map((c) => c.sp ?? 0))
  const ideal = (d: number) => total - (total * d) / days
  const behind = Math.round(actual[actual.length - 1] - ideal(actual.length - 1))
  return { total, days, today, actual, ideal, doneSp, behind }
}

/* ───────────── Аналитика (раздел 6) ───────────── */

export type Period = { from: number; to: number; label: string }

export function memberMetrics(s: State, u: User, p: Period) {
  const t = now()
  const cards = s.cards.filter((c) => c.teamId === u.teamId && !c.archived)
  const created = cards.filter((c) => c.authorId === u.id && c.createdAt >= p.from && c.createdAt <= p.to).length
  const doneCards = cards.filter((c) => c.assigneeId === u.id && c.column === 'done' && c.closedAt! >= p.from && c.closedAt! <= p.to)
  const onTime = doneCards.filter((c) => c.deadline && c.closedAt! <= c.deadline).length
  const overdue = cards.filter((c) => c.assigneeId === u.id && c.column !== 'done' && c.deadline && c.deadline < t).length
  const weeks = Math.max(1, (Math.min(p.to, t) - p.from) / WEEK)
  const msgs =
    s.messages.filter((m) => m.authorId === u.id && !m.deletedAt && m.text.length > 10 && m.at >= p.from && m.at <= p.to).length +
    cards.flatMap((c) => c.comments).filter((c) => c.authorId === u.id && c.at >= p.from && c.at <= p.to).length
  return {
    created,
    done: doneCards.length,
    onTimePct: doneCards.length ? Math.round((100 * onTime) / doneCards.length) : null,
    overdue,
    chatPerWeek: Math.round(msgs / weeks),
    sp: sum(doneCards.map((c) => c.sp ?? 0)),
    lastActive: u.lastActiveAt,
  }
}

export function teamMetrics(s: State, team: Team, p: Period, sprintId?: string) {
  const t = now()
  const all = s.cards.filter((c) => c.teamId === team.id && !c.archived)
  const scope = sprintId ? all.filter((c) => c.sprintId === sprintId) : all.filter((c) => c.createdAt <= p.to)
  const spTotal = sum(scope.map((c) => c.sp ?? 0))
  const done = scope.filter((c) => c.column === 'done')
  const spDone = sum(done.map((c) => c.sp ?? 0))
  const onTime = done.filter((c) => c.deadline && c.closedAt! <= c.deadline).length
  const overdue = scope.filter((c) => c.column !== 'done' && c.deadline && c.deadline < Math.min(t, p.to + 1)).length
  const cycle = done.filter((c) => c.startedAt && c.closedAt).map((c) => (c.closedAt! - c.startedAt!) / DAY)
  const weeks = Math.max(1, (Math.min(p.to, t) - p.from) / WEEK)
  const chat = s.messages.filter((m) => m.channelId === team.channelId && !m.deletedAt && m.text.length > 10 && m.at >= p.from && m.at <= p.to).length
  const comments = all.flatMap((c) => c.comments).filter((c) => c.at >= p.from && c.at <= p.to).length
  const load = team.memberIds
    .map((id) => ({ id, sp: sum(done.filter((c) => c.assigneeId === id).map((c) => c.sp ?? 0)) }))
    .map((x) => ({ ...x, pct: spDone ? Math.round((100 * x.sp) / spDone) : 0 }))
    .sort((a, b) => b.pct - a.pct)
  return {
    spDone,
    spTotal,
    onTimePct: done.length ? Math.round((100 * onTime) / done.length) : null,
    overdue,
    overduePct: scope.length ? Math.round((100 * overdue) / scope.length) : 0,
    cycleDays: cycle.length ? avg(cycle) : null,
    chatPerWeek: Math.round((chat + comments) / weeks),
    load,
    cards: scope.length,
    created: scope.length,
    doneCount: done.length,
  }
}

export interface Signal {
  id: string
  kind: 'Нагрузка' | 'Нет активности' | 'Просрочки' | 'Тихий канал' | 'Ретроспектива'
  text: string
  action: { label: string; to: string }
  teamId?: string
}

export function computeSignals(s: State): Signal[] {
  const st = s.settings
  const t = now()
  const res: Signal[] = []
  for (const team of s.teams.filter((x) => x.status === 'approved')) {
    const sp = activeSprint(s, team.id)
    if (sp) {
      const m = teamMetrics(s, team, { from: sp.start, to: sp.end, label: '' }, sp.id)
      if (m.spDone > 0) {
        const bad = m.load.filter((l) => l.pct < st.signalShareMin || l.pct > st.signalShareMax)
        if (bad.length) {
          const hi = m.load.find((l) => l.pct > st.signalShareMax)
          const lo = m.load.filter((l) => l.pct < st.signalShareMin)
          const nm = (id: string) => s.users.find((u) => u.id === id)?.name ?? ''
          const parts: string[] = []
          if (hi) parts.push(`у ${genitive(nm(hi.id))} ${hi.pct}% SP`)
          if (lo.length) parts.push(`у ${lo.length === 1 ? genitive(nm(lo[0].id)) : `${lo.length} участников`} меньше ${st.signalShareMin}%`)
          res.push({ id: `load:${team.id}:${sp.id}`, kind: 'Нагрузка', text: `${team.name}: ${parts.join(', ')}`, action: { label: 'Открыть доску', to: `/board/${team.id}` }, teamId: team.id })
        }
      }
      if (m.overduePct > st.signalOverduePct)
        res.push({
          id: `overdue:${team.id}:${sp.id}`,
          kind: 'Просрочки',
          text: `${team.name}: просрочено ${m.overdue} из ${m.cards} карточек спринта (${m.overduePct}%)`,
          action: { label: 'Открыть доску', to: `/board/${team.id}` },
          teamId: team.id,
        })
    }
    const last = Math.max(0, ...s.messages.filter((m) => m.channelId === team.channelId && !m.deletedAt).map((m) => m.at))
    if (t - last > st.signalSilentDays * DAY) {
      const d = Math.floor((t - last) / DAY)
      res.push({
        id: `silent:${team.id}:${Math.floor(last / DAY)}`,
        kind: 'Тихий канал',
        text: `В канале #${slug(team.name)} нет сообщений ${last ? `${d} дн.` : 'ни одного'}`,
        action: { label: 'Открыть канал', to: `/channels/${team.channelId}` },
        teamId: team.id,
      })
    }
    for (const sp2 of s.sprints.filter((x) => x.teamId === team.id && x.status === 'closed')) {
      const retro = s.retros.find((r) => r.sprintId === sp2.id)
      if ((!retro || retro.items.length === 0) && sp2.closedAt && t - sp2.closedAt > 0)
        res.push({
          id: `retro:${sp2.id}`,
          kind: 'Ретроспектива',
          text: `${team.name} закрыли спринт ${sp2.number} без ретроспективы`,
          action: { label: 'Написать команде', to: `/channels/${team.channelId}` },
          teamId: team.id,
        })
    }
  }
  for (const u of s.users.filter((x) => x.role === 'student' && x.courseIds.includes(s.course.id))) {
    if (t - u.lastActiveAt > st.signalInactiveDays * DAY) {
      const team = s.teams.find((x) => x.id === u.teamId)
      res.push({
        id: `inactive:${u.id}:${Math.floor(u.lastActiveAt / DAY)}`,
        kind: 'Нет активности',
        text: `${u.name}${team ? ` (${team.name})` : ''} — ${Math.floor((t - u.lastActiveAt) / DAY)} дней без действий`,
        action: { label: 'Открыть профиль', to: `/profile/${u.id}` },
      })
    }
  }
  return res.filter((x) => !s.dismissedSignals.includes(x.id))
}

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9а-яё-]/gi, '')

function genitive(name: string) {
  // упрощённо: «у Ерлана Бекетова», «у Мадины Ержановой»
  const [f, l] = name.split(' ')
  const g = (w: string, isLast: boolean) => {
    if (!w) return w
    if (/[ая]$/.test(w)) return w.replace(/а$/, isLast && /ова$|ева$|ина$/.test(w) ? 'ой' : 'ы').replace(/я$/, 'и')
    if (/[бвгджзклмнпрстфхцчшщ]$/i.test(w)) return w + 'а'
    return w
  }
  return `${g(f, false)} ${g(l ?? '', true)}`.trim()
}

/* ───────────── Достижения (п. 3.5) ───────────── */

export const BADGES = [
  { key: 'first', title: 'Первая сдача' },
  { key: 'streak5', title: '5 работ вовремя подряд' },
  { key: 'reviewer', title: 'Лучший рецензент недели' },
  { key: 'top10', title: 'Топ-10 курса' },
  { key: 'sprint', title: 'Спринт без просрочек' },
]

export function badgesOf(s: State, u: User): string[] {
  const res = new Set<string>()
  const subs = s.submissions.filter((x) => x.studentId === u.id && x.versions.length)
  if (subs.length) res.add('first')
  const ordered = [...s.assignments].filter((a) => !a.isControl).sort((a, b) => a.deadline - b.deadline)
  let streak = 0
  for (const a of ordered) {
    const sub = subs.find((x) => x.assignmentId === a.id)
    if (sub && submittedAt(sub) <= a.deadline) {
      streak++
      if (streak >= 5) res.add('streak5')
    } else streak = 0
  }
  const sc = scoresOf(s, u.id)
  if (sc && sc.place <= 10) res.add('top10')
  for (const sp of s.sprints.filter((x) => x.teamId === u.teamId && x.status === 'closed')) {
    const mine = s.cards.filter((c) => c.sprintId === sp.id && c.assigneeId === u.id && c.deadline)
    if (mine.length && mine.every((c) => c.closedAt && c.closedAt <= c.deadline!)) res.add('sprint')
  }
  s.manualBadges.filter((b) => b.userId === u.id).forEach((b) => res.add(b.key))
  return [...res]
}

export const isStaff = (u?: User | null) => !!u && (u.role === 'teacher' || u.role === 'assistant')
