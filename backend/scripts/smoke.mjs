/**
 * Приёмочный smoke-тест API по сценариям раздела 11 ТЗ — на демо-данных (npm run seed).
 * Требует AUTH_DEV_LOGIN=true. Запуск: node scripts/smoke.mjs [http://localhost:3000]
 * Тест меняет данные — после него перезагрузите демо: npm run seed
 */
import { io } from 'socket.io-client'

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')
let passed = 0
let failed = 0
const ok = (name, cond, extra = '') => {
  if (cond) passed++
  else failed++
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const section = (t) => console.log(`\n${t}`)

async function api(token, method, path, body, raw = false) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (raw) return res
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, msg: typeof data === 'object' ? [].concat(data?.message ?? '').join('; ') : '' }
}

async function login(email) {
  const r = await api(null, 'POST', '/auth/dev-login', { email })
  if (r.status !== 200) throw new Error(`Вход ${email}: ${r.status} ${r.msg}`)
  return r.data.token
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const H = 3600_000
const D = 24 * H

async function main() {
  section('1. Вход через корпоративную почту')
  const foreign = await api(null, 'POST', '/auth/dev-login', { email: 'aigerim@gmail.com' })
  ok('вход с чужого домена отклоняется', foreign.status === 400 && /корпоративной почты/.test(foreign.msg), foreign.msg)
  const unauth = await api(null, 'GET', '/state')
  ok('без входа данные недоступны', unauth.status === 401)
  const T = await login('zh.nurlanova@university.kz')
  const AS = await login('o.bekonov@university.kz')
  const ADM = await login('admin@university.kz')
  const AIG = await login('a.saparova@university.kz')
  const DAN = await login('d.akhmetov@university.kz')
  const me = await api(AIG, 'GET', '/auth/me')
  ok('студент вошёл', me.status === 200 && me.data.user.role === 'student', me.data.user?.name)
  const aigId = me.data.user.id
  const danId = (await api(DAN, 'GET', '/auth/me')).data.user.id

  section('2. Права студента в /api/state')
  let t0 = Date.now()
  const st = (await api(AIG, 'GET', '/state')).data
  ok('состояние курса загружается', !!st.course?.id, `${Date.now() - t0} мс`)
  const team = st.teams.find((t) => t.id === st.users.find((u) => u.id === aigId).teamId)
  ok('студент видит только свой канал команды и общие', st.channels.every((c) => c.kind !== 'team' || c.teamId === team.id))
  ok('удалённые сообщения скрыты от студента', st.messages.every((m) => !m.deletedAt))
  ok('исходный текст правок скрыт от студента', st.messages.every((m) => m.originalText === undefined))
  ok('оценки коллег на ретро видны только свои', st.retros.every((r) => r.ratings.every((x) => x.from === aigId)))
  ok('рецензенты анонимны для автора', st.submissions.filter((s) => s.studentId === aigId).every((s) => s.reviews.every((r) => r.reviewerId === 'anonymous')))
  ok('журнал и сигналы студенту не отдаются', st.audit.length === 0 && !st.computed.signals)
  ok('рейтинг посчитан сервером', Object.keys(st.computed.scores).length >= 90)
  const other = st.channels.length ? (await api(T, 'GET', '/state')).data.channels.find((c) => c.kind === 'team' && c.teamId !== team.id) : null
  const foreignCh = await api(AIG, 'GET', `/channels/${other.id}/messages`)
  ok('чужой канал команды студенту недоступен', foreignCh.status === 403)

  section('3. Профиль и поиск по навыку')
  const prof = await api(AIG, 'PUT', '/profile', { about: 'Продуктовая аналитика', skills: ['SQL', 'Figma', 'Python', 'Kubernetes'], wantedRoles: ['Team Lead', 'Analyst'], links: [{ label: 'GitHub', url: 'https://github.com/x' }] })
  ok('профиль сохранён', prof.status === 200, prof.msg)
  const badProf = await api(AIG, 'PUT', '/profile', { about: 'x', skills: ['SQL'], wantedRoles: ['Team Lead'], links: [] })
  ok('меньше 3 навыков — ошибка', badProf.status === 400, badProf.msg)
  const found = await api(DAN, 'GET', '/users?skill=kubernetes')
  ok('поиск по навыку находит студента', found.status === 200 && found.data.some((u) => u.id === aigId))

  section('4. Задание, поздняя сдача, peer-review')
  const now = Date.now()
  const crit = [{ text: 'Полнота', points: 5 }, { text: 'Аргументы', points: 5 }]
  const a1 = await api(T, 'POST', '/assignments', { title: 'Smoke: сдача с опозданием', description: 'Тест', openAt: now - 3 * D, deadline: now - 30 * H, maxScore: 10, criteria: crit, format: 'text', peerReview: true })
  ok('преподаватель создаёт задание', a1.status === 201, a1.msg)
  const badCrit = await api(T, 'POST', '/assignments', { title: 'x', description: '', openAt: now, deadline: now + D, maxScore: 10, criteria: [{ text: 'a', points: 3 }], format: 'text', peerReview: false })
  ok('сумма критериев ≠ максимум — ошибка', badCrit.status === 400, badCrit.msg)
  const students = st.users.filter((u) => u.role === 'student' && u.teamId === team.id)
  const tokens = { [aigId]: AIG, [danId]: DAN }
  for (const u of students.filter((u) => !tokens[u.id])) tokens[u.id] = await login(u.email)
  for (const [id, tok] of Object.entries(tokens)) {
    const r = await api(tok, 'POST', `/assignments/${a1.data.id}/submit`, { content: `Ответ ${id}` })
    ok(`сдача после дедлайна принимается с предупреждением`, r.status === 201 && r.data.late, r.msg || r.data.warning)
  }
  const a2 = await api(T, 'POST', '/assignments', { title: 'Smoke: закрыто', description: 'Тест', openAt: now - 10 * D, deadline: now - 4 * D, maxScore: 10, criteria: crit, format: 'text', peerReview: false })
  const closed = await api(AIG, 'POST', `/assignments/${a2.data.id}/submit`, { content: 'поздно' })
  ok('через 72 ч после дедлайна сдача закрыта', closed.status === 400 && /72 часа/.test(closed.msg), closed.msg)
  const assign = await api(T, 'POST', `/assignments/${a1.data.id}/assign-reviewers`)
  ok('рецензенты назначены', assign.status === 201 && assign.data.assigned > 0, `назначений: ${assign.data.assigned}`)
  const subs = (await api(T, 'GET', `/assignments/${a1.data.id}/submissions`)).data
  ok('у каждой работы 2 рецензента, себя не проверяют', subs.every((s) => s.reviews.length === 2 && s.reviews.every((r) => r.reviewerId !== s.studentId)))
  const mySub = subs.find((s) => s.studentId === aigId)
  const rv = subs.flatMap((s) => s.reviews.map((r) => ({ s, r }))).find((x) => x.r.reviewerId === aigId)
  const short = await api(AIG, 'POST', `/submissions/${rv.s.id}/reviews/${rv.r.id}`, { scores: [4, 4], comment: 'Коротко' })
  ok('комментарий рецензии короче 100 символов — ошибка', short.status === 400, short.msg)
  // все рецензенты работы Айгерим ставят 6 баллов, преподаватель — 8
  for (const r of mySub.reviews) {
    const res = await api(tokens[r.reviewerId], 'POST', `/submissions/${mySub.id}/reviews/${r.id}`, { scores: [3, 3], comment: 'Подробный разбор работы: структура понятная, аргументы приведены, но примеров из практики команды не хватает. Выводы стоит усилить.' })
    ok('рецензент отправил проверку', res.status === 201, res.msg)
  }
  const g = await api(T, 'POST', `/submissions/${mySub.id}/grade`, { scores: [4, 4], comment: 'Хорошо' })
  ok('преподаватель оценил работу', g.status === 201, g.msg)
  // итог = 0,7 × 8 + 0,3 × 6 − штраф 10% × 10 за 2 начатых суток опоздания (30 ч) = 5,6 + 1,8 − 2 = 5,4
  const rep = await api(T, 'GET', `/reports/students/${aigId}?format=xlsx`, null, true)
  ok('карточка студента выгружается в Excel', rep.status === 200 && Number(rep.headers.get('content-length') ?? 1) > 0)
  const st2 = (await api(T, 'GET', '/state')).data
  const sub2 = st2.submissions.find((s) => s.id === mySub.id)
  const t = sub2.teacherScores.reduce((a, b) => a + b, 0)
  const p = sub2.reviews.map((r) => r.scores.reduce((a, b) => a + b, 0)).reduce((a, b) => a + b, 0) / sub2.reviews.length
  const lateDays = Math.ceil((sub2.versions.at(-1).at - (now - 30 * H)) / D)
  const expected = Math.round((0.7 * t + 0.3 * p - lateDays * 0.1 * 10) * 10) / 10
  ok('итог по формуле 0,7/0,3 со штрафом 10%/сутки', expected === 5.4, `ожидаем 5,4; посчитано ${expected} (дней опоздания: ${lateDays})`)

  section('5. Проверка правил команды')
  const course = await api(ADM, 'POST', '/admin/courses', { name: 'Smoke-курс', stream: 'тест', start: now - 7 * 7 * D - D, teacherId: st.course.teacherId })
  ok('администратор создаёт курс', course.status === 201, course.msg)
  await api(ADM, 'POST', `/admin/courses/${course.data.id}/members`, { userId: aigId })
  const hdr = async (tok, method, path, body) => {
    const res = await fetch(BASE + '/api' + path, { method, headers: { Authorization: `Bearer ${tok}`, 'X-Course-Id': course.data.id, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data, msg: [].concat(data?.message ?? '').join('; ') }
  }
  const op = await hdr(T, 'POST', '/formation/open', { deadline: now + 2 * D })
  ok('преподаватель открывает окно формирования', op.status === 201, op.msg)
  const dt = await hdr(AIG, 'POST', '/formation/teams', { name: 'Smoke Team', idea: 'Проверка правил' })
  ok('студент создаёт команду', dt.status === 201, dt.msg)
  const chk = await hdr(AIG, 'GET', `/formation/teams/${dt.data.id}/check`)
  ok('проверка правил называет нарушения', chk.data.some((c) => !c.ok && /Размер/.test(c.label)) && chk.data.some((c) => !c.ok && /Средний Р1/.test(c.label)), chk.data.filter((c) => !c.ok).map((c) => c.label).join('; '))
  const sb = await hdr(AIG, 'POST', `/formation/teams/${dt.data.id}/submit`)
  ok('команда с нарушениями не уходит на утверждение', sb.status === 400 && /Не выполнено правило/.test(sb.msg), sb.msg)

  section('6. Доска: Done, история, блокировка')
  const card = await api(AIG, 'POST', `/teams/${team.id}/cards`, { title: 'Smoke-карточка', description: 'Проверка переходов', assigneeId: aigId, deadline: now + 2 * D, sp: 3, inSprint: true })
  ok('карточка создана', card.status === 201, card.msg)
  for (const col of ['todo', 'progress', 'review']) {
    const mv = await api(AIG, 'POST', `/cards/${card.data.id}/move`, { to: col })
    ok(`перенос в ${col}`, mv.status === 201, mv.msg || mv.data.warning || '')
  }
  const self = await api(AIG, 'POST', `/cards/${card.data.id}/move`, { to: 'done' })
  ok('исполнитель не может сам перенести карточку в Done', self.status === 400 && /Исполнитель не может/.test(self.msg), self.msg)
  const back = await api(DAN, 'POST', `/cards/${card.data.id}/move`, { to: 'progress' })
  ok('возврат из Review без комментария запрещён', back.status === 400, back.msg)
  const done = await api(DAN, 'POST', `/cards/${card.data.id}/move`, { to: 'done' })
  ok('другой участник переносит в Done', done.status === 201, done.msg)
  const hist = await api(AIG, 'GET', `/cards/${card.data.id}/history`)
  ok('каждое изменение видно в истории с автором и временем', hist.data.length >= 5 && hist.data.every((h) => h.userId && h.at), `${hist.data.length} записей`)
  const lock = await api(T, 'POST', '/locks', { scope: 'team', targetId: team.id, reason: 'Smoke: проверка блокировки', from: Date.now() - 1000 })
  const blocked = await api(AIG, 'POST', `/teams/${team.id}/cards`, { title: 'не должна создаться' })
  ok('блокировка делает доску «только чтение» с причиной', blocked.status === 400 && /Smoke: проверка блокировки/.test(blocked.msg), blocked.msg)
  await api(T, 'DELETE', `/locks/${lock.data.id}`)
  const sched = await api(T, 'POST', '/locks', { scope: 'team', targetId: team.id, reason: 'Smoke: по расписанию', from: Date.now() + 4000 })
  const before = await api(AIG, 'POST', `/cards/${card.data.id}/comments`, { text: 'до блокировки' })
  await sleep(4500)
  const after = await api(AIG, 'POST', `/cards/${card.data.id}/comments`, { text: 'после блокировки' })
  ok('блокировка по расписанию срабатывает в заданный момент', before.status === 201 && after.status === 400, after.msg)
  await api(T, 'DELETE', `/locks/${sched.data.id}`)

  section('7. Чат: realtime, правка, удаление')
  const sock = io(BASE, { auth: { token: DAN }, transports: ['websocket'] })
  await new Promise((r) => sock.on('connect', r))
  const got = new Promise((r) => sock.on('message', (e) => e.action === 'new' && e.message.text.includes('Smoke realtime') && r(Date.now())))
  const sentAt = Date.now()
  const msg = await api(AIG, 'POST', `/channels/${team.channelId}/messages`, { text: 'Smoke realtime: @Данияр привет' })
  const delivered = await Promise.race([got, sleep(3000).then(() => 0)])
  ok('сообщение доставлено участнику без перезагрузки (≤ 3 с)', delivered > 0, delivered ? `${delivered - sentAt} мс` : 'не доставлено')
  sock.close()
  await api(AIG, 'PATCH', `/messages/${msg.data.id}`, { text: 'Smoke realtime: исправлено' })
  await api(AIG, 'DELETE', `/messages/${msg.data.id}`)
  const tMsgs = (await api(T, 'GET', `/channels/${team.channelId}/messages`)).data
  const tm = tMsgs.items.find((m) => m.id === msg.data.id)
  ok('преподаватель видит удалённое и исходный текст', tm && tm.deletedAt && /привет/.test(tm.originalText ?? ''))
  const sMsgs = (await api(DAN, 'GET', `/channels/${team.channelId}/messages`)).data
  ok('студент не видит удалённое сообщение', !sMsgs.items.some((m) => m.id === msg.data.id))
  ok('в канале пометка «Переписку видит преподаватель»', sMsgs.notice === 'Переписку видит преподаватель')
  const ann = await api(AIG, 'POST', `/channels/ch_ann/messages`, { text: 'студент в объявлениях' })
  ok('студент не пишет в объявления', ann.status === 403)
  const notes = await api(DAN, 'GET', '/notifications')
  ok('@упоминание создаёт уведомление', notes.data.some((n) => n.kind === 'mention' && /Smoke realtime/.test(n.text)))

  section('8. Спринт: закрытие, ретроспектива, burndown')
  const stD = (await api(DAN, 'GET', '/state')).data
  const sprint = stD.sprints.find((s) => s.teamId === team.id && s.status === 'active')
  const bd = await api(DAN, 'GET', `/sprints/${sprint.id}/burndown`)
  ok('burndown считается', bd.status === 200 && bd.data.actual.length > 0, `всего ${bd.data.total} SP, сделано ${bd.data.doneSp}`)
  const notSm = await api(AIG, 'POST', `/sprints/${sprint.id}/close`, { unfinished: 'next' })
  ok('закрыть спринт может только Scrum Master', notSm.status === 403, notSm.msg)
  const cl = await api(DAN, 'POST', `/sprints/${sprint.id}/close`, { unfinished: 'next' })
  ok('Scrum Master закрывает спринт с отчётом', cl.status === 201, cl.data.report ? `сделано ${cl.data.report.done} из ${cl.data.report.planned}` : cl.msg)
  const ri = await api(AIG, 'POST', `/sprints/${sprint.id}/retro/items`, { col: 'good', text: 'Smoke: хорошо поработали' })
  ok('пункт ретроспективы добавлен', ri.status === 201, ri.msg)
  const rt = await api(AIG, 'PUT', `/sprints/${sprint.id}/retro/ratings`, { ratings: { [danId]: 5 } })
  ok('оценка вклада коллег сохранена', rt.status === 200, rt.msg)

  section('9. Рейтинг, ручные баллы, сигналы, отчёты')
  const noReason = await api(AS, 'POST', '/points/adjust', { studentId: aigId, component: 'A', delta: 2, reason: ' ' })
  ok('ручное начисление без причины запрещено', noReason.status === 400, noReason.msg)
  const adj = await api(AS, 'POST', '/points/adjust', { studentId: aigId, component: 'A', delta: 2, reason: 'Smoke: активность на занятии' })
  ok('ассистент начисляет баллы с причиной', adj.status === 201, adj.msg)
  const asSet = await api(AS, 'PUT', '/course/settings', { settings: { latePenaltyPct: 5 } })
  ok('ассистент не меняет формулу и веса', asSet.status === 403)
  const rating = await api(AIG, 'GET', '/rating')
  ok('рейтинг курса виден студенту', rating.status === 200 && rating.data.students.length > 0 && rating.data.admission, `РД ${rating.data.admission?.rd?.toFixed(1)}, не хватает ${rating.data.admission?.missing?.toFixed(1)}`)
  const sig = await api(T, 'GET', '/analytics/signals')
  ok('сигналы преподавателю появляются', sig.status === 200 && sig.data.length > 0, [...new Set(sig.data.map((s) => s.kind))].join(', '))
  ok('студенту сигналы недоступны', (await api(AIG, 'GET', '/analytics/signals')).status === 403)
  const metrics = await api(T, 'GET', `/analytics/metrics?scope=team&id=${team.id}&period=week`)
  ok('метрики команды за неделю', metrics.status === 200 && metrics.data.metrics, metrics.data.period?.label)
  for (const f of ['xlsx', 'pdf']) {
    const r = await api(T, 'GET', `/reports/gradebook?format=${f}`, null, true)
    const buf = Buffer.from(await r.arrayBuffer())
    ok(`ведомость курса выгружается в ${f.toUpperCase()}`, r.status === 200 && buf.length > 1000, `${Math.round(buf.length / 1024)} КБ`)
  }
  ok('студент не выгружает ведомость', (await api(AIG, 'GET', '/reports/gradebook?format=xlsx', null, true)).status === 403)
  const aud = await api(T, 'GET', '/audit?limit=20')
  ok('ручное начисление попало в журнал с IP', aud.data.some((a) => /Smoke: активность/.test(a.text) && a.ip))

  section('10. Нагрузка: 100 параллельных запросов состояния')
  t0 = Date.now()
  const all = await Promise.all(Array.from({ length: 100 }, (_, i) => api([AIG, DAN, T][i % 3], 'GET', '/state').then((r) => r.status)))
  const dt100 = Date.now() - t0
  ok('100 одновременных открытий страницы', all.every((s) => s === 200), `${dt100} мс на все`)

  console.log(`\nИтого: ${passed} ✔, ${failed} ✘`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
