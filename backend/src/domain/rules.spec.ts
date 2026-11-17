import type { Assignment, Card, State, Submission, Team, User } from './types'
import { DEFAULT_SETTINGS, DEFAULT_ADMIN } from './defaults'
import { allScores, checkTeam, finalGrade, lateInfo, moveError, reviewCounts, teamworkParts } from './rules'
import { DAY, HOUR, WEEK } from './util'

const NOW = Date.now()

function user(id: string, extra: Partial<User> = {}): User {
  return { id, name: `Студент ${id}`, email: `${id}@u.kz`, group: 'G', role: 'student', about: '', skills: [], wantedRoles: [], links: [], lastActiveAt: NOW, courseIds: ['c'], rdWeekAgo: 0, ...extra }
}

function state(p: Partial<State> = {}): State {
  return {
    version: 3, seededAt: NOW,
    course: { id: 'c', name: 'К', stream: 'П', start: NOW - 10 * WEEK, weeks: 15, teacherId: 't', status: 'active' },
    courses: [], settings: { ...DEFAULT_SETTINGS }, admin: DEFAULT_ADMIN('u.kz'),
    users: [], teams: [], sprints: [], cards: [], history: [], channels: [], messages: [], assignments: [], submissions: [], retros: [],
    adjustments: [], audit: [], notifications: [], locks: [], dismissedSignals: [], manualBadges: [], formation: null, cardSeq: {},
    ...p,
  }
}

const card = (id: string, assigneeId: string, sp: number, extra: Partial<Card> = {}): Card => ({
  id, key: id, teamId: 'tm', sprintId: null, column: 'done', title: id, description: 'd', assigneeId, deadline: NOW - DAY, priority: 'mid', sp,
  labels: [], checklist: [], files: [], comments: [], authorId: assigneeId, createdAt: NOW - 3 * DAY, closedAt: NOW - 2 * DAY, ...extra,
})

describe('Работа в команде (п. 7.3)', () => {
  it('пример из ТЗ: команда из 4, у студента 20% SP → вклад 8 баллов', () => {
    const team: Team = { id: 'tm', name: 'T', idea: '', initiatorId: 'a', memberIds: ['a', 'b', 'c', 'd'], status: 'approved', projectScore: 0, channelId: '' }
    const users = ['a', 'b', 'c', 'd'].map((id) => user(id, { teamId: 'tm' }))
    // всего 50 SP, у «a» — 10 (20%)
    const cards = [card('1', 'a', 10), card('2', 'b', 15), card('3', 'c', 15), card('4', 'd', 10)]
    const s = state({ users, teams: [team], cards })
    expect(teamworkParts(s, users[0]).volume).toBeCloseTo(8)
    // все карточки закрыты до дедлайна → сроки 15 из 15
    expect(teamworkParts(s, users[0]).onTime).toBe(15)
  })
})

describe('Задания и peer-review (п. 3.2–3.3)', () => {
  const a: Assignment = { id: 'a', title: 'A', description: '', openAt: NOW - 5 * DAY, deadline: NOW - 2 * DAY, maxScore: 10, criteria: [{ text: 'x', points: 10 }], format: 'text', peerReview: true }
  const sub = (submitAt: number, teacher: number, peers: number[]): Submission => ({
    id: 's', assignmentId: 'a', studentId: 'u', versions: [{ at: submitAt, content: 'ok' }], teacherScores: [teacher],
    reviews: peers.map((p, i) => ({ id: `r${i}`, reviewerId: `p${i}`, scores: [p], comment: 'x'.repeat(100), assignedAt: a.deadline, doneAt: a.deadline + HOUR })),
  })

  it('итог = 0,7 × преподаватель + 0,3 × среднее рецензентов', () => {
    // 0,7 × 8 + 0,3 × 6,5 = 7,55 → итог округляется до десятых
    expect(finalGrade(a, sub(a.deadline - HOUR, 8, [6, 7]), state())).toBe(7.6)
  })

  it('поздняя сдача: −10% максимума за каждые начатые сутки', () => {
    const s = state()
    expect(lateInfo(a, sub(a.deadline + 25 * HOUR, 8, []), s).penalty).toBe(2)
    expect(finalGrade(a, sub(a.deadline + HOUR, 8, [8, 8]), s)).toBeCloseTo(8 - 1)
  })

  it('через 72 часа сдача закрывается', () => {
    expect(lateInfo(a, undefined, state()).closeAt).toBe(a.deadline + 72 * HOUR)
  })

  it('рецензия с отклонением > 30% от оценки преподавателя не даёт баллов', () => {
    const s = sub(a.deadline - HOUR, 9, [5, 7])
    expect(reviewCounts(s.reviews[0], s, a, state())).toBe(false) // |5 − 9| = 4 > 3
    expect(reviewCounts(s.reviews[1], s, a, state())).toBe(true) // |7 − 9| = 2 ≤ 3
  })
})

describe('Рейтинг (раздел 7)', () => {
  it('РД = (Р1 + Р2) / 2, Р1 = И + А, Р2 = К + П', () => {
    const team: Team = { id: 'tm', name: 'T', idea: '', initiatorId: 'a', memberIds: ['a'], status: 'approved', projectScore: 40, channelId: '' }
    const u = user('a', { teamId: 'tm', profileFilledAt: NOW - 10 * WEEK + DAY })
    const s = state({ users: [u], teams: [team] })
    const v = allScores(s).get('a')!
    expect(v.A_parts.profile).toBe(5)
    expect(v.R1).toBeCloseTo(v.I + v.A)
    expect(v.R2).toBeCloseTo(v.K + v.P)
    expect(v.RD).toBeCloseTo((v.R1 + v.R2) / 2)
    expect(v.P).toBe(40)
  })
})

describe('Доска и команды (п. 3.4, 4.1)', () => {
  it('исполнитель не переносит свою карточку в Done; в Done только из Review', () => {
    const s = state()
    const c = card('c', 'a', 3, { column: 'review' })
    expect(moveError(s, c, 'done', user('a'))).toMatch(/Исполнитель не может/)
    expect(moveError(s, c, 'done', user('b'))).toBeNull()
    expect(moveError(s, { ...c, column: 'progress' }, 'done', user('b'))).toMatch(/только из Review/)
  })

  it('команда без Team Lead или со средним Р1 ниже 50 не проходит проверку', () => {
    const users = ['a', 'b', 'c'].map((id) => user(id))
    const team: Team = { id: 'ft', name: 'F', idea: '', initiatorId: 'a', memberIds: ['a', 'b', 'c'], status: 'draft', projectScore: 0, channelId: '' }
    const bad = checkTeam(state({ users }), team, { a: 'Developer', b: 'Scrum Master', c: 'QA' }).filter((x) => !x.ok).map((x) => x.label)
    expect(bad).toContain('Ровно один Team Lead')
    expect(bad).toContain('Средний Р1 участников не ниже 50')
  })
})
