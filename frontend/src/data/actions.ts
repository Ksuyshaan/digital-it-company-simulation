/**
 * Все изменения данных. Каждое действие получает черновик состояния и текущего пользователя
 * и либо меняет черновик, либо возвращает текст ошибки (тогда изменения отбрасываются).
 * При подключении бэкенда эти функции заменяются вызовами API с теми же проверками на сервере.
 */
import type { Card, Column, Course, CourseSettings, Message, Priority, State, SystemRole, TeamRole, User, Attachment, Assignment } from '../types'
import { COL_TITLE, PRIORITY, activeSprint, checkTeam, isLocked, isStaff, lateInfo, moveError, needsReturnComment, colIndex } from '../lib/rules'
import { DAY, HOUR, MIN, checkFile, fmtDateTime, now, shortName, uid } from '../lib/util'
import { createFormation, emailFor } from './seed'

export type Act = (s: State, me: User) => string | void

const userName = (s: State, id: string | null | undefined) => (id ? s.users.find((u) => u.id === id)?.name ?? '—' : '—')

export function audit(s: State, me: User, text: string) {
  s.audit.unshift({ id: uid('au'), at: now(), userId: me.id, text, ip: '10.12.7.88' })
}

function notify(s: State, userId: string, text: string, link: string, kind: State['notifications'][number]['kind']) {
  s.notifications.unshift({ id: uid('n'), userId, at: now(), text, link, kind })
}

function mentions(s: State, text: string, me: User, pool: string[], where: string, link: string) {
  const lower = text.toLowerCase()
  for (const id of pool) {
    if (id === me.id) continue
    const u = s.users.find((x) => x.id === id)
    if (!u) continue
    const first = u.name.split(' ')[0].toLowerCase()
    if (lower.includes('@' + first)) notify(s, id, `Вас упомянули ${where} · ${shortName(me.name)}: «${text.slice(0, 60)}»`, link, 'mention')
  }
}

/* ═════════════ Доска ═════════════ */

function canEditBoard(s: State, me: User, teamId: string): string | null {
  if (isStaff(me)) return null
  if (me.teamId !== teamId) return 'Редактировать можно только доску своей команды'
  const lock = isLocked(s, teamId)
  if (lock) return `Доска только для чтения: ${lock.reason}`
  return null
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Название', description: 'Описание', assigneeId: 'Исполнитель', deadline: 'Дедлайн', priority: 'Приоритет', sp: 'Story points', labels: 'Метки', sprintId: 'Спринт',
}

function fmtField(s: State, field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'assigneeId') return userName(s, v as string)
  if (field === 'deadline') return fmtDateTime(v as number)
  if (field === 'priority') return PRIORITY[v as Priority]
  if (field === 'labels') return (v as string[]).join(', ') || '—'
  if (field === 'sprintId') return s.sprints.find((x) => x.id === v)?.name ?? 'Backlog'
  if (field === 'description') return String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v)
  return String(v)
}

export const createCard =
  (teamId: string, f: { title: string; description?: string; assigneeId?: string | null; deadline?: number | null; priority?: Priority; sp?: number | null; labels?: string[]; inSprint?: boolean }): Act =>
  (s, me) => {
    const err = canEditBoard(s, me, teamId)
    if (err) return err
    if (!f.title.trim()) return 'Укажите название'
    if (f.title.length > 120) return 'Название — до 120 символов'
    const team = s.teams.find((t) => t.id === teamId)!
    const n = (s.cardSeq[teamId] = (s.cardSeq[teamId] ?? 0) + 1)
    const pfx = team.id === 'tm2' ? 'NL' : team.name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2).padEnd(2, 'X')
    const sprint = activeSprint(s, teamId)
    const card: Card = {
      id: uid('card'),
      key: `${pfx}-${String(n).padStart(2, '0')}`,
      teamId,
      sprintId: f.inSprint && sprint ? sprint.id : null,
      column: 'backlog',
      title: f.title.trim(),
      description: f.description ?? '',
      assigneeId: f.assigneeId ?? null,
      deadline: f.deadline ?? null,
      priority: f.priority ?? 'mid',
      sp: f.sp ?? null,
      labels: f.labels ?? [],
      checklist: [],
      files: [],
      comments: [],
      authorId: me.id,
      createdAt: now(),
    }
    s.cards.push(card)
    s.history.unshift({ id: uid('h'), cardId: card.id, teamId, userId: me.id, at: now(), field: 'Создана', from: '—', to: card.title })
    if (card.assigneeId && card.assigneeId !== me.id) notify(s, card.assigneeId, `Вас назначили исполнителем ${card.key} «${card.title}»`, `/board?card=${card.id}`, 'assign')
  }

export const updateCard =
  (cardId: string, patch: Partial<Pick<Card, 'title' | 'description' | 'assigneeId' | 'deadline' | 'priority' | 'sp' | 'labels' | 'sprintId'>>): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)
    if (!c) return 'Карточка не найдена'
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    if (patch.title !== undefined && !patch.title.trim()) return 'Название не может быть пустым'
    if (patch.title && patch.title.length > 120) return 'Название — до 120 символов'
    if (colIndex(c.column) >= 1) {
      if (patch.assigneeId === null) return 'В колонке To Do и далее у карточки должен быть исполнитель'
      if (patch.deadline === null) return 'В колонке To Do и далее у карточки должен быть дедлайн'
      if (patch.description !== undefined && !patch.description.trim()) return 'В колонке To Do и далее нужно описание'
    }
    for (const [k, v] of Object.entries(patch)) {
      const old = (c as unknown as Record<string, unknown>)[k]
      if (JSON.stringify(old) === JSON.stringify(v)) continue
      s.history.unshift({ id: uid('h'), cardId, teamId: c.teamId, userId: me.id, at: now(), field: FIELD_LABEL[k] ?? k, from: fmtField(s, k, old), to: fmtField(s, k, v) })
      ;(c as unknown as Record<string, unknown>)[k] = v
      if (k === 'assigneeId' && v && v !== me.id) notify(s, v as string, `Вас назначили исполнителем ${c.key} «${c.title}»`, `/board?card=${c.id}`, 'assign')
    }
  }

export const moveCard =
  (cardId: string, to: Column, comment?: string): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)
    if (!c) return 'Карточка не найдена'
    if (c.column === to) return
    const err = canEditBoard(s, me, c.teamId) ?? moveError(s, c, to, me)
    if (err) return err
    if (needsReturnComment(c, to) && !comment?.trim()) return 'Возврат из Review требует комментария'
    const from = c.column
    c.column = to
    if (to === 'progress' && !c.startedAt) c.startedAt = now()
    if (to === 'done') c.closedAt = now()
    if (from === 'done') c.closedAt = undefined
    if (to !== 'backlog' && !c.sprintId) {
      const sp = activeSprint(s, c.teamId)
      if (sp) c.sprintId = sp.id
    }
    s.history.unshift({ id: uid('h'), cardId, teamId: c.teamId, userId: me.id, at: now(), field: 'Колонка', from: COL_TITLE[from], to: COL_TITLE[to], note: comment })
    if (comment) c.comments.push({ id: uid('cm'), authorId: me.id, text: `Возврат в ${COL_TITLE[to]}: ${comment}`, at: now() })
    if (from === 'review' && colIndex(to) < colIndex('review') && c.assigneeId && c.assigneeId !== me.id)
      notify(s, c.assigneeId, `${c.key} вернули из Review · ${shortName(me.name)}: «${comment}»`, `/board?card=${c.id}`, 'review')
  }

export const archiveCard =
  (cardId: string): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    c.archived = true
    s.history.unshift({ id: uid('h'), cardId, teamId: c.teamId, userId: me.id, at: now(), field: 'Архив', from: COL_TITLE[c.column], to: 'в архиве' })
  }

export const restoreCard =
  (cardId: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    const c = s.cards.find((x) => x.id === cardId)!
    c.archived = false
    s.history.unshift({ id: uid('h'), cardId, teamId: c.teamId, userId: me.id, at: now(), field: 'Архив', from: 'в архиве', to: COL_TITLE[c.column] })
  }

export const commentCard =
  (cardId: string, text: string, files: Attachment[] = []): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    if (!text.trim() && !files.length) return 'Пустой комментарий'
    for (const f of files) {
      const e = checkFile(f)
      if (e) return e
    }
    c.comments.push({ id: uid('cm'), authorId: me.id, text: text.trim(), at: now(), files })
    const team = s.teams.find((t) => t.id === c.teamId)!
    mentions(s, text, me, team.memberIds, `в ${c.key}`, `/board?card=${c.id}`)
  }

export const checklistAdd =
  (cardId: string, text: string): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    if (!text.trim()) return 'Пустой пункт'
    if (c.checklist.length >= 20) return 'В чек-листе не больше 20 пунктов'
    c.checklist.push({ id: uid('ck'), text: text.trim(), done: false })
  }

export const checklistToggle =
  (cardId: string, itemId: string): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    const it = c.checklist.find((x) => x.id === itemId)!
    it.done = !it.done
    s.history.unshift({ id: uid('h'), cardId, teamId: c.teamId, userId: me.id, at: now(), field: 'Чек-лист', from: it.text, to: it.done ? 'выполнено' : 'не выполнено' })
  }

export const checklistRemove =
  (cardId: string, itemId: string): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    c.checklist = c.checklist.filter((x) => x.id !== itemId)
  }

export const attachToCard =
  (cardId: string, files: Attachment[]): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    if (c.files.length + files.length > 10) return 'К карточке можно прикрепить не больше 10 файлов'
    for (const f of files) {
      const e = checkFile(f)
      if (e) return e
    }
    c.files.push(...files)
    files.forEach((f) => s.history.unshift({ id: uid('h'), cardId, teamId: c.teamId, userId: me.id, at: now(), field: 'Файл', from: '—', to: f.name }))
  }

/* ── Спринты ── */

const isSM = (me: User, teamId: string) => isStaff(me) || (me.teamId === teamId && me.teamRole === 'Scrum Master')

export const startSprint =
  (teamId: string, f: { name: string; goal: string; start: number; end: number }): Act =>
  (s, me) => {
    if (!isSM(me, teamId)) return 'Открыть спринт может только Scrum Master команды'
    if (activeSprint(s, teamId)) return 'Активен только один спринт — сначала закройте текущий'
    if (f.goal.length > 300) return 'Цель спринта — до 300 символов'
    if (!f.name.trim() || !f.goal.trim()) return 'Укажите название и цель'
    if (f.end <= f.start) return 'Дата конца должна быть позже начала'
    const number = s.sprints.filter((x) => x.teamId === teamId).length + 1
    s.sprints.push({ id: uid('sp'), teamId, number, name: f.name, goal: f.goal, start: f.start, end: f.end, status: 'active' })
    audit(s, me, `Открыт ${f.name} · ${s.teams.find((t) => t.id === teamId)?.name}`)
  }

export const closeSprint =
  (sprintId: string, unfinished: 'backlog' | 'next'): Act =>
  (s, me) => {
    const sp = s.sprints.find((x) => x.id === sprintId)!
    if (!isSM(me, sp.teamId)) return 'Закрыть спринт может только Scrum Master'
    const cards = s.cards.filter((c) => c.sprintId === sp.id && !c.archived)
    const done = cards.filter((c) => c.column === 'done')
    const overdue = cards.filter((c) => c.deadline && ((c.closedAt && c.closedAt > c.deadline) || (!c.closedAt && c.deadline < now())))
    sp.status = 'closed'
    sp.closedAt = now()
    sp.report = {
      planned: cards.length,
      done: done.length,
      overdue: overdue.length,
      plannedSp: cards.reduce((a, c) => a + (c.sp ?? 0), 0),
      doneSp: done.reduce((a, c) => a + (c.sp ?? 0), 0),
    }
    let next: string | null = null
    if (unfinished === 'next') {
      const number = s.sprints.filter((x) => x.teamId === sp.teamId).length + 1
      const len = sp.end - sp.start
      const id = uid('sp')
      s.sprints.push({ id, teamId: sp.teamId, number, name: `Спринт ${number}`, goal: 'Цель будет уточнена на planning', start: sp.end + MIN, end: sp.end + len, status: 'active' })
      next = id
    }
    for (const c of cards.filter((x) => x.column !== 'done')) {
      c.sprintId = next
      if (!next) c.column = 'backlog'
      s.history.unshift({ id: uid('h'), cardId: c.id, teamId: c.teamId, userId: me.id, at: now(), field: 'Спринт', from: sp.name, to: next ? 'следующий спринт' : 'Backlog' })
    }
    const team = s.teams.find((t) => t.id === sp.teamId)!
    team.memberIds.forEach((id) => notify(s, id, `${sp.name} закрыт. Заполните ретроспективу в течение 48 часов`, `/board?retro=${sp.id}`, 'system'))
    audit(s, me, `Закрыт ${sp.name} · ${team.name}: сделано ${sp.report.done} из ${sp.report.planned}`)
  }

export const setCardSprint =
  (cardId: string, sprintId: string | null): Act =>
  (s, me) => {
    const c = s.cards.find((x) => x.id === cardId)!
    const err = canEditBoard(s, me, c.teamId)
    if (err) return err
    if (!sprintId && c.column !== 'backlog') return 'Вернуть в Product Backlog можно только карточку из колонки Backlog'
    if (s.settings.boardMode === 'scrum' && sprintId && !c.sp) return 'Перед переносом в спринт оцените задачу в story points'
    return updateCard(cardId, { sprintId })(s, me)
  }

export const addRetroItem =
  (sprintId: string, col: 'good' | 'bad' | 'change', text: string): Act =>
  (s, me) => {
    const sp = s.sprints.find((x) => x.id === sprintId)!
    if (me.teamId !== sp.teamId) return 'Ретроспективу заполняют участники команды'
    if (sp.status !== 'closed') return 'Ретроспектива открывается после закрытия спринта'
    if (now() - (sp.closedAt ?? sp.end) > 48 * HOUR) return 'Ретроспективу можно заполнить в течение 48 часов после закрытия спринта'
    if (!text.trim()) return 'Пустой пункт'
    let r = s.retros.find((x) => x.sprintId === sprintId)
    if (!r) {
      r = { id: uid('rt'), sprintId, teamId: sp.teamId, items: [], ratings: [] }
      s.retros.push(r)
    }
    r.items.push({ id: uid('ri'), authorId: me.id, col, text: text.trim(), at: now() })
  }

export const rateTeammates =
  (sprintId: string, ratings: Record<string, number>): Act =>
  (s, me) => {
    const sp = s.sprints.find((x) => x.id === sprintId)!
    if (me.teamId !== sp.teamId) return 'Оценивать могут только участники команды'
    let r = s.retros.find((x) => x.sprintId === sprintId)
    if (!r) {
      r = { id: uid('rt'), sprintId, teamId: sp.teamId, items: [], ratings: [] }
      s.retros.push(r)
    }
    r.ratings = r.ratings.filter((x) => x.from !== me.id)
    for (const [to, score] of Object.entries(ratings)) if (score >= 1 && score <= 5) r.ratings.push({ from: me.id, to, score })
  }

/* ═════════════ Чат ═════════════ */

export function canWrite(s: State, me: User, channelId: string) {
  const ch = s.channels.find((c) => c.id === channelId)
  if (!ch) return false
  if (ch.kind === 'general') return true
  if (ch.kind === 'announcements') return isStaff(me)
  return me.teamId === ch.teamId || me.role === 'teacher'
}

export function canRead(s: State, me: User, channelId: string) {
  const ch = s.channels.find((c) => c.id === channelId)
  if (!ch) return false
  if (ch.kind !== 'team') return true
  return isStaff(me) || me.teamId === ch.teamId
}

export const sendMessage =
  (channelId: string, text: string, parentId?: string, files: Attachment[] = []): Act =>
  (s, me) => {
    if (!canWrite(s, me, channelId)) return 'В этот канал у вас нет прав писать'
    if (!text.trim() && !files.length) return 'Пустое сообщение'
    if (text.length > 4000) return 'Сообщение — до 4000 символов'
    for (const f of files) {
      const e = checkFile(f)
      if (e) return e
    }
    const m: Message = { id: uid('m'), channelId, authorId: me.id, text: text.trim(), at: now(), reactions: {}, parentId, files }
    s.messages.push(m)
    const ch = s.channels.find((c) => c.id === channelId)!
    const pool = ch.teamId ? s.teams.find((t) => t.id === ch.teamId)!.memberIds : s.users.filter((u) => u.courseIds.includes(s.course.id)).map((u) => u.id)
    mentions(s, text, me, pool, `в #${ch.name}`, ch.kind === 'team' && !isStaff(me) ? '/chat' : `/channels/${ch.id}`)
  }

export const editMessage =
  (id: string, text: string): Act =>
  (s, me) => {
    const m = s.messages.find((x) => x.id === id)!
    if (m.authorId !== me.id) return 'Редактировать можно только свои сообщения'
    if (now() - m.at > 15 * MIN) return 'Редактировать можно в течение 15 минут после отправки'
    if (!text.trim()) return 'Пустое сообщение'
    if (text.length > 4000) return 'Сообщение — до 4000 символов'
    if (m.originalText === undefined) m.originalText = m.text
    m.text = text.trim()
    m.editedAt = now()
  }

export const deleteMessage =
  (id: string): Act =>
  (s, me) => {
    const m = s.messages.find((x) => x.id === id)!
    if (m.authorId !== me.id && !isStaff(me)) return 'Удалять можно только свои сообщения'
    m.deletedAt = now()
    if (isStaff(me) && m.authorId !== me.id) audit(s, me, `Скрыто сообщение ${userName(s, m.authorId)} в #${s.channels.find((c) => c.id === m.channelId)?.name}`)
  }

export const react =
  (id: string, emoji: string): Act =>
  (s, me) => {
    const m = s.messages.find((x) => x.id === id)!
    if (!canRead(s, me, m.channelId)) return 'Нет доступа'
    const arr = m.reactions[emoji] ?? []
    m.reactions[emoji] = arr.includes(me.id) ? arr.filter((x) => x !== me.id) : [...arr, me.id]
    if (!m.reactions[emoji].length) delete m.reactions[emoji]
  }

/* ═════════════ Профиль, баллы ═════════════ */

export const updateProfile =
  (p: Pick<User, 'about' | 'skills' | 'wantedRoles' | 'links'> & { photo?: string }): Act =>
  (s, me) => {
    if (!p.about.trim()) return 'Заполните поле «О себе»'
    if (p.about.length > 500) return '«О себе» — до 500 символов'
    if (p.skills.length < 3 || p.skills.length > 15) return 'Навыков должно быть от 3 до 15'
    if (p.wantedRoles.length < 1 || p.wantedRoles.length > 2) return 'Выберите 1–2 желаемые роли'
    if (p.links.length > 5) return 'Не больше 5 ссылок'
    for (const l of p.links) if (!/^https?:\/\/\S+\.\S+/.test(l.url)) return `Некорректная ссылка: ${l.url || '(пусто)'}`
    const u = s.users.find((x) => x.id === me.id)!
    Object.assign(u, p)
    if (!u.profileFilledAt) u.profileFilledAt = now()
  }

export const adjustPoints =
  (studentId: string, component: 'A' | 'K' | 'P', delta: number, reason: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Начислять баллы может только преподаватель или ассистент'
    if (!reason.trim()) return 'Укажите причину — она попадёт в журнал и будет видна студенту'
    if (!delta) return 'Укажите количество баллов'
    const u = s.users.find((x) => x.id === studentId)!
    s.adjustments.unshift({ id: uid('adj'), studentId, component, delta, reason: reason.trim(), byId: me.id, at: now() })
    audit(s, me, `Ручное ${delta > 0 ? 'начисление' : 'списание'} ${delta > 0 ? '+' : ''}${delta} (${component}) · ${shortName(u.name)} · «${reason.trim()}»`)
    notify(s, studentId, `${delta > 0 ? 'Начислено' : 'Списано'} ${delta > 0 ? '+' : ''}${delta} балл. · «${reason.trim()}»`, '/profile', 'grade')
  }

export const setProjectAdjust =
  (studentId: string, pct: number, reason: string): Act =>
  (s, me) => {
    if (me.role !== 'teacher') return 'Изменять итоговые баллы проекта может только преподаватель'
    if (Math.abs(pct) > 20) return 'Изменить балл проекта можно не более чем на 20%'
    if (!reason.trim()) return 'Укажите причину'
    const u = s.users.find((x) => x.id === studentId)!
    u.projectAdjust = pct / 100
    audit(s, me, `Балл проекта ${shortName(u.name)}: ${pct > 0 ? '+' : ''}${pct}% · «${reason.trim()}»`)
    notify(s, studentId, `Балл за проект изменён на ${pct > 0 ? '+' : ''}${pct}% · «${reason.trim()}»`, '/profile', 'grade')
  }

export const setProjectScore =
  (teamId: string, score: number): Act =>
  (s, me) => {
    if (me.role !== 'teacher') return 'Только преподаватель'
    if (score < 0 || score > 60) return 'Балл за проект — от 0 до 60'
    const t = s.teams.find((x) => x.id === teamId)!
    t.projectScore = score
    audit(s, me, `Балл проекта команды ${t.name}: ${score}`)
  }

export const grantBadge =
  (userId: string, key: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    if (s.manualBadges.some((b) => b.userId === userId && b.key === key)) return 'Достижение уже выдано'
    s.manualBadges.push({ userId, key })
    audit(s, me, `Выдано достижение «${key}» · ${userName(s, userId)}`)
  }

/* ═════════════ Задания и peer-review ═════════════ */

export const createAssignment =
  (a: Omit<Assignment, 'id'>): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Создавать задания может преподаватель'
    if (!a.title.trim()) return 'Укажите название'
    if (a.deadline <= a.openAt) return 'Дедлайн должен быть позже даты открытия'
    if (!a.criteria.length) return 'Добавьте хотя бы один критерий'
    const total = a.criteria.reduce((x, c) => x + c.points, 0)
    if (total !== a.maxScore) return `Сумма баллов критериев (${total}) должна совпадать с максимальным баллом (${a.maxScore})`
    s.assignments.push({ ...a, id: uid('a') })
    s.users.filter((u) => u.role === 'student' && u.courseIds.includes(s.course.id)).forEach((u) => notify(s, u.id, `Новое задание: «${a.title}»`, '/assignments', 'system'))
    audit(s, me, `Создано задание «${a.title}»`)
  }

export const submitWork =
  (assignmentId: string, content: string): Act =>
  (s, me) => {
    const a = s.assignments.find((x) => x.id === assignmentId)!
    if (me.role !== 'student') return 'Сдавать работы могут студенты'
    if (!content.trim()) return 'Добавьте ответ'
    if (a.format === 'link' && !/^https?:\/\//.test(content.trim())) return 'Нужна ссылка, начинающаяся с http(s)://'
    if (now() < a.openAt) return 'Задание ещё не открыто'
    const lock = isLocked(s, undefined, a.id)
    if (lock || a.locked) return `Задание только для чтения${lock ? `: ${lock.reason}` : ''}`
    let sub = s.submissions.find((x) => x.assignmentId === a.id && x.studentId === me.id)
    const info = lateInfo(a, sub, s)
    if (now() > info.closeAt) return 'Сдача закрыта: прошло 72 часа после дедлайна. Обратитесь к преподавателю за продлением'
    if (sub && sub.reviews.length && now() > info.deadline) return 'После назначения рецензентов пересдать работу нельзя'
    if (!sub) {
      sub = { id: uid('s'), assignmentId: a.id, studentId: me.id, versions: [], reviews: [] }
      s.submissions.push(sub)
    }
    sub.versions.push({ at: now(), content: content.trim() })
  }

export const gradeWork =
  (subId: string, scores: number[], comment: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Оценивает преподаватель'
    const sub = s.submissions.find((x) => x.id === subId)!
    const a = s.assignments.find((x) => x.id === sub.assignmentId)!
    for (const [i, c] of a.criteria.entries()) if (scores[i] < 0 || scores[i] > c.points || Number.isNaN(scores[i])) return `Критерий «${c.text}»: от 0 до ${c.points}`
    sub.teacherScores = scores
    sub.teacherComment = comment
    sub.gradedAt = now()
    notify(s, sub.studentId, `Работа «${a.title}» оценена`, '/assignments', 'grade')
    audit(s, me, `Оценка за «${a.title}» · ${userName(s, sub.studentId)}: ${scores.reduce((x, y) => x + y, 0)} из ${a.maxScore}`)
  }

export const extendFor =
  (assignmentId: string, studentId: string, until: number): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    let sub = s.submissions.find((x) => x.assignmentId === assignmentId && x.studentId === studentId)
    if (!sub) {
      sub = { id: uid('s'), assignmentId, studentId, versions: [], reviews: [] }
      s.submissions.push(sub)
    }
    sub.extensionUntil = until
    notify(s, studentId, `Срок сдачи продлён до ${fmtDateTime(until)}`, '/assignments', 'system')
    audit(s, me, `Продление срока до ${fmtDateTime(until)} · ${userName(s, studentId)}`)
  }

/** После дедлайна каждой сданной работе случайно назначаются 2 рецензента из сдавших (не сам автор) */
export function assignReviewers(s: State, a: Assignment) {
  const subs = s.submissions.filter((x) => x.assignmentId === a.id && x.versions.length)
  if (subs.length < 3) return
  const authors = subs.map((x) => x.studentId)
  const shuffled = [...authors].sort(() => Math.random() - 0.5)
  const load = new Map<string, number>()
  for (const sub of subs) {
    if (sub.reviews.length >= 2) continue
    const cand = shuffled.filter((id) => id !== sub.studentId && !sub.reviews.some((r) => r.reviewerId === id)).sort((x, y) => (load.get(x) ?? 0) - (load.get(y) ?? 0))
    for (const rid of cand.slice(0, 2 - sub.reviews.length)) {
      load.set(rid, (load.get(rid) ?? 0) + 1)
      sub.reviews.push({ id: uid('rv'), reviewerId: rid, scores: null, comment: '', assignedAt: now() })
      notify(s, rid, `Вам назначена анонимная проверка работы по «${a.title}» · 48 часов`, '/assignments', 'review')
    }
  }
}

export const runReviewAssignment =
  (assignmentId: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    const a = s.assignments.find((x) => x.id === assignmentId)!
    if (!a.peerReview) return 'Для задания выключен peer-review'
    if (now() < a.deadline) return 'Рецензенты назначаются после дедлайна'
    assignReviewers(s, a)
  }

export const submitReview =
  (subId: string, reviewId: string, scores: number[], comment: string): Act =>
  (s, me) => {
    const sub = s.submissions.find((x) => x.id === subId)!
    const r = sub.reviews.find((x) => x.id === reviewId)!
    const a = s.assignments.find((x) => x.id === sub.assignmentId)!
    if (r.reviewerId !== me.id) return 'Это не ваша проверка'
    if (r.scores) return 'Проверка уже отправлена'
    if (now() - r.assignedAt > 48 * HOUR) return 'Срок проверки (48 часов) истёк'
    if (comment.trim().length < 100) return `Комментарий — не короче 100 символов (сейчас ${comment.trim().length})`
    for (const [i, c] of a.criteria.entries()) if (scores[i] < 0 || scores[i] > c.points || Number.isNaN(scores[i])) return `Критерий «${c.text}»: от 0 до ${c.points}`
    r.scores = scores
    r.comment = comment.trim()
    r.doneAt = now()
    notify(s, sub.studentId, `Вашу работу «${a.title}» проверил рецензент`, '/assignments', 'review')
  }

export const disputeReview =
  (subId: string, reviewId: string, reason: string): Act =>
  (s, me) => {
    const sub = s.submissions.find((x) => x.id === subId)!
    const r = sub.reviews.find((x) => x.id === reviewId)!
    if (sub.studentId !== me.id) return 'Оспорить может только автор работы'
    if (!r.doneAt || now() - r.doneAt > 48 * HOUR) return 'Оспорить рецензию можно в течение 48 часов'
    if (!reason.trim()) return 'Опишите причину'
    r.disputed = { reason: reason.trim(), at: now() }
    s.users.filter((u) => u.role === 'teacher' && u.courseIds.includes(s.course.id)).forEach((u) => notify(s, u.id, `Оспорена рецензия · ${shortName(me.name)}`, '/assignments', 'review'))
  }

export const resolveDispute =
  (subId: string, reviewId: string, resolution: 'kept' | 'removed'): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Решение принимает преподаватель'
    const sub = s.submissions.find((x) => x.id === subId)!
    const r = sub.reviews.find((x) => x.id === reviewId)!
    if (!r.disputed) return 'Спора нет'
    r.disputed.resolution = resolution
    notify(s, sub.studentId, `Спор по рецензии рассмотрен: ${resolution === 'removed' ? 'рецензия исключена из оценки' : 'рецензия оставлена'}`, '/assignments', 'review')
    audit(s, me, `Спор по рецензии · ${userName(s, sub.studentId)}: ${resolution === 'removed' ? 'исключена' : 'оставлена'}`)
  }

/* ═════════════ Команды ═════════════ */

const formationTeamOf = (s: State, userId: string) => s.formation?.teams.find((t) => t.memberIds.includes(userId))

export const startFormationDemo: Act = (s, me) => {
  s.formation = createFormation(s)
  audit(s, me, 'Открыто окно формирования команд (демо-сценарий)')
}

export const endFormationDemo: Act = (s, me) => {
  s.formation = null
  audit(s, me, 'Сценарий формирования команд завершён')
}

function formationOpen(s: State) {
  if (!s.formation) return 'Окно формирования команд закрыто'
  if (now() > s.formation.deadline) return 'Окно формирования закрыто, составы меняет только преподаватель'
  return null
}

export const createDraftTeam =
  (name: string, idea: string): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e) return e
    if (formationTeamOf(s, me.id)) return 'Вы уже состоите в команде'
    if (!name.trim() || !idea.trim()) return 'Укажите название и идею проекта'
    if (s.formation!.teams.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) return 'Команда с таким названием уже есть'
    s.formation!.teams.push({ id: uid('ft'), name: name.trim(), idea: idea.trim(), initiatorId: me.id, memberIds: [me.id], status: 'draft', projectScore: 0, channelId: '', roles: { [me.id]: 'Team Lead' } })
    s.formation!.requests = s.formation!.requests.filter((r) => r.studentId !== me.id)
  }

export const requestJoin =
  (teamId: string): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e) return e
    if (formationTeamOf(s, me.id)) return 'Студент состоит только в одной команде'
    const mine = s.formation!.requests.filter((r) => r.studentId === me.id && r.kind === 'request')
    if (mine.length >= 3) return 'Не больше 3 активных заявок'
    if (mine.some((r) => r.teamId === teamId)) return 'Заявка уже отправлена'
    s.formation!.requests.push({ id: uid('rq'), teamId, studentId: me.id, kind: 'request', at: now() })
    const t = s.formation!.teams.find((x) => x.id === teamId)!
    notify(s, t.initiatorId, `Новая заявка в ${t.name} · ${shortName(me.name)}`, '/teams', 'team')
  }

export const inviteStudent =
  (teamId: string, studentId: string): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e) return e
    const t = s.formation!.teams.find((x) => x.id === teamId)!
    if (t.initiatorId !== me.id && !isStaff(me)) return 'Приглашать может инициатор команды'
    if (formationTeamOf(s, studentId)) return 'Студент уже в команде'
    if (s.formation!.requests.some((r) => r.teamId === teamId && r.studentId === studentId)) return 'Приглашение уже отправлено'
    if (t.memberIds.length >= s.settings.teamMax) return `В команде уже ${s.settings.teamMax} человек`
    s.formation!.requests.push({ id: uid('rq'), teamId, studentId, kind: 'invite', at: now() })
    notify(s, studentId, `Вас пригласили в команду ${t.name}`, '/teams', 'team')
  }

export const answerRequest =
  (reqId: string, accept: boolean): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e) return e
    const f = s.formation!
    const rq = f.requests.find((r) => r.id === reqId)!
    const t = f.teams.find((x) => x.id === rq.teamId)!
    if (rq.kind === 'request' && t.initiatorId !== me.id && !isStaff(me)) return 'Заявку принимает инициатор команды'
    if (rq.kind === 'invite' && rq.studentId !== me.id) return 'Приглашение принимает сам студент'
    f.requests = f.requests.filter((r) => r.id !== reqId)
    if (!accept) {
      notify(s, rq.kind === 'request' ? rq.studentId : t.initiatorId, `${rq.kind === 'request' ? 'Заявка в' : 'Приглашение в'} ${t.name} отклонено`, '/teams', 'team')
      return
    }
    if (formationTeamOf(s, rq.studentId)) return 'Студент уже в другой команде'
    if (t.memberIds.length >= s.settings.teamMax) return `В команде максимум ${s.settings.teamMax} человек`
    t.memberIds.push(rq.studentId)
    t.roles = { ...t.roles, [rq.studentId]: (s.users.find((u) => u.id === rq.studentId)?.wantedRoles[0] as TeamRole) ?? 'Developer' }
    if (t.status !== 'draft') t.status = 'draft'
    f.requests = f.requests.filter((r) => r.studentId !== rq.studentId)
    notify(s, rq.studentId, `Вы в команде ${t.name}`, '/teams', 'team')
  }

export const setMemberRole =
  (teamId: string, studentId: string, role: TeamRole): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e && !isStaff(me)) return e
    const t = s.formation!.teams.find((x) => x.id === teamId)!
    if (t.initiatorId !== me.id && !isStaff(me)) return 'Роли распределяет инициатор команды'
    t.roles = { ...t.roles, [studentId]: role }
    if (t.status === 'pending' || t.status === 'returned') t.status = 'draft'
  }

export const removeFromDraft =
  (teamId: string, studentId: string): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e && !isStaff(me)) return e
    const t = s.formation!.teams.find((x) => x.id === teamId)!
    if (t.initiatorId !== me.id && studentId !== me.id && !isStaff(me)) return 'Нет прав'
    if (studentId === t.initiatorId && t.memberIds.length > 1 && !isStaff(me)) return 'Инициатор не может выйти, пока в команде есть участники'
    t.memberIds = t.memberIds.filter((x) => x !== studentId)
    if (t.roles) delete t.roles[studentId]
    if (!t.memberIds.length) s.formation!.teams = s.formation!.teams.filter((x) => x.id !== teamId)
    t.status = 'draft'
  }

export const submitTeam =
  (teamId: string): Act =>
  (s, me) => {
    const e = formationOpen(s)
    if (e) return e
    const t = s.formation!.teams.find((x) => x.id === teamId)!
    if (t.initiatorId !== me.id) return 'Отправляет инициатор'
    const bad = checkTeam(s, t, t.roles ?? {}).filter((c) => !c.ok)
    if (bad.length) return `Не выполнено правило: ${bad[0].label}`
    t.status = 'pending'
    s.users.filter((u) => u.role === 'teacher' && u.courseIds.includes(s.course.id)).forEach((u) => notify(s, u.id, `Команда ${t.name} отправлена на утверждение`, '/teacher/teams', 'team'))
  }

export const reviewTeam =
  (teamId: string, decision: 'approve' | 'return' | 'override', comment = ''): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Утверждает преподаватель'
    const t = s.formation!.teams.find((x) => x.id === teamId)!
    if (decision === 'return') {
      if (!comment.trim()) return 'Напишите комментарий, что исправить'
      t.status = 'returned'
      t.returnComment = comment
    } else if (decision === 'override') {
      if (!comment.trim()) return 'Укажите причину утверждения в обход правил'
      t.status = 'approved'
      t.approvedOverride = comment
    } else {
      const bad = checkTeam(s, t, t.roles ?? {}).filter((c) => !c.ok)
      if (bad.length) return `Нарушено правило: ${bad[0].label}. Можно утвердить в обход правил с причиной`
      t.status = 'approved'
    }
    t.memberIds.forEach((id) => notify(s, id, `Команда ${t.name}: ${t.status === 'approved' ? 'состав утверждён' : `возвращена — «${comment}»`}`, '/teams', 'team'))
    audit(s, me, `Команда ${t.name}: ${decision === 'approve' ? 'утверждена' : decision === 'override' ? `утверждена в обход правил («${comment}»)` : `возвращена («${comment}»)`}`)
  }

/** Распределить студентов без команды по неполным командам */
export const autoDistribute: Act = (s, me) => {
  if (!isStaff(me)) return 'Только преподаватель'
  const f = s.formation!
  const inTeam = new Set(f.teams.flatMap((t) => t.memberIds))
  const free = s.users.filter((u) => u.role === 'student' && u.courseIds.includes(s.course.id) && !inTeam.has(u.id))
  let moved = 0
  for (const u of free) {
    const target = [...f.teams].filter((t) => t.memberIds.length < s.settings.teamMax).sort((a, b) => a.memberIds.length - b.memberIds.length)[0]
    if (!target) break
    target.memberIds.push(u.id)
    target.roles = { ...target.roles, [u.id]: (u.wantedRoles.find((r) => r !== 'Team Lead' && r !== 'Scrum Master') as TeamRole) ?? 'Developer' }
    moved++
  }
  audit(s, me, `Автораспределение: ${moved} студентов добавлены в неполные команды`)
  if (!moved) return 'Нет свободных мест в командах — создайте новую команду вручную'
}

export const freezeTeams: Act = (s, me) => {
  if (me.role !== 'teacher') return 'Замораживает составы преподаватель'
  const f = s.formation!
  const pending = f.teams.filter((t) => t.status !== 'approved')
  if (pending.length) return `Не утверждено команд: ${pending.length}. Утвердите или верните их`
  audit(s, me, `Составы команд заморожены (${f.teams.length} команд)`)
  s.formation = null
}

export const moveStudentTeam =
  (studentId: string, teamId: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'После заморозки составы меняет только преподаватель'
    const u = s.users.find((x) => x.id === studentId)!
    const from = s.teams.find((t) => t.id === u.teamId)
    const to = s.teams.find((t) => t.id === teamId)!
    if (to.memberIds.length >= s.settings.teamMax) return `В команде ${to.name} уже ${s.settings.teamMax} человек`
    if (from) from.memberIds = from.memberIds.filter((x) => x !== studentId)
    to.memberIds.push(studentId)
    u.teamId = teamId
    if (u.teamRole === 'Team Lead' || u.teamRole === 'Scrum Master') u.teamRole = 'Developer'
    audit(s, me, `${shortName(u.name)}: ${from?.name ?? 'без команды'} → ${to.name}`)
  }

export const setTeamRole =
  (studentId: string, role: TeamRole): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    const u = s.users.find((x) => x.id === studentId)!
    u.teamRole = role
    audit(s, me, `Роль ${shortName(u.name)} → ${role}`)
  }

export const renameTeam =
  (teamId: string, name: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    if (!name.trim()) return 'Пустое название'
    const t = s.teams.find((x) => x.id === teamId)!
    audit(s, me, `Команда ${t.name} переименована в ${name}`)
    t.name = name.trim()
    const ch = s.channels.find((c) => c.id === t.channelId)
    if (ch) ch.name = name.trim().toLowerCase().replace(/\s+/g, '-')
  }

/* ═════════════ Преподаватель: блокировки, сигналы, настройки ═════════════ */

export const addLock =
  (scope: 'all' | 'team' | 'assignment', targetId: string | undefined, reason: string, from: number): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    if (!reason.trim()) return 'Укажите причину — её увидят студенты на баннере'
    s.locks.push({ id: uid('lk'), scope, targetId, reason: reason.trim(), from, createdBy: me.id })
    const what = scope === 'all' ? 'все доски' : scope === 'team' ? `доска ${s.teams.find((t) => t.id === targetId)?.name}` : `задание «${s.assignments.find((a) => a.id === targetId)?.title}»`
    audit(s, me, `Блокировка: ${what} с ${fmtDateTime(from)} · «${reason.trim()}»`)
  }

export const cancelLock =
  (id: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    const l = s.locks.find((x) => x.id === id)!
    l.cancelled = true
    audit(s, me, `Блокировка снята · «${l.reason}»`)
  }

export const dismissSignal =
  (id: string): Act =>
  (s, me) => {
    if (!isStaff(me)) return 'Только преподаватель'
    s.dismissedSignals.push(id)
  }

export const updateSettings =
  (patch: Partial<CourseSettings>, course?: Partial<Course>): Act =>
  (s, me) => {
    if (me.role !== 'teacher') return 'Изменять настройки курса может только преподаватель'
    const next = { ...s.settings, ...patch }
    if (Math.abs(next.teacherWeight + next.peerWeight - 1) > 0.001) return 'Сумма весов преподавателя и рецензентов должна быть равна 1'
    if (next.teamMin > next.teamMax) return 'Минимальный размер команды больше максимального'
    s.settings = next
    if (course) Object.assign(s.course, course)
    audit(s, me, 'Изменены настройки курса')
  }

export const markNotificationsRead: Act = (s, me) => {
  s.notifications.filter((n) => n.userId === me.id).forEach((n) => (n.read = true))
}

/* ═════════════ Администратор ═════════════ */

const ROLE_RU: Record<SystemRole, string> = { student: 'Студент', teacher: 'Преподаватель', assistant: 'Ассистент', admin: 'Администратор' }

export const setUserRole =
  (userId: string, role: SystemRole): Act =>
  (s, me) => {
    if (me.role !== 'admin') return 'Роли выдаёт администратор'
    const u = s.users.find((x) => x.id === userId)!
    if (u.id === me.id) return 'Нельзя изменить свою роль'
    audit(s, me, `${shortName(u.name)}: ${ROLE_RU[u.role]} → ${ROLE_RU[role]}`)
    u.role = role
  }

export const toggleBlock =
  (userId: string): Act =>
  (s, me) => {
    if (me.role !== 'admin') return 'Только администратор'
    const u = s.users.find((x) => x.id === userId)!
    if (u.id === me.id) return 'Нельзя заблокировать себя'
    u.blocked = !u.blocked
    audit(s, me, `${shortName(u.name)}: ${u.blocked ? 'заблокирован' : 'разблокирован'}`)
  }

export const addUser =
  (f: { name: string; email: string; group: string; role: SystemRole; courseId?: string }): Act =>
  (s, me) => {
    if (me.role !== 'admin') return 'Только администратор'
    if (!f.name.trim()) return 'Укажите ФИО'
    const email = f.email.trim().toLowerCase() || emailFor(f.name)
    if (!email.endsWith('@' + s.admin.domain)) return `Почта должна быть в домене @${s.admin.domain}`
    if (s.users.some((u) => u.email === email)) return 'Пользователь с такой почтой уже есть'
    s.users.push({ id: uid('u'), name: f.name.trim(), email, group: f.group, role: f.role, about: '', skills: [], wantedRoles: [], links: [], lastActiveAt: 0, courseIds: f.courseId ? [f.courseId] : [], rdWeekAgo: 0 })
    audit(s, me, `Добавлен пользователь ${f.name.trim()} (${ROLE_RU[f.role]})`)
  }

export const importUsers =
  (rows: { name: string; email: string; group: string }[], courseId: string, fileName: string): Act =>
  (s, me) => {
    if (me.role !== 'admin') return 'Только администратор'
    let added = 0
    for (const r of rows) {
      const email = r.email.trim().toLowerCase()
      if (!r.name.trim() || !email.endsWith('@' + s.admin.domain) || s.users.some((u) => u.email === email)) continue
      s.users.push({ id: uid('u'), name: r.name.trim(), email, group: r.group, role: 'student', about: '', skills: [], wantedRoles: [], links: [], lastActiveAt: 0, courseIds: [courseId], rdWeekAgo: 0 })
      added++
    }
    audit(s, me, `Импорт ${added} студентов из ${fileName}`)
    if (!added) return `Не найдено новых студентов с почтой @${s.admin.domain}`
  }

export const createCourse =
  (f: { name: string; stream: string; start: number; teacherId: string }): Act =>
  (s, me) => {
    if (me.role !== 'admin' && me.role !== 'teacher') return 'Создать курс может преподаватель или администратор'
    if (!f.name.trim() || !f.stream.trim()) return 'Укажите название и поток'
    s.courses.push({ id: uid('c'), name: f.name.trim(), stream: f.stream.trim(), start: f.start, weeks: 15, teacherId: f.teacherId, status: 'active', studentsCount: 0 })
    audit(s, me, `Создан курс ${f.name} · ${f.stream}`)
  }

export const updateAdmin =
  (patch: Partial<State['admin']>): Act =>
  (s, me) => {
    if (me.role !== 'admin') return 'Только администратор'
    s.admin = { ...s.admin, ...patch }
    audit(s, me, `Изменены настройки входа: ${Object.keys(patch).join(', ')}`)
  }

export const backupNow: Act = (s, me) => {
  if (me.role !== 'admin') return 'Только администратор'
  s.admin.lastBackup = now()
  s.audit.unshift({ id: uid('au'), at: now(), userId: 'system', text: 'Резервная копия создана вручную · 41,3 ГБ', ip: 'system' })
}

/* ═════════════ Служебное ═════════════ */

/** Автоматика, которая на сервере работала бы по расписанию */
export function housekeeping(s: State): boolean {
  let changed = false
  for (const a of s.assignments) {
    if (!a.peerReview || now() < a.deadline || now() > a.deadline + 7 * DAY) continue
    const subs = s.submissions.filter((x) => x.assignmentId === a.id && x.versions.length)
    if (subs.length >= 3 && subs.some((x) => x.reviews.length < 2)) {
      assignReviewers(s, a)
      changed = true
    }
  }
  return changed
}

export { ROLE_RU }
