/**
 * Демо-данные: тот же курс «Лидерство в IT · Поток 2026-1», что и во фронтенде (96 студентов, 22 команды).
 * Даты считаются от момента запуска: сейчас идёт 11 неделя, 4-й день спринта 2.
 *
 *   npm run seed              — очистить БД и загрузить демо-курс
 *   SEED_MODE=empty npm run seed — только администратор и системные настройки (для «чистой» установки)
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { createSeed } from './demo-data'
import { DEFAULT_SETTINGS } from '../src/domain/defaults'

const db = new PrismaClient()
const d = (t: number | null | undefined) => (t === null || t === undefined ? null : new Date(t))
const J = (v: unknown) => v as Prisma.InputJsonValue

async function chunked<T>(rows: T[], fn: (part: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size))
}

async function truncate() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`)
}

async function empty() {
  const domain = process.env.AUTH_DOMAIN ?? 'university.kz'
  const adminEmail = (process.env.ADMIN_EMAIL ?? `admin@${domain}`).toLowerCase()
  await db.systemSettings.upsert({
    where: { id: 1 },
    create: { id: 1, data: { provider: 'Microsoft 365', domain, blockOtherDomains: true, inviteCodes: true, sessionHours: 8, lastBackup: 0 } },
    update: {},
  })
  await db.user.upsert({ where: { email: adminEmail }, create: { email: adminEmail, name: 'Администратор', role: 'admin', group: 'IT-служба университета' }, update: { role: 'admin' } })
  console.log(`Готово: администратор ${adminEmail}`)
}

async function demo() {
  const s = createSeed()
  const NOW = Date.now()
  // генератор даёт однофамильцам одинаковую почту (a.saparova@…) — делаем уникальной;
  // сотрудники и демо-студенты с экрана входа получают адрес без суффикса
  const priority = ['Айгерим Сапарова', 'Данияр Ахметов', 'Мадина Ержанова', 'Тимур Ким']
  const used = new Set<string>()
  const order = [...s.users].sort((a, b) => Number(b.role !== 'student') - Number(a.role !== 'student') || Number(priority.includes(b.name)) - Number(priority.includes(a.name)))
  for (const u of order) {
    let email = u.email
    for (let i = 2; used.has(email); i++) email = u.email.replace('@', `${i}@`)
    used.add(email)
    u.email = email
  }
  await truncate()

  await db.systemSettings.create({ data: { id: 1, data: J(s.admin) } })

  // курсы
  for (const c of s.courses) {
    const isMain = c.id === s.course.id
    await db.course.create({
      data: {
        id: c.id,
        name: c.name,
        stream: c.stream,
        start: new Date(c.start),
        weeks: c.weeks,
        teacherId: c.teacherId,
        status: c.status,
        keepUntil: c.keepUntil,
        settings: J(isMain ? s.settings : DEFAULT_SETTINGS),
        inviteCode: isMain ? 'LEAD-2026' : null,
        // в демо-курсе составы уже заморожены (идёт 11 неделя)
        frozenAt: isMain ? new Date(c.start + 9 * 7 * 86_400_000) : null,
        channels: isMain ? undefined : { create: [{ kind: 'general', name: 'общий' }, { kind: 'announcements', name: 'объявления' }] },
      },
    })
  }

  // пользователи
  await db.user.createMany({
    data: s.users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      group: u.group,
      role: u.role,
      about: u.about,
      skills: J(u.skills),
      wantedRoles: J(u.wantedRoles),
      links: J(u.links),
      lastActiveAt: d(u.lastActiveAt),
      blocked: !!u.blocked,
      profileFilledAt: d(u.profileFilledAt),
      consentAt: new Date(s.course.start),
    })),
  })

  // команды и каналы
  for (const t of s.teams) {
    const members = s.users.filter((u) => t.memberIds.includes(u.id))
    await db.team.create({
      data: {
        id: t.id,
        courseId: s.course.id,
        name: t.name,
        idea: t.idea,
        initiatorId: t.initiatorId,
        stage: 'active',
        status: 'approved',
        projectScore: t.projectScore,
        channelId: t.channelId,
        cardSeq: s.cardSeq[t.id] ?? 0,
        smHistory: J(members.filter((m) => m.teamRole === 'Scrum Master').map((m) => m.id)),
      },
    })
  }
  await db.channel.createMany({ data: s.channels.map((c) => ({ id: c.id, courseId: s.course.id, kind: c.kind, name: c.name, teamId: c.teamId ?? null })) })

  // участие в курсах
  await db.enrollment.createMany({
    data: s.users.flatMap((u) =>
      u.courseIds.map((courseId) => ({
        userId: u.id,
        courseId,
        teamId: courseId === s.course.id ? u.teamId ?? null : null,
        teamRole: courseId === s.course.id ? u.teamRole ?? null : null,
        rdWeekAgo: courseId === s.course.id ? u.rdWeekAgo : 0,
        projectAdjust: courseId === s.course.id ? u.projectAdjust ?? null : null,
      })),
    ),
  })

  // доска
  await db.sprint.createMany({
    data: s.sprints.map((x) => ({ id: x.id, teamId: x.teamId, number: x.number, name: x.name, goal: x.goal, start: new Date(x.start), end: new Date(x.end), status: x.status, closedAt: d(x.closedAt), report: x.report ? J(x.report) : undefined })),
  })
  await chunked(s.cards, (part) =>
    db.card.createMany({
      data: part.map((c) => ({
        id: c.id, key: c.key, teamId: c.teamId, sprintId: c.sprintId, column: c.column, title: c.title, description: c.description, assigneeId: c.assigneeId,
        deadline: d(c.deadline), priority: c.priority, sp: c.sp, labels: J(c.labels), checklist: J(c.checklist), files: J(c.files), authorId: c.authorId,
        createdAt: new Date(c.createdAt), startedAt: d(c.startedAt), closedAt: d(c.closedAt), archived: !!c.archived,
        // старые дедлайны не должны породить волну уведомлений при первом запуске
        notifiedDeadlineAt: c.deadline && c.deadline < NOW + 24 * 3600_000 ? new Date(NOW) : null,
        notifiedOverdueAt: c.deadline && c.deadline < NOW ? new Date(NOW) : null,
      })),
    }),
  )
  await db.cardComment.createMany({ data: s.cards.flatMap((c) => c.comments.map((m) => ({ id: m.id, cardId: c.id, authorId: m.authorId, text: m.text, at: new Date(m.at), files: J(m.files ?? []) }))) })
  await chunked(s.history, (part) => db.historyEntry.createMany({ data: part.map((h) => ({ id: h.id, cardId: h.cardId, teamId: h.teamId, userId: h.userId, at: new Date(h.at), field: h.field, from: h.from, to: h.to, note: h.note ?? null })) }))

  // чат
  await chunked(s.messages, (part) =>
    db.message.createMany({
      data: part.map((m) => ({
        id: m.id, channelId: m.channelId, authorId: m.authorId, text: m.text, at: new Date(m.at), parentId: m.parentId ?? null, files: J(m.files ?? []),
        reactions: J(m.reactions), editedAt: d(m.editedAt), originalText: m.originalText ?? null, deletedAt: d(m.deletedAt),
      })),
    }),
  )

  // задания и peer-review
  await db.assignment.createMany({
    data: s.assignments.map((a) => ({
      id: a.id, courseId: s.course.id, title: a.title, description: a.description, openAt: new Date(a.openAt), deadline: new Date(a.deadline), maxScore: a.maxScore,
      criteria: J(a.criteria), format: a.format, peerReview: a.peerReview, isControl: !!a.isControl, locked: !!a.locked,
    })),
  })
  await chunked(s.submissions, (part) =>
    db.submission.createMany({
      data: part.map((x) => ({ id: x.id, assignmentId: x.assignmentId, studentId: x.studentId, teacherScores: x.teacherScores ? J(x.teacherScores) : undefined, teacherComment: x.teacherComment ?? null, gradedAt: d(x.gradedAt), extensionUntil: d(x.extensionUntil) })),
    }),
  )
  await chunked(s.submissions.flatMap((x) => x.versions.map((v) => ({ submissionId: x.id, at: new Date(v.at), content: v.content }))), (part) => db.submissionVersion.createMany({ data: part }))
  await chunked(
    s.submissions.flatMap((x) =>
      x.reviews.map((r) => ({
        id: r.id, submissionId: x.id, reviewerId: r.reviewerId, scores: r.scores ? J(r.scores) : undefined, comment: r.comment, assignedAt: new Date(r.assignedAt), doneAt: d(r.doneAt),
        disputeReason: r.disputed?.reason ?? null, disputedAt: d(r.disputed?.at), disputeResolution: r.disputed?.resolution ?? null,
      })),
    ),
    (part) => db.review.createMany({ data: part }),
  )

  // ретроспективы
  for (const r of s.retros) {
    await db.retro.create({
      data: {
        id: r.id, sprintId: r.sprintId, teamId: r.teamId,
        items: { create: r.items.map((i) => ({ id: i.id, authorId: i.authorId, col: i.col, text: i.text, at: new Date(i.at) })) },
        ratings: { create: r.ratings.map((x) => ({ fromId: x.from, toId: x.to, score: x.score })) },
      },
    })
  }

  // баллы, журнал, уведомления, блокировки, достижения
  await db.pointAdjustment.createMany({ data: s.adjustments.map((a) => ({ id: a.id, courseId: s.course.id, studentId: a.studentId, component: a.component, delta: a.delta, reason: a.reason, byId: a.byId, at: new Date(a.at) })) })
  await db.auditEntry.createMany({ data: s.audit.map((a) => ({ id: a.id, at: new Date(a.at), userId: a.userId, courseId: a.userId === 'adm' ? null : s.course.id, text: a.text, ip: a.ip ?? null })) })
  await db.notification.createMany({ data: s.notifications.map((n) => ({ id: n.id, userId: n.userId, courseId: s.course.id, at: new Date(n.at), text: n.text, link: n.link, kind: n.kind, read: !!n.read, emailedAt: new Date(n.at) })) })
  await db.lock.createMany({ data: s.locks.map((l) => ({ id: l.id, courseId: s.course.id, scope: l.scope, targetId: l.targetId ?? null, reason: l.reason, from: new Date(l.from), createdById: l.createdBy, cancelled: !!l.cancelled })) })
  await db.manualBadge.createMany({ data: s.manualBadges.map((b) => ({ courseId: s.course.id, userId: b.userId, key: b.key, byId: s.course.teacherId })) })

  const students = s.users.filter((u) => u.role === 'student').length
  console.log(`Демо-курс загружен: ${students} студентов, ${s.teams.length} команд, ${s.cards.length} карточек, ${s.messages.length} сообщений.`)
  console.log('Вход (AUTH_DEV_LOGIN=true):')
  for (const id of ['adm', 't1', 'as1']) {
    const u = s.users.find((x) => x.id === id)!
    console.log(`  ${u.role.padEnd(9)} ${u.email}`)
  }
  for (const n of ['Айгерим Сапарова', 'Данияр Ахметов']) console.log(`  student   ${s.users.find((x) => x.name === n)!.email}`)
  console.log('Код приглашения на курс: LEAD-2026')
}

;(process.env.SEED_MODE === 'empty' ? empty() : demo())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
