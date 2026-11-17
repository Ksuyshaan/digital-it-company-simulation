import { Injectable } from '@nestjs/common'
import { StateService } from '../state/state.service'
import { fail, forbid } from './errors'
import type { Actor } from './actor'
import type { State, User } from '../domain/types'
import { isStaff } from '../domain/rules'

export interface Ctx {
  s: State
  me: User
  courseId: string
  actor: Actor
}

/** Снимок курса + текущий пользователь в нём — основа для проверок бизнес-правил */
@Injectable()
export class CourseContext {
  constructor(private readonly state: StateService) {}

  /** Для изменений: курс выбран и не в архиве (закрытый курс — «только чтение», п. 8 ТЗ) */
  async write(actor: Actor): Promise<Ctx> {
    const c = await this.read(actor)
    if (c.s.course.status === 'archive') fail('Курс в архиве — доступен только для чтения')
    return c
  }

  async read(actor: Actor): Promise<Ctx> {
    if (!actor.courseId) fail('Не выбран курс')
    const s = await this.state.load(actor.courseId!)
    const me = s.users.find((u) => u.id === actor.user.id) ?? actor.user
    return { s, me, courseId: actor.courseId!, actor }
  }

  async staff(actor: Actor, msg = 'Только преподаватель или ассистент'): Promise<Ctx> {
    const c = await this.write(actor)
    if (!isStaff(c.me)) forbid(msg)
    return c
  }

  async teacher(actor: Actor, msg = 'Только преподаватель'): Promise<Ctx> {
    const c = await this.write(actor)
    if (c.me.role !== 'teacher') forbid(msg)
    return c
  }

  done(courseId: string, ...topics: string[]) {
    this.state.invalidate(courseId, topics)
  }
}
