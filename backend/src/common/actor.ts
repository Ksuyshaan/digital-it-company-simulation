import type { User } from '../domain/types'

/** Текущий пользователь запроса: профиль в форме фронтенда (с командой текущего курса) */
export interface Actor {
  user: User
  /** Текущий курс (заголовок X-Course-Id или первый активный курс пользователя) */
  courseId: string | null
  ip: string
  sessionId: string
}

export const isStaffRole = (role: string) => role === 'teacher' || role === 'assistant'
