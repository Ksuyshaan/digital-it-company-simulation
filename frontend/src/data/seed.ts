/**
 * Демо-данные курса «Лидерство в IT · Поток 2026-1».
 * Все даты считаются от момента первого запуска: сейчас идёт 11 неделя, 4-й день спринта 2.
 * Детерминированный генератор — у всех одинаковые данные.
 */
import type {
  Assignment, Card, Channel, Column, Course, HistoryEntry, Message, Retro, Sprint, State, Submission, Team, TeamRole, User,
} from '../types'
import { DAY, HOUR, MIN, WEEK, startOfDay } from '../lib/util'
import { allScores } from '../lib/rules'

export const STATE_VERSION = 3

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST_M = ['Алихан', 'Санжар', 'Ерлан', 'Данияр', 'Тимур', 'Руслан', 'Бекзат', 'Арман', 'Нурлан', 'Ержан', 'Асхат', 'Дамир', 'Еркебулан', 'Мирас', 'Олжас', 'Батыр', 'Азамат', 'Ильяс', 'Максат', 'Айдос', 'Жандос', 'Абылай', 'Диас', 'Темирлан']
const FIRST_F = ['Айгерим', 'Дана', 'Мадина', 'Карина', 'Аружан', 'Асель', 'Жанель', 'Алия', 'Динара', 'Камила', 'Томирис', 'Аяулым', 'Сабина', 'Индира', 'Акбота', 'Зарина', 'Малика', 'Дильназ', 'Айжан', 'Гульназ', 'Анель', 'Мерей']
const LAST = ['Сапаров', 'Ахметов', 'Ержанов', 'Жумабеков', 'Омаров', 'Исаев', 'Бекетов', 'Мусин', 'Тлеуов', 'Нурланов', 'Каримов', 'Мухамеджанов', 'Сейтов', 'Абенов', 'Касымов', 'Тулегенов', 'Есенов', 'Утебаев', 'Садыков', 'Бакиров', 'Жаксылыков', 'Оспанов', 'Кенжебаев', 'Рахимов', 'Шарипов', 'Байжанов', 'Темиров', 'Аманов']
const fem = (last: string) => (/(ов|ев|ин)$/.test(last) ? last + 'а' : last)

const SKILLS = ['Product analytics', 'Figma', 'SQL', 'Jira', 'Python', 'Публичные выступления', 'React', 'TypeScript', 'Node.js', 'Selenium', 'Postman', 'BPMN', 'Excel', 'UX-исследования', 'Illustrator', 'Agile', 'Java', 'Go', 'Docker', 'Git', 'Tableau', 'Scrum', 'Kotlin', 'Swift', 'PostgreSQL', 'Тестирование API', 'Copywriting']
const ROLE_POOL: TeamRole[] = ['Team Lead', 'Scrum Master', 'Developer', 'Analyst', 'Designer', 'QA']

const TEAM_DEFS: { name: string; idea: string; size: number; done: number; overdue: number; skew: number; msgs: number; silent: number; retro1: boolean }[] = [
  { name: 'ByteForge', idea: 'Трекер привычек для студентов', size: 5, done: 0.91, overdue: 0, skew: 0, msgs: 64, silent: 0, retro1: true },
  { name: 'Nomad Labs', idea: 'Сервис записи в студенческие клубы', size: 4, done: 0, overdue: 0, skew: 0, msgs: 38, silent: 0, retro1: true },
  { name: 'Steppe Soft', idea: 'Бронирование переговорных в кампусе', size: 4, done: 0.73, overdue: 1, skew: 0, msgs: 41, silent: 0, retro1: true },
  { name: 'Orda Dev', idea: 'Маркетплейс репетиторов', size: 5, done: 0.5, overdue: 4, skew: 0.58, msgs: 17, silent: 0, retro1: false },
  { name: 'Qazaq Code', idea: 'Казахский словарь IT-терминов', size: 3, done: 0.43, overdue: 3, skew: 0.47, msgs: 6, silent: 3.4, retro1: true },
  { name: 'Silk Road IT', idea: 'Карта стажировок для студентов', size: 4, done: 0.64, overdue: 1, skew: 0, msgs: 29, silent: 0, retro1: true },
  { name: 'Altyn Apps', idea: 'Учёт расходов общежития', size: 5, done: 0.7, overdue: 1, skew: 0, msgs: 33, silent: 0, retro1: true },
  { name: 'Tumar Tech', idea: 'Чат-бот приёмной комиссии', size: 5, done: 0.62, overdue: 2, skew: 0, msgs: 27, silent: 0, retro1: true },
  { name: 'Baiterek Digital', idea: 'Платформа волонтёрства', size: 5, done: 0.8, overdue: 0, skew: 0, msgs: 45, silent: 0, retro1: true },
  { name: 'Kokpar Studio', idea: 'Мобильная игра про историю', size: 5, done: 0.55, overdue: 2, skew: 0, msgs: 22, silent: 0, retro1: true },
  { name: 'Aral Systems', idea: 'Мониторинг качества воды', size: 5, done: 0.68, overdue: 1, skew: 0, msgs: 31, silent: 0, retro1: true },
  { name: 'Tengri Lab', idea: 'Расписание с уведомлениями', size: 5, done: 0.75, overdue: 0, skew: 0, msgs: 36, silent: 0, retro1: true },
  { name: 'Saryarka Soft', idea: 'Обмен учебниками', size: 5, done: 0.6, overdue: 1, skew: 0, msgs: 24, silent: 0, retro1: true },
  { name: 'Zhetysu Dev', idea: 'Поиск попутчиков до кампуса', size: 4, done: 0.66, overdue: 1, skew: 0, msgs: 28, silent: 0, retro1: true },
  { name: 'Khan Tengri', idea: 'Тренажёр собеседований', size: 4, done: 0.72, overdue: 1, skew: 0, msgs: 30, silent: 0, retro1: true },
  { name: 'Alatau Cloud', idea: 'Хранилище конспектов', size: 4, done: 0.58, overdue: 2, skew: 0, msgs: 19, silent: 0, retro1: true },
  { name: 'Ertis Data', idea: 'Дашборд успеваемости', size: 4, done: 0.77, overdue: 0, skew: 0, msgs: 34, silent: 0, retro1: true },
  { name: 'Shanyrak Team', idea: 'Сервис аренды жилья для студентов', size: 4, done: 0.63, overdue: 1, skew: 0, msgs: 26, silent: 0, retro1: true },
  { name: 'Esil Works', idea: 'Таймер помодоро для групп', size: 4, done: 0.7, overdue: 1, skew: 0, msgs: 25, silent: 0, retro1: true },
  { name: 'Kazygurt Labs', idea: 'Каталог студенческих стартапов', size: 4, done: 0.52, overdue: 2, skew: 0, msgs: 18, silent: 0, retro1: true },
  { name: 'Burabay Code', idea: 'Экотрекер кампуса', size: 4, done: 0.69, overdue: 1, skew: 0, msgs: 23, silent: 0, retro1: true },
  { name: 'Turan Pixel', idea: 'Генератор портфолио', size: 4, done: 0.6, overdue: 1, skew: 0, msgs: 21, silent: 0, retro1: true },
]

/** Именованные студенты из макетов: команда → [имя, роль, «сила»] */
const NAMED: Record<string, [string, TeamRole, number][]> = {
  ByteForge: [['Алихан Жумабеков', 'Team Lead', 0.97], ['Дана Омарова', 'Scrum Master', 0.94]],
  'Nomad Labs': [['Айгерим Сапарова', 'Team Lead', 0.8], ['Данияр Ахметов', 'Scrum Master', 0.66], ['Мадина Ержанова', 'Developer', 0.92], ['Тимур Ким', 'QA', 0.5]],
  'Steppe Soft': [['Санжар Исаев', 'Scrum Master', 0.9]],
  'Orda Dev': [['Ерлан Бекетов', 'Developer', 0.82], ['Карина Ли', 'Scrum Master', 0.88]],
  'Qazaq Code': [['Асылбек Мусин', 'Scrum Master', 0.6], ['Руслан Мухамеджанов', 'Developer', 0.52]],
  'Silk Road IT': [['Мадияр Ким', 'Scrum Master', 0.7]],
  'Altyn Apps': [['Аружан Тлеуова', 'Designer', 0.62], ['Бекзат Нурлан', 'Scrum Master', 0.68]],
  'Tumar Tech': [['Асель Каримова', 'QA', 0.73], ['Жанель Сейтова', 'Analyst', 0.64]],
}

export const DOMAIN = 'university.kz'

const translit = (s: string) => {
  const m: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '' }
  return s.toLowerCase().split('').map((c) => m[c] ?? c).join('')
}
export const emailFor = (name: string) => {
  const [f, l] = name.split(' ')
  return `${translit(f[0])}.${translit(l ?? f)}@${DOMAIN}`
}

const PHRASES = [
  'Кто возьмёт ревью карточки по API?', 'Залил правки, посмотрите, пожалуйста', 'Daily сегодня в 10:00, не опаздываем', 'Перенёс дедлайн, согласовал с тимлидом',
  'Есть вопрос по макету главной страницы', 'Тест-кейсы обновил, в карточке ссылка', 'Давайте разобьём задачу на две поменьше', 'Готово, перевожу в Review',
  'Кто-нибудь сталкивался с ошибкой CORS?', 'Обновил схему базы данных', 'Напоминаю про ретро до вечера', 'Скинул ссылку на прототип в Figma',
  'Заказчик попросил добавить фильтр по дате', 'Я сегодня до 18:00 на парах, потом подключусь', 'Спасибо, всё работает!', 'Мёрдж сделал, ветка удалена',
  'Посмотрите комментарии в карточке, там важное', 'Предлагаю убрать фичу из спринта, не успеваем', 'Окружение подняли, инструкция в README', 'Отличная работа, команда 👏',
]

export function createSeed(): State {
  const r = rng(20261)
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)]
  const T0 = startOfDay(Date.now()) - 3 * DAY // начало спринта 2 (сегодня — 4-й день)
  const NOW = Date.now()
  const courseStart = T0 - 10 * WEEK
  const at = (d: number, h = 0, m = 0) => T0 + d * DAY + h * HOUR + m * MIN

  const course: Course = { id: 'c1', name: 'Лидерство в IT', stream: 'Поток 2026-1', start: courseStart, weeks: 15, teacherId: 't1', status: 'active' }
  const courses: Course[] = [
    course,
    { id: 'c2', name: 'Лидерство в IT', stream: 'Поток 2026-2', start: courseStart, weeks: 15, teacherId: 't1', status: 'active', studentsCount: 88 },
    { id: 'c3', name: 'Управление IT-проектами', stream: '2026-1', start: courseStart, weeks: 15, teacherId: 't2', status: 'active', studentsCount: 64 },
    { id: 'c4', name: 'Лидерство в IT', stream: '2025-2', start: courseStart - 52 * WEEK, weeks: 15, teacherId: 't1', status: 'archive', keepUntil: '30.06.2027', studentsCount: 91 },
  ]

  const staff: User[] = [
    { id: 't1', name: 'Жанар Нурланова', role: 'teacher', group: 'Кафедра ИС' },
    { id: 'as1', name: 'Олжас Беконов', role: 'assistant', group: 'Кафедра ИС' },
    { id: 't2', name: 'Гульнара Сарсенова', role: 'teacher', group: 'Кафедра ИС' },
    { id: 'as2', name: 'Дамир Токтаров', role: 'assistant', group: 'Кафедра ИС' },
    { id: 'adm', name: 'Администратор', role: 'admin', group: 'IT-служба университета' },
  ].map((x) => ({
    ...x,
    role: x.role as User['role'],
    email: x.id === 'adm' ? `admin@${DOMAIN}` : emailFor(x.name),
    about: '',
    skills: [],
    wantedRoles: [],
    links: [],
    lastActiveAt: NOW - (x.id === 't1' ? 20 * MIN : x.id === 'as1' ? 2.5 * HOUR : x.id === 't2' ? 20 * HOUR : 3 * DAY),
    courseIds: x.id === 't2' || x.id === 'as2' ? ['c3'] : ['c1', 'c2', 'c4'],
    rdWeekAgo: 0,
  }))

  /* ── Студенты и команды ── */
  const users: User[] = [...staff]
  const teams: Team[] = []
  const channels: Channel[] = [
    { id: 'ch_general', kind: 'general', name: 'общий' },
    { id: 'ch_ann', kind: 'announcements', name: 'объявления' },
  ]
  const usedNames = new Set(Object.values(NAMED).flat().map((x) => x[0]))
  const strength = new Map<string, number>()
  let groupNo = 0
  const genName = () => {
    for (;;) {
      const f = r() < 0.5
      const name = `${pick(f ? FIRST_F : FIRST_M)} ${f ? fem(pick(LAST)) : pick(LAST)}`
      if (!usedNames.has(name)) {
        usedNames.add(name)
        return name
      }
    }
  }
  const mkStudent = (name: string, s: number, teamId: string, teamRole: TeamRole): User => {
    const id = `u${users.length}`
    const skills = Array.from(new Set(Array.from({ length: 3 + Math.floor(r() * 4) }, () => pick(SKILLS))))
    while (skills.length < 3) skills.push(pick(SKILLS.filter((x) => !skills.includes(x))))
    const u: User = {
      id,
      name,
      email: emailFor(name),
      group: `ИС-22-${(groupNo++ % 4) + 1}`,
      role: 'student',
      about: 'Учусь работать в команде и брать ответственность за результат.',
      skills,
      wantedRoles: [teamRole, pick(ROLE_POOL)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 2) as TeamRole[],
      links: [{ label: 'GitHub', url: `https://github.com/${translit(name.split(' ')[1] ?? 'user')}` }],
      teamId,
      teamRole,
      lastActiveAt: NOW - r() * 40 * HOUR,
      courseIds: ['c1'],
      profileFilledAt: r() < 0.9 ? courseStart + r() * 5 * DAY : courseStart + 9 * DAY,
      rdWeekAgo: 0,
    }
    strength.set(id, s)
    users.push(u)
    return u
  }

  TEAM_DEFS.forEach((d, ti) => {
    const id = `tm${ti + 1}`
    const named = NAMED[d.name] ?? []
    const roles: TeamRole[] = ['Team Lead', 'Scrum Master', 'Developer', 'Analyst', 'QA']
    const members: User[] = []
    for (const [n, role, s] of named) {
      members.push(mkStudent(n, s, id, role))
      roles.splice(roles.indexOf(role) >= 0 ? roles.indexOf(role) : roles.length, 1)
    }
    while (members.length < d.size) members.push(mkStudent(genName(), 0.35 + r() * 0.5, id, roles.shift() ?? 'Developer'))
    const chId = `ch_${id}`
    channels.push({ id: chId, kind: 'team', name: d.name.toLowerCase().replace(/\s+/g, '-'), teamId: id })
    teams.push({
      id,
      name: d.name,
      idea: d.idea,
      initiatorId: members.find((m) => m.teamRole === 'Team Lead')?.id ?? members[0].id,
      memberIds: members.map((m) => m.id),
      status: 'approved',
      projectScore: 9 + Math.round(r() * 6),
      channelId: chId,
    })
  })

  const byName = (n: string) => users.find((u) => u.name === n)!
  const aig = byName('Айгерим Сапарова')
  const dan = byName('Данияр Ахметов')
  const mad = byName('Мадина Ержанова')
  const tim = byName('Тимур Ким')
  Object.assign(aig, {
    about: 'Люблю продуктовую аналитику и собирать людей вокруг понятной цели. Хочу научиться вести команду без микроменеджмента.',
    skills: ['Product analytics', 'Figma', 'SQL', 'Jira', 'Python', 'Публичные выступления'],
    wantedRoles: ['Team Lead', 'Analyst'],
    links: [
      { label: 'GitHub', url: 'https://github.com/' },
      { label: 'LinkedIn', url: 'https://linkedin.com/' },
      { label: 'Портфолио', url: 'https://example.com/' },
    ],
    group: 'ИС-22-1',
    profileFilledAt: courseStart + 2 * DAY,
    lastActiveAt: NOW - 25 * MIN,
  })
  const nomad = teams.find((t) => t.name === 'Nomad Labs')!
  nomad.projectScore = 12
  // неактивные студенты (сигнал «нет действий 5 дней»)
  byName('Руслан Мухамеджанов').lastActiveAt = NOW - 6 * DAY - 3 * HOUR
  users.filter((u) => u.role === 'student' && u.teamId !== nomad.id && u.name !== 'Руслан Мухамеджанов').filter((_, i) => i % 13 === 5).slice(0, 6).forEach((u) => (u.lastActiveAt = NOW - (5.2 + r() * 3) * DAY))

  /* ── Задания (недели 1–8) ── */
  const crit = (names: string[], max: number) => {
    const per = Math.floor(max / names.length)
    return names.map((t, i) => ({ text: t, points: i === names.length - 1 ? max - per * (names.length - 1) : per }))
  }
  const TITLES = [
    'Стили лидерства: самодиагностика', 'Эмоциональный интеллект руководителя', 'Мотивация в IT-команде', 'Делегирование задач',
    'Обратная связь по модели SBI', 'Конфликты в распределённых командах', 'Принятие решений в условиях неопределённости', 'Agile-манифест на практике',
  ]
  const assignments: Assignment[] = TITLES.map((t, i) => ({
    id: `a${i + 1}`,
    title: `Практическая ${i + 1}. ${t}`,
    description: `Изучите материалы лекции ${i + 1} и выполните задание. Ответ оформите в соответствии с чек-листом. Объём — 1–2 страницы.`,
    openAt: courseStart + i * WEEK,
    deadline: courseStart + i * WEEK + 4 * DAY + 23 * HOUR + 59 * MIN,
    maxScore: 5,
    criteria: crit(['Полнота ответа', 'Аргументация и примеры', 'Оформление'], 5),
    format: (['file', 'link', 'text'] as const)[i % 3],
    peerReview: true,
  }))
  assignments.push({
    id: 'rk1',
    title: 'РК1. Тестирование по разделам 1–4',
    description: 'Рубежный контроль 1: тест из 20 вопросов. Время — 40 минут.',
    openAt: courseStart + 7 * WEEK,
    deadline: courseStart + 7 * WEEK + 3 * DAY + 18 * HOUR,
    maxScore: 20,
    criteria: [{ text: 'Правильные ответы (1 балл за вопрос)', points: 20 }],
    format: 'text',
    peerReview: false,
    isControl: true,
  })
  // недавние задания для демонстрации сдачи и peer-review
  assignments.push({
    id: 'a9',
    title: 'Кейс. Конфликт в команде на спринте',
    description: 'Опишите реальную или вымышленную ситуацию конфликта в команде и разберите её по модели Томаса — Килманна: какую стратегию выбрали стороны и что бы вы сделали как лидер.',
    openAt: NOW - 6 * DAY,
    deadline: startOfDay(NOW) - 1 * MIN,
    maxScore: 10,
    criteria: crit(['Описание ситуации', 'Анализ по модели', 'Выводы и действия лидера'], 10),
    format: 'text',
    peerReview: true,
  })
  assignments.push({
    id: 'a10',
    title: 'Рефлексия. Моя роль в команде на спринте 2',
    description: 'Напишите короткую рефлексию: какие лидерские решения вы принимали в спринте, что получилось и что хотите изменить. Можно приложить ссылку на артефакты.',
    openAt: NOW - 2 * DAY,
    deadline: startOfDay(NOW) + 2 * DAY + 23 * HOUR + 59 * MIN,
    maxScore: 10,
    criteria: crit(['Конкретные примеры', 'Анализ своих действий', 'План изменений'], 10),
    format: 'text',
    peerReview: true,
  })

  const students = users.filter((u) => u.role === 'student')
  const submissions: Submission[] = []
  for (const a of assignments) {
    const subs: Submission[] = []
    if (a.id === 'a10') continue
    for (const u of students) {
      const s = strength.get(u.id) ?? 0.6
      if (r() > 0.72 + 0.28 * s && u.id !== aig.id) continue
      let t = a.deadline - r() * 3 * DAY
      if (r() > 0.6 + 0.4 * s && u.id !== aig.id) t = a.deadline + (0.2 + r() * 1.6) * DAY
      if (a.id === 'a9' && t > a.deadline) t = a.deadline - r() * DAY
      if (a.isControl) t = a.deadline - 2 * HOUR
      const graded = a.id !== 'a9'
      const scores = a.criteria.map((c) => Math.max(0, Math.min(c.points, Math.round(c.points * (s * 0.8 + r() * 0.3)))))
      subs.push({
        id: `s_${a.id}_${u.id}`,
        assignmentId: a.id,
        studentId: u.id,
        versions: [{ at: t, content: a.format === 'link' ? 'https://docs.google.com/document/d/…' : a.format === 'file' ? `${translit(u.name.split(' ')[1] ?? 'work')}_pr.pdf` : 'Ответ студента: разбор ситуации, аргументы и выводы. '.repeat(3) }],
        teacherScores: graded ? scores : undefined,
        teacherComment: graded ? pick(['Хорошая работа, аргументы убедительные.', 'Не хватает примеров из практики.', 'Структура понятная, выводы стоит усилить.', 'Отлично!']) : undefined,
        gradedAt: graded ? a.deadline + 4 * DAY : undefined,
        reviews: [],
      })
    }
    if (a.peerReview) {
      // по 2 рецензента на работу из числа сдавших, себя не проверяют
      subs.forEach((sub, i) => {
        for (const k of [1, 2]) {
          const rev = subs[(i + k * 7) % subs.length]
          if (!rev || rev.studentId === sub.studentId) continue
          const t = teacherScoreOf(sub)
          const done = a.id === 'a9' ? r() < 0.4 && rev.studentId !== aig.id : r() < 0.85
          const noise = r() < 0.15 ? 0.45 : 0.12
          const scores = a.criteria.map((c, ci) => Math.max(0, Math.min(c.points, Math.round((sub.teacherScores?.[ci] ?? c.points * 0.7) + (r() - 0.5) * 2 * noise * c.points))))
          sub.reviews.push({
            id: `rv_${sub.id}_${k}`,
            reviewerId: rev.studentId,
            scores: done ? scores : null,
            comment: done ? 'Работа структурирована, автор приводит примеры. Можно глубже раскрыть выводы и показать, как это применимо в нашей команде на проекте. Оформление аккуратное.' : '',
            assignedAt: a.deadline + 5 * MIN,
            doneAt: done ? a.deadline + (r() < 0.9 ? r() * 40 : 50) * HOUR : undefined,
          })
          void t
        }
      })
    }
    submissions.push(...subs)
  }
  // у Айгерим две непроверенные работы по свежему заданию — для демонстрации peer-review
  submissions
    .filter((s) => s.assignmentId === 'a9' && s.studentId !== aig.id && !s.reviews.some((r) => r.reviewerId === aig.id))
    .slice(0, 2)
    .forEach((s) => {
      const r = s.reviews[0]
      if (r) Object.assign(r, { reviewerId: aig.id, scores: null, comment: '', doneAt: undefined })
    })
  function teacherScoreOf(sub: Submission) {
    return sub.teacherScores?.reduce((x, y) => x + y, 0) ?? 0
  }

  /* ── Спринты, карточки, история ── */
  const sprints: Sprint[] = []
  const cards: Card[] = []
  const history: HistoryEntry[] = []
  const retros: Retro[] = []
  const cardSeq: Record<string, number> = {}
  const prefix = (name: string) => name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2).padEnd(2, 'X')
  let hId = 0
  const hist = (c: Card, userId: string, at: number, field: string, from: string, to: string, note?: string) =>
    history.push({ id: `h${hId++}`, cardId: c.id, teamId: c.teamId, userId, at, field, from, to, note })

  const mkCard = (team: Team, p: Partial<Card> & { title: string }): Card => {
    const n = (cardSeq[team.id] = (cardSeq[team.id] ?? 0) + 1)
    const c: Card = {
      id: `${team.id}_c${n}`,
      key: `${prefix(team.name)}-${String(n).padStart(2, '0')}`,
      teamId: team.id,
      sprintId: null,
      column: 'backlog',
      description: '',
      assigneeId: null,
      deadline: null,
      priority: 'mid',
      sp: null,
      labels: [],
      checklist: [],
      files: [],
      comments: [],
      authorId: team.initiatorId,
      createdAt: courseStart + 9 * WEEK + r() * 3 * DAY,
      ...p,
    }
    cards.push(c)
    return c
  }

  const TASKS = ['Настроить репозиторий и CI', 'Описать пользовательские сценарии', 'Макет главного экрана', 'Схема базы данных', 'API авторизации', 'Экран профиля', 'Тест-кейсы на регистрацию',
    'Интервью с пользователями', 'Прототип в Figma', 'Страница списка', 'Фильтры и поиск', 'Уведомления', 'Деплой на тестовый сервер', 'Документация API', 'Ревью кода', 'Подготовка демо',
    'Анализ конкурентов', 'Логирование ошибок', 'Адаптивная вёрстка', 'Нагрузочное тестирование']

  for (const [ti, team] of teams.entries()) {
    const d = TEAM_DEFS[ti]
    const s1: Sprint = { id: `${team.id}_sp1`, teamId: team.id, number: 1, name: 'Спринт 1', goal: 'Подготовить окружение, требования и первые экраны.', start: T0 - WEEK, end: T0 - MIN, status: 'closed', closedAt: team.id === nomad.id ? NOW - 33 * HOUR - 12 * MIN : T0 + 2 * HOUR }
    const s2: Sprint = { id: `${team.id}_sp2`, teamId: team.id, number: 2, name: 'Спринт 2', goal: 'Пользователь может найти нужный раздел и выполнить основной сценарий с телефона.', start: T0, end: T0 + WEEK - MIN, status: 'active' }
    sprints.push(s1, s2)
    if (team.id === nomad.id) continue
    const ms = team.memberIds
    // спринт 1 — почти всё сделано
    ms.forEach((uid, mi) => {
      for (let k = 0; k < 2; k++) {
        const sp = pick([2, 3, 5])
        const deadline = T0 - WEEK + (2 + k * 3 + mi * 0.3) * DAY + 18 * HOUR
        const late = r() < 0.12
        const c = mkCard(team, { title: pick(TASKS), description: 'Описание задачи и критерии готовности.', sprintId: s1.id, column: 'done', assigneeId: uid, deadline, sp, priority: pick(['low', 'mid', 'high']), createdAt: T0 - WEEK - DAY, startedAt: deadline - 2 * DAY, closedAt: deadline + (late ? 20 * HOUR : -5 * HOUR), authorId: ms[(mi + 1) % ms.length] })
        hist(c, ms[(mi + 1) % ms.length], c.closedAt!, 'Колонка', 'Review', 'Done')
      }
    })
    // спринт 2 — по профилю команды
    const s2cards: Card[] = []
    const perMember = 2 + (r() < 0.5 ? 1 : 0)
    ms.forEach((uid, mi) => {
      const n = d.skew && mi === 0 ? 3 : perMember
      for (let k = 0; k < n; k++) {
        const deadline = T0 + (1 + k * 1.7 + r()) * DAY + 18 * HOUR
        s2cards.push(mkCard(team, { title: pick(TASKS), description: 'Описание задачи и критерии готовности.', sprintId: s2.id, column: 'todo', assigneeId: uid, deadline, sp: d.skew && mi === 0 ? 5 : pick([2, 3, 3]), priority: pick(['low', 'mid', 'high']), createdAt: T0 + 2 * HOUR, authorId: uid }))
      }
    })
    const totalSp = s2cards.reduce((a, c) => a + (c.sp ?? 0), 0)
    let doneSp = 0
    // чередуем участников, чтобы выполненная работа распределялась равномерно (кроме команд с заданным перекосом)
    const byMember = ms.map((uid) => s2cards.filter((c) => c.assigneeId === uid).sort((x, y) => (x.deadline ?? 0) - (y.deadline ?? 0)))
    const order: Card[] = []
    for (let k = 0; byMember.some((l) => l[k]); k++) for (const l of byMember) if (l[k]) order.push(l[k])
    if (d.skew) order.sort((x, y) => (x.assigneeId === ms[0] ? 0 : 1) - (y.assigneeId === ms[0] ? 0 : 1))
    let overdueLeft = d.overdue
    for (const c of order) {
      const pastDue = c.deadline! < NOW
      if (doneSp < totalSp * d.done && (!pastDue || overdueLeft <= 0 || r() < 0.3)) {
        c.column = 'done'
        c.startedAt = c.deadline! - 2 * DAY
        c.closedAt = Math.min(NOW - HOUR, c.deadline! - (r() < 0.85 ? 4 * HOUR : -10 * HOUR))
        doneSp += c.sp ?? 0
        hist(c, team.memberIds.find((x) => x !== c.assigneeId)!, c.closedAt, 'Колонка', 'Review', 'Done')
      } else if (pastDue && overdueLeft > 0) {
        c.column = pick(['progress', 'review'] as Column[])
        c.startedAt = c.deadline! - DAY
        overdueLeft--
      } else {
        c.column = pick(['todo', 'progress', 'progress', 'review'] as Column[])
        if (c.column !== 'todo') c.startedAt = NOW - r() * 2 * DAY
        if (pastDue) {
          c.deadline = NOW + (1 + r() * 2) * DAY
        }
      }
    }
    for (let k = 0; k < 4; k++) mkCard(team, { title: pick(TASKS), sprintId: null, column: 'backlog', priority: pick(['low', 'mid']) })
    // ретро спринта 1
    if (d.retro1) {
      retros.push({
        id: `rt_${s1.id}`,
        sprintId: s1.id,
        teamId: team.id,
        items: ms.flatMap((uid, i) => [
          { id: `ri_${s1.id}_${i}a`, authorId: uid, col: 'good' as const, text: pick(['Быстро договорились о стеке', 'Хорошие daily', 'Помогали друг другу с ревью']), at: T0 + 5 * HOUR },
          { id: `ri_${s1.id}_${i}b`, authorId: uid, col: pick(['bad', 'change'] as const), text: pick(['Поздно брали задачи', 'Мало тестов', 'Чаще обновлять доску', 'Дробить задачи мельче']), at: T0 + 6 * HOUR },
        ]),
        ratings: ms.flatMap((from) => ms.filter((to) => to !== from).map((to) => ({ from, to, score: Math.max(2, Math.min(5, Math.round(3 + (strength.get(to) ?? 0.6) * 2 + (r() - 0.5)))) }))),
      })
    }
  }

  /* ── Nomad Labs — данные из макетов ── */
  const [S1, S2] = [`${nomad.id}_sp1`, `${nomad.id}_sp2`]
  const nl = (n: number, p: Partial<Card> & { title: string }) => {
    cardSeq[nomad.id] = n - 1
    const c = mkCard(nomad, p)
    c.key = `NL-${String(n).padStart(2, '0')}`
    return c
  }
  const sprint1Titles: [number, string, string, number, number][] = [
    [1, 'Собрать требования у заказчика', aig.id, 3, -6],
    [2, 'Пользовательские истории для MVP', aig.id, 3, -5],
    [3, 'Выбрать стек и создать репозиторий', mad.id, 2, -6],
    [4, 'Прототип главной в Figma', aig.id, 5, -4],
    [5, 'Настроить CI в GitHub Actions', dan.id, 3, -3],
    [6, 'Чек-лист тестирования MVP', tim.id, 2, -2],
    [12, 'Регламент daily и ретро', dan.id, 1, -5],
    [13, 'Модель данных: клубы и заявки', mad.id, 5, -2],
  ]
  for (const [n, title, who, sp, dd] of sprint1Titles) {
    const deadline = T0 + dd * DAY + 18 * HOUR
    const c = nl(n, { title, description: 'Результат приложен в карточке.', sprintId: S1, column: 'done', assigneeId: who, deadline, sp, createdAt: T0 - WEEK + HOUR, startedAt: deadline - 2 * DAY, closedAt: deadline - (n === 6 ? -14 * HOUR : 3 * HOUR), authorId: aig.id })
    hist(c, who === dan.id ? aig.id : dan.id, c.closedAt!, 'Колонка', 'Review', 'Done')
  }
  const desc = (t: string) => t
  const c07 = nl(7, { title: 'Описать роли и права в проекте', description: desc('Таблица ролей: гость, студент, руководитель клуба, администратор.'), sprintId: S2, column: 'done', assigneeId: aig.id, deadline: at(1, 18), sp: 2, priority: 'low', createdAt: at(0, 2), startedAt: at(0, 11), closedAt: at(1, 15, 10) })
  const c08 = nl(8, { title: 'Схема базы данных', description: desc('ER-диаграмма: clubs, members, applications, events.'), sprintId: S2, column: 'done', assigneeId: dan.id, deadline: at(2, 18), sp: 5, priority: 'high', createdAt: at(0, 2), startedAt: at(0, 12), closedAt: at(1, 19, 30) })
  const c09 = nl(9, { title: 'Макет экрана «Мои клубы»', description: desc('Мобильный макет: список клубов пользователя, статусы заявок, пустое состояние.'), sprintId: S2, column: 'review', assigneeId: aig.id, deadline: at(2, 12), sp: 3, priority: 'mid', createdAt: at(0, 2), startedAt: at(0, 15), labels: ['design'] })
  const c10 = nl(10, { title: 'Настроить окружение', description: desc('Docker compose: API + Postgres + фронт.'), sprintId: S2, column: 'done', assigneeId: mad.id, deadline: at(1, 12), sp: 3, priority: 'mid', createdAt: at(0, 2), startedAt: at(0, 10), closedAt: at(0, 21, 42) })
  nl(11, { title: 'Провести sprint review с заказчиком', description: desc('Согласовать время, подготовить демо и список вопросов.'), sprintId: S2, column: 'todo', assigneeId: aig.id, deadline: at(5, 12), sp: 2, priority: 'mid', createdAt: at(0, 3) })
  const c14 = nl(14, { title: 'Сценарии регистрации в клуб', description: desc('Описать happy path и ошибки: клуб закрыт, лимит участников, повторная заявка.'), sprintId: S2, column: 'progress', assigneeId: aig.id, deadline: at(3, 18), sp: 5, priority: 'high', createdAt: at(0, 3), startedAt: at(1, 10), checklist: [{ id: 'k1', text: 'Happy path', done: true }, { id: 'k2', text: 'Ошибки валидации', done: true }, { id: 'k3', text: 'Повторная заявка', done: false }, { id: 'k4', text: 'Согласовать с QA', done: false }] })
  const c15 = nl(15, { title: 'API: список клубов', description: desc('GET /clubs с пагинацией и фильтром по тегу.'), sprintId: S2, column: 'progress', assigneeId: mad.id, deadline: at(2, 23, 59), sp: 5, priority: 'high', createdAt: at(0, 3), startedAt: at(1, 9), labels: ['backend'] })
  const c16 = nl(16, { title: 'Тест-кейсы на подачу заявки', description: desc('Позитивные и негативные сценарии подачи заявки.'), sprintId: S2, column: 'todo', assigneeId: tim.id, deadline: at(4, 18), sp: 3, priority: 'mid', createdAt: at(0, 3) })
  const c17 = nl(17, { title: 'Форма заявки (frontend)', description: desc('Форма с валидацией, отправка на API.'), sprintId: S2, column: 'progress', assigneeId: mad.id, deadline: at(4, 18), sp: 3, priority: 'mid', createdAt: at(0, 4), startedAt: at(2, 14), labels: ['frontend'] })
  const c18 = nl(18, { title: 'Карточка клуба (frontend)', description: desc('Экран клуба: описание, расписание, кнопка «Вступить».'), sprintId: S2, column: 'progress', assigneeId: mad.id, deadline: at(5, 18), sp: 3, priority: 'low', createdAt: at(0, 4), startedAt: at(3, 9), labels: ['frontend'] })
  const c21 = nl(21, { title: 'Уведомления о статусе заявки на почту', description: '', sprintId: S2, column: 'backlog', sp: 5, priority: 'low', createdAt: at(0, 4) })
  const c22 = nl(22, { title: 'Поиск клубов по тегам', description: '', sprintId: S2, column: 'backlog', sp: 3, priority: 'mid', createdAt: at(0, 4) })
  void c21; void c22
  ;[[19, 'Личный кабинет руководителя клуба', 8, 'mid'], [20, 'Экспорт списка участников в Excel', 3, 'low'], [23, 'Календарь событий клуба', 5, 'mid'], [24, 'Онбординг нового пользователя', 3, 'low'], [25, 'Модерация клубов администратором', 5, 'mid'], [26, 'Push-уведомления', 8, 'low'], [27, 'Отзывы о клубах', 3, 'low'], [28, 'Тёмная тема', 2, 'low'], [29, 'Аналитика посещаемости', 5, 'mid']].forEach(
    ([n, t, sp, p]) => nl(n as number, { title: t as string, sp: sp as number, priority: p as Card['priority'], createdAt: T0 - 4 * DAY }),
  )
  cardSeq[nomad.id] = 29
  c09.comments = [
    { id: 'cm1', authorId: dan.id, text: 'Добавь пустое состояние для списка, когда пользователь ещё не вступил ни в один клуб.', at: NOW - 2 * HOUR - 10 * MIN },
    { id: 'cm2', authorId: aig.id, text: 'Добавила, посмотри ещё раз, пожалуйста.', at: NOW - 1 * HOUR },
    { id: 'cm3', authorId: tim.id, text: 'С моей стороны ок, проверил на 360px.', at: NOW - 40 * MIN },
  ]
  c14.comments = [
    { id: 'cm4', authorId: mad.id, text: 'Какие коды ошибок отдаём при лимите участников?', at: at(2, 12) },
    { id: 'cm5', authorId: aig.id, text: '409 и текст «Мест нет», добавлю в сценарий.', at: at(2, 13) },
    { id: 'cm6', authorId: tim.id, text: '@Айгерим добавь ещё кейс с закрытым клубом.', at: at(2, 15) },
    { id: 'cm7', authorId: aig.id, text: 'Добавила.', at: at(3, 9) },
  ]
  c15.comments = Array.from({ length: 6 }, (_, i) => ({ id: `cm15_${i}`, authorId: [mad.id, dan.id][i % 2], text: ['Пагинация через cursor или offset?', 'Давай offset, проще для фронта.', 'Ок. Фильтр по тегу через query ?tag=', 'Да.', 'Есть проблема с индексами, чуть задержусь.', 'Понял, держи в курсе.'][i], at: at(1, 10 + i * 4) }))
  c16.comments = [
    { id: 'cm8', authorId: tim.id, text: 'Начну после того, как будет готова форма.', at: at(1, 16) },
    { id: 'cm9', authorId: mad.id, text: 'Форма будет к пятнице.', at: at(1, 17) },
  ]
  c17.comments = [{ id: 'cm10', authorId: mad.id, text: 'Валидация на клиенте готова.', at: at(3, 10) }]
  c08.comments = Array.from({ length: 5 }, (_, i) => ({ id: `cm8_${i}`, authorId: [dan.id, mad.id, aig.id][i % 3], text: ['Нужна ли таблица событий?', 'Да, для календаря.', 'Согласна.', 'Добавил.', 'Ок, мёржим.'][i], at: at(1, 9 + i) }))
  c07.comments = [
    { id: 'cm11', authorId: dan.id, text: 'Всё понятно, принимаю.', at: at(1, 15) },
    { id: 'cm12', authorId: aig.id, text: 'Спасибо!', at: at(1, 15, 20) },
  ]
  c10.comments = [{ id: 'cm13', authorId: aig.id, text: 'Работает, спасибо!', at: at(0, 21, 40) }]

  hist(c10, aig.id, at(0, 21, 42), 'Колонка', 'Review', 'Done')
  hist(c07, dan.id, at(1, 15, 10), 'Колонка', 'Review', 'Done')
  hist(c08, mad.id, at(1, 19, 30), 'Колонка', 'Review', 'Done')
  hist(c09, aig.id, at(2, 11, 40), 'Колонка', 'In Progress', 'Review')
  hist(c09, dan.id, NOW - 2 * HOUR - 10 * MIN, 'Колонка', 'Review', 'In Progress', 'Добавь пустое состояние для списка')
  hist(c09, aig.id, NOW - 1 * HOUR, 'Колонка', 'In Progress', 'Review')
  hist(c15, mad.id, NOW - 5 * HOUR, 'Дедлайн', `вт 23:59`, `ср 23:59`)
  hist(c18, mad.id, at(3, 9), 'Колонка', 'To Do', 'In Progress')
  hist(c14, aig.id, at(1, 10), 'Колонка', 'To Do', 'In Progress')

  retros.push({
    id: `rt_${S1}`,
    sprintId: S1,
    teamId: nomad.id,
    items: [
      { id: 'nr1', authorId: dan.id, col: 'good', text: 'Быстро настроили репозиторий и CI', at: NOW - 30 * HOUR },
      { id: 'nr2', authorId: dan.id, col: 'bad', text: 'Daily иногда затягивались до 30 минут', at: NOW - 30 * HOUR },
      { id: 'nr3', authorId: mad.id, col: 'good', text: 'Понятные требования от Айгерим', at: NOW - 28 * HOUR },
      { id: 'nr4', authorId: mad.id, col: 'change', text: 'Дробить задачи мельче 5 SP', at: NOW - 28 * HOUR },
      { id: 'nr5', authorId: tim.id, col: 'bad', text: 'Поздно подключили тестирование', at: NOW - 20 * HOUR },
    ],
    ratings: [
      { from: dan.id, to: aig.id, score: 5 }, { from: dan.id, to: mad.id, score: 5 }, { from: dan.id, to: tim.id, score: 3 },
      { from: mad.id, to: aig.id, score: 4 }, { from: mad.id, to: dan.id, score: 4 }, { from: mad.id, to: tim.id, score: 3 },
      { from: tim.id, to: aig.id, score: 5 }, { from: tim.id, to: dan.id, score: 4 }, { from: tim.id, to: mad.id, score: 5 },
    ],
  })

  /* ── Сообщения ── */
  const messages: Message[] = []
  let mId = 0
  const msg = (channelId: string, authorId: string, t: number, text: string, extra: Partial<Message> = {}) => {
    const d0 = startOfDay(t)
    const h = (t - d0) / HOUR
    if (h < 8.5 || h > 22.5) t = d0 + (9 + ((t / MIN) % 13)) * HOUR + (Math.floor(t / 1000) % 60) * MIN
    if (t > NOW) t = NOW - (20 + ((t / MIN) % 240)) * MIN
    const m: Message = { id: `m${mId++}`, channelId, authorId, text, at: t, reactions: {}, ...extra }
    messages.push(m)
    return m
  }
  for (const [ti, team] of teams.entries()) {
    if (team.id === nomad.id) continue
    const d = TEAM_DEFS[ti]
    const lastAt = NOW - d.silent * DAY - HOUR
    for (let k = 0; k < d.msgs; k++) {
      const t = lastAt - r() * (7 - d.silent) * DAY
      msg(team.channelId, pick(team.memberIds), t, pick(PHRASES))
    }
  }
  const today = startOfDay(NOW)
  const tod = (h: number, m: number) => Math.min(today + h * HOUR + m * MIN, NOW - 5 * MIN)
  for (let k = 0; k < 34; k++) msg(nomad.channelId, pick(nomad.memberIds), today - (1 + r() * 6) * DAY + 10 * HOUR, pick(PHRASES))
  const m1 = msg(nomad.channelId, dan.id, tod(9, 12), 'Доброе утро! Daily в 10:00. По burndown отстаём на 4 SP — давайте обсудим, что снимаем из спринта.', { reactions: { '👍': [aig.id, mad.id] } })
  msg(nomad.channelId, aig.id, tod(9, 20), 'Предлагаю перенести NL-22 в следующий спринт.', { parentId: m1.id })
  msg(nomad.channelId, mad.id, tod(9, 24), 'Согласна, по API и так плотно.', { parentId: m1.id })
  msg(nomad.channelId, tim.id, tod(9, 31), '+1, тест-кейсы успею.', { parentId: m1.id })
  msg(nomad.channelId, mad.id, tod(11, 40), '@Айгерим глянешь контракт API для списка клубов? Приложила описание эндпоинтов.', { files: [{ id: 'f1', name: 'api-clubs-v2.pdf', size: 412 * 1024 }] })
  msg(nomad.channelId, tim.id, tod(12, 5), 'Тест-кейсы на подачу заявки готовы на 70%, закрою к пятнице.', { editedAt: tod(12, 9), originalText: 'Тест-кейсы на подачу заявки готовы на 60%, закрою к четвергу.' })
  msg(nomad.channelId, tim.id, tod(12, 30), 'Кто-нибудь знает, когда РК2?', { deletedAt: tod(12, 31) })
  msg(nomad.channelId, 't1', tod(13, 30), 'Напоминаю: ретроспективу спринта 1 нужно заполнить до 23:59. Каждый добавляет минимум один пункт.')
  msg('ch_ann', 't1', courseStart + 9 * WEEK + 6 * DAY + 20 * HOUR, 'Составы команд утверждены и заморожены. С 10 недели работаем в спринтах. Удачи!')
  msg('ch_ann', 't1', T0 - DAY + 19 * HOUR, 'Спринт 2 стартует завтра. Scrum Master — откройте спринт и проведите planning до 12:00.')
  msg('ch_ann', 'as1', T0 + DAY + 9 * HOUR, 'Консультация по проектам — в четверг в 15:00, ауд. 312.')
  const gen = users.filter((u) => u.role === 'student')
  for (let k = 0; k < 14; k++) msg('ch_general', pick(gen).id, NOW - r() * 6 * DAY, pick(['Кто знает, где презентация с лекции?', 'Спасибо за консультацию!', 'В какой аудитории завтра пара?', 'Есть шаблон для отчёта по спринту?', 'Ссылка на запись лекции в объявлениях']))

  /* ── Журнал, уведомления, блокировки ── */
  const audit = [
    { id: 'au1', at: NOW - 3 * HOUR, userId: 'adm', text: 'О. Беконов: Студент → Ассистент', ip: '10.12.4.31' },
    { id: 'au2', at: NOW - 4 * HOUR, userId: 't1', text: 'Блокировка досок курса 2026-1 запланирована на 15 нед., 23:59', ip: '10.12.7.88' },
    { id: 'au3', at: NOW - 5 * HOUR, userId: 'adm', text: 'Импорт 88 студентов из students_2026-2.xlsx', ip: '10.12.4.31' },
    { id: 'au4', at: NOW - 6 * HOUR, userId: 't1', text: 'Ручное начисление +3 балла · А. Сапарова · «активность на занятии»', ip: '10.12.7.88' },
    { id: 'au5', at: NOW - 12 * HOUR, userId: 'system', text: 'Резервная копия создана · 41,2 ГБ', ip: 'system' },
    { id: 'au6', at: courseStart + 9 * WEEK + 6 * DAY, userId: 't1', text: 'Составы команд заморожены (22 команды)', ip: '10.12.7.88' },
  ]
  const adjustments = [{ id: 'adj1', studentId: aig.id, component: 'A' as const, delta: 3, reason: 'Активность на занятии', byId: 't1', at: NOW - 6 * HOUR }]
  const notifications = [
    { id: 'n1', userId: aig.id, at: NOW - 2 * HOUR - 10 * MIN, text: 'NL-09 вернули из Review · Данияр: «Добавь пустое состояние»', link: `/board?card=${c09.id}`, kind: 'review' as const },
    { id: 'n2', userId: aig.id, at: tod(11, 40), text: 'Вас упомянули в #nomad-labs · Мадина: «@Айгерим глянешь API?»', link: '/chat', kind: 'mention' as const },
    { id: 'n3', userId: aig.id, at: NOW - 7 * HOUR, text: 'Дедлайн NL-14 через 24 часа', link: `/board?card=${c14.id}`, kind: 'deadline' as const, read: true },
    { id: 'n4', userId: aig.id, at: NOW - 6 * HOUR, text: 'Начислено +3 балла: «Активность на занятии»', link: '/profile', kind: 'grade' as const, read: true },
  ]
  const locks = [{ id: 'l1', scope: 'all' as const, reason: 'Дедлайн РК2 — доски только для чтения', from: courseStart + 15 * WEEK - MIN, createdBy: 't1' }]

  const state: State = {
    version: STATE_VERSION,
    seededAt: NOW,
    course,
    courses,
    settings: {
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
      skillDictionary: SKILLS,
    },
    admin: { provider: 'Microsoft 365', domain: DOMAIN, blockOtherDomains: true, inviteCodes: true, sessionHours: 8, lastBackup: today + 3 * HOUR - (NOW - today < 3 * HOUR ? DAY : 0) },
    users,
    teams,
    sprints,
    cards,
    history,
    channels,
    messages,
    assignments,
    submissions,
    retros,
    adjustments,
    audit,
    notifications,
    locks,
    dismissedSignals: [],
    manualBadges: [{ userId: aig.id, key: 'reviewer' }],
    formation: null,
    cardSeq,
  }
  // РД неделю назад — для колонки «за неделю»
  const sc = allScores(state)
  for (const u of users) {
    const v = sc.get(u.id)
    if (v) u.rdWeekAgo = v.RD - (r() * 5 - 1)
  }
  return { ...state }
}

/** Сценарий «окно формирования команд» (недели 8–9) для демонстрации */
export function createFormation(s: State): State['formation'] {
  const NOW = Date.now()
  const byName = (n: string) => s.users.find((u) => u.name === n)
  const aig = byName('Айгерим Сапарова')!
  const core = ['Айгерим Сапарова', 'Данияр Ахметов', 'Мадина Ержанова', 'Тимур Ким'].map((n) => byName(n)!.id)
  const students = s.users.filter((u) => u.role === 'student' && u.courseIds.includes(s.course.id))
  const others = students.filter((u) => !core.includes(u.id))
  const featured = ['Аружан Тлеуова', 'Бекзат Нурлан', 'Асель Каримова', 'Руслан Мухамеджанов', 'Жанель Сейтова'].map((n) => byName(n)!.id)
  const rest = others.filter((u) => !featured.includes(u.id))
  const freeIds = [...featured, ...rest.slice(0, 26).map((u) => u.id)]
  const grouped = rest.slice(26)
  const drafts: Team[] = [
    {
      id: 'ft_nomad',
      name: 'Nomad Labs',
      idea: 'сервис записи в студенческие клубы',
      initiatorId: aig.id,
      memberIds: core,
      status: 'draft',
      projectScore: 0,
      channelId: '',
      roles: { [core[0]]: 'Team Lead', [core[1]]: 'Developer', [core[2]]: 'Developer', [core[3]]: 'QA' },
    },
  ]
  const names = ['ByteForge', 'Steppe Soft', 'Orda Dev', 'Silk Road IT', 'Altyn Apps', 'Tumar Tech', 'Baiterek Digital', 'Kokpar Studio', 'Aral Systems', 'Tengri Lab', 'Saryarka Soft', 'Zhetysu Dev', 'Khan Tengri', 'Alatau Cloud', 'Ertis Data', 'Shanyrak Team', 'Esil Works']
  let i = 0
  let k = 0
  while (i < grouped.length && k < names.length) {
    const size = Math.min(4 + (k % 2), grouped.length - i)
    if (size < 3) break
    const ids = grouped.slice(i, i + size).map((u) => u.id)
    drafts.push({
      id: `ft_${k}`,
      name: names[k],
      idea: s.teams.find((t) => t.name === names[k])?.idea ?? 'Проект команды',
      initiatorId: ids[0],
      memberIds: ids,
      status: k % 3 === 0 ? 'approved' : k % 3 === 1 ? 'pending' : 'draft',
      projectScore: 0,
      channelId: '',
      roles: Object.fromEntries(ids.map((id, j) => [id, (['Team Lead', 'Scrum Master', 'Developer', 'Analyst', 'QA'] as TeamRole[])[j] ?? 'Developer'])),
    })
    i += size
    k++
  }
  freeIds.push(...grouped.slice(i).map((u) => u.id))
  return {
    deadline: NOW + 2 * DAY + 6 * HOUR + 12 * MIN,
    teams: drafts,
    requests: [{ id: 'rq1', teamId: 'ft_nomad', studentId: byName('Аружан Тлеуова')!.id, kind: 'request', at: NOW - 3 * HOUR }],
  }
}
