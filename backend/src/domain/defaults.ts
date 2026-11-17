import type { AdminSettings, CourseSettings } from './types'

/** Значения «по умолчанию» из ТЗ — преподаватель меняет их в настройках курса */
export const DEFAULT_SETTINGS: CourseSettings = {
  boardMode: 'scrum',
  sprintWeeks: 1,
  teamMin: 3,
  teamMax: 5,
  minAvgR1: 50,
  roles: ['Team Lead', 'Scrum Master', 'Developer', 'Analyst', 'Designer', 'QA'],
  smRotation: false,
  wipLimit: 2,
  latePenaltyPct: 10,
  lateCloseHours: 72,
  teacherWeight: 0.7,
  peerWeight: 0.3,
  peerDeviationPct: 30,
  admissionThreshold: 50,
  ratingVisibility: 'full',
  signalInactiveDays: 5,
  signalShareMin: 10,
  signalShareMax: 50,
  signalOverduePct: 30,
  signalSilentDays: 3,
  skillDictionary: ['Product analytics', 'Figma', 'SQL', 'Jira', 'Python', 'React', 'TypeScript', 'Node.js', 'Git', 'Docker', 'PostgreSQL', 'Agile', 'Scrum'],
}

export const DEFAULT_ADMIN = (domain: string): AdminSettings => ({
  provider: 'Microsoft 365',
  domain,
  blockOtherDomains: true,
  inviteCodes: true,
  sessionHours: 8,
  lastBackup: 0,
})
