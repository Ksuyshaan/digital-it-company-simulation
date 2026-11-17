export type SystemRole = 'student' | 'teacher' | 'assistant' | 'admin'
export type TeamRole = 'Team Lead' | 'Scrum Master' | 'Developer' | 'Analyst' | 'Designer' | 'QA'
export type Column = 'backlog' | 'todo' | 'progress' | 'review' | 'done'
export type Priority = 'low' | 'mid' | 'high'

export interface Link {
  label: string
  url: string
}

export interface User {
  id: string
  name: string
  email: string
  group: string
  role: SystemRole
  about: string
  skills: string[]
  wantedRoles: TeamRole[]
  links: Link[]
  photo?: string
  teamId?: string
  teamRole?: TeamRole
  lastActiveAt: number
  blocked?: boolean
  courseIds: string[]
  profileFilledAt?: number
  /** РД неделю назад — для колонки «за неделю» */
  rdWeekAgo: number
  /** часть проекта, выставленная преподавателем лично студенту (±20%) */
  projectAdjust?: number
  /** согласие с тем, что переписку видит преподаватель (п. 8 ТЗ) */
  consentAt?: number
}

export interface Team {
  id: string
  name: string
  idea: string
  initiatorId: string
  memberIds: string[]
  status: 'draft' | 'pending' | 'approved' | 'returned'
  returnComment?: string
  approvedOverride?: string
  /** роли участников (используется в черновиках на этапе формирования) */
  roles?: Record<string, TeamRole>
  /** балл П (проект) на текущий момент, 0–60 */
  projectScore: number
  channelId: string
}

export interface Sprint {
  id: string
  teamId: string
  number: number
  name: string
  goal: string
  start: number
  end: number
  status: 'planned' | 'active' | 'closed'
  closedAt?: number
  report?: { planned: number; done: number; overdue: number; plannedSp: number; doneSp: number }
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Attachment {
  id: string
  name: string
  size: number
}

export interface Comment {
  id: string
  authorId: string
  text: string
  at: number
  files?: Attachment[]
}

export interface Card {
  id: string
  key: string
  teamId: string
  sprintId: string | null
  column: Column
  title: string
  description: string
  assigneeId: string | null
  deadline: number | null
  priority: Priority
  sp: number | null
  labels: string[]
  checklist: ChecklistItem[]
  files: Attachment[]
  comments: Comment[]
  authorId: string
  createdAt: number
  startedAt?: number
  closedAt?: number
  archived?: boolean
}

export interface HistoryEntry {
  id: string
  cardId: string
  teamId: string
  userId: string
  at: number
  field: string
  from: string
  to: string
  note?: string
}

export interface Channel {
  id: string
  kind: 'general' | 'announcements' | 'team'
  name: string
  teamId?: string
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  text: string
  at: number
  parentId?: string
  files?: Attachment[]
  reactions: Record<string, string[]>
  editedAt?: number
  originalText?: string
  deletedAt?: number
}

export interface Criterion {
  text: string
  points: number
}

export interface Assignment {
  id: string
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

export interface Review {
  id: string
  reviewerId: string
  scores: number[] | null
  comment: string
  assignedAt: number
  doneAt?: number
  disputed?: { reason: string; at: number; resolution?: 'kept' | 'removed' }
}

export interface Submission {
  id: string
  assignmentId: string
  studentId: string
  versions: { at: number; content: string }[]
  teacherScores?: number[]
  teacherComment?: string
  gradedAt?: number
  extensionUntil?: number
  reviews: Review[]
}

export interface RetroItem {
  id: string
  authorId: string
  col: 'good' | 'bad' | 'change'
  text: string
  at: number
}

export interface Retro {
  id: string
  sprintId: string
  teamId: string
  items: RetroItem[]
  ratings: { from: string; to: string; score: number }[]
}

export interface PointAdjustment {
  id: string
  studentId: string
  component: 'A' | 'K' | 'P'
  delta: number
  reason: string
  byId: string
  at: number
}

export interface AuditEntry {
  id: string
  at: number
  userId: string
  text: string
  ip?: string
}

export interface Notification {
  id: string
  userId: string
  at: number
  text: string
  link: string
  read?: boolean
  kind: 'mention' | 'assign' | 'review' | 'deadline' | 'grade' | 'team' | 'system'
}

export interface Lock {
  id: string
  scope: 'all' | 'team' | 'assignment'
  targetId?: string
  reason: string
  from: number
  createdBy: string
  cancelled?: boolean
}

export interface CourseSettings {
  boardMode: 'scrum' | 'kanban'
  sprintWeeks: 1 | 2
  teamMin: number
  teamMax: number
  minAvgR1: number
  roles: TeamRole[]
  smRotation: boolean
  wipLimit: number
  latePenaltyPct: number
  lateCloseHours: number
  teacherWeight: number
  peerWeight: number
  peerDeviationPct: number
  admissionThreshold: number
  ratingVisibility: 'full' | 'places' | 'top10'
  signalInactiveDays: number
  signalShareMin: number
  signalShareMax: number
  signalOverduePct: number
  signalSilentDays: number
  skillDictionary: string[]
}

export interface Course {
  id: string
  name: string
  stream: string
  start: number
  weeks: number
  teacherId: string
  status: 'active' | 'archive'
  keepUntil?: string
  studentsCount?: number
}

export interface FormationState {
  deadline: number
  teams: Team[]
  requests: { id: string; teamId: string; studentId: string; kind: 'request' | 'invite'; at: number }[]
}

export interface AdminSettings {
  provider: string
  domain: string
  blockOtherDomains: boolean
  inviteCodes: boolean
  sessionHours: number
  lastBackup: number
}

export interface State {
  version: number
  seededAt: number
  course: Course
  courses: Course[]
  settings: CourseSettings
  admin: AdminSettings
  users: User[]
  teams: Team[]
  sprints: Sprint[]
  cards: Card[]
  history: HistoryEntry[]
  channels: Channel[]
  messages: Message[]
  assignments: Assignment[]
  submissions: Submission[]
  retros: Retro[]
  adjustments: PointAdjustment[]
  audit: AuditEntry[]
  notifications: Notification[]
  locks: Lock[]
  dismissedSignals: string[]
  manualBadges: { userId: string; key: string }[]
  formation: FormationState | null
  cardSeq: Record<string, number>
}
