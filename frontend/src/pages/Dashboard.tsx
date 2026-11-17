import { useMemo } from 'react'
import { useMe } from '../store'
import { Link, navigate } from '../router'
import { Avatar, Icon, PageHead } from '../components/ui'
import { TopBar } from '../components/Layout'
import { COL_TITLE, activeSprint, allScores, courseWeek, scoresOf, stageOf, lateInfo } from '../lib/rules'
import { DAY, HOUR, avg, firstName, fmtAgo, fmtLeft, fmtNum, fmtWeekdayTime, now, plural } from '../lib/util'
import type { Card } from '../types'

export function StatusPill({ c }: { c: Card }) {
  return <span className={`pill pill-${c.column}`}>{COL_TITLE[c.column]}</span>
}

export function DeadlineText({ c }: { c: Card }) {
  if (c.column === 'done')
    return c.deadline && c.closedAt && c.closedAt > c.deadline ? <span className="orange small">Закрыто с опозданием</span> : <span className="green small">Закрыто вовремя</span>
  if (!c.deadline) return <span className="muted small">без срока</span>
  if (c.deadline < now()) {
    const d = Math.ceil((now() - c.deadline) / DAY)
    return <span className="orange small bold">Просрочено {d} д</span>
  }
  return <span className="small muted">{fmtWeekdayTime(c.deadline)}</span>
}

export default function Dashboard() {
  const { me, state } = useMe()
  const week = courseWeek(state)
  const sc = scoresOf(state, me.id)
  const total = allScores(state).size
  const team = state.teams.find((t) => t.id === me.teamId)
  const sprint = team ? activeSprint(state, team.id) : undefined
  const sprintsTotal = Math.ceil(6 / state.settings.sprintWeeks)
  const h = new Date().getHours()
  const greet = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'

  const myCards = useMemo(
    () =>
      state.cards
        .filter((c) => c.assigneeId === me.id && !c.archived && sprint && c.sprintId === sprint.id)
        .sort((a, b) => ['progress', 'todo', 'review', 'backlog', 'done'].indexOf(a.column) - ['progress', 'todo', 'review', 'backlog', 'done'].indexOf(b.column)),
    [state.cards, me.id, sprint],
  )

  const attention = useMemo(() => {
    const res: { color: string; title: string; sub: string; to: string }[] = []
    for (const n of state.notifications.filter((x) => x.userId === me.id && !x.read).slice(0, 3)) {
      const [title, sub] = n.text.split(' · ')
      res.push({ color: n.kind === 'mention' ? 'var(--blue)' : 'var(--orange)', title, sub: `${sub ?? ''}${sub ? ' · ' : ''}${fmtAgo(n.at)}`, to: n.link })
    }
    if (team) {
      for (const sp of state.sprints.filter((x) => x.teamId === team.id && x.status === 'closed' && x.closedAt && now() - x.closedAt < 48 * HOUR)) {
        const filled = state.retros.find((r) => r.sprintId === sp.id)?.items.some((i) => i.authorId === me.id)
        if (!filled) res.push({ color: 'var(--orange)', title: `Ретроспектива спринта ${sp.number} не заполнена`, sub: `Осталось ${fmtLeft(sp.closedAt! + 48 * HOUR - now())}`, to: `/board?retro=${sp.id}` })
      }
    }
    const pendingReviews = state.submissions.flatMap((s) => s.reviews.filter((r) => r.reviewerId === me.id && !r.scores && now() - r.assignedAt < 48 * HOUR))
    if (pendingReviews.length)
      res.push({ color: 'var(--blue)', title: `${pendingReviews.length} ${plural(pendingReviews.length, 'работа ждёт', 'работы ждут', 'работ ждут')} вашей проверки`, sub: `Peer-review · осталось ${fmtLeft(pendingReviews[0].assignedAt + 48 * HOUR - now())}`, to: '/assignments' })
    for (const a of state.assignments.filter((x) => x.openAt < now() && x.deadline > now() && x.deadline - now() < 4 * DAY)) {
      const sub = state.submissions.find((x) => x.assignmentId === a.id && x.studentId === me.id)
      if (!sub?.versions.length) res.push({ color: 'var(--orange)', title: `Не сдано: «${a.title}»`, sub: `Дедлайн ${fmtWeekdayTime(lateInfo(a, sub, state).deadline)}`, to: '/assignments' })
    }
    return res.slice(0, 5)
  }, [state, me.id, team])

  const doneSp = team ? state.cards.filter((c) => c.teamId === team.id && c.column === 'done' && c.sprintId === sprint?.id) : []
  const spTotal = doneSp.reduce((a, c) => a + (c.sp ?? 0), 0)
  const share = (id: string) => (spTotal ? Math.round((100 * doneSp.filter((c) => c.assigneeId === id).reduce((a, c) => a + (c.sp ?? 0), 0)) / spTotal) : 0)
  const avgR1 = team ? avg(team.memberIds.map((id) => scoresOf(state, id)?.R1 ?? 0)) : 0
  const threshold = state.settings.admissionThreshold
  const delta = sc ? sc.prevPlace - sc.place : 0

  return (
    <>
      <PageHead crumb={`${state.course.name} · ${state.course.stream}`} title={`${greet}, ${firstName(me.name)}`} actions={<TopBar />} />

      <div className="card">
        <div className="row-between wrap">
          <div className="row wrap">
            <span className="bold" style={{ fontSize: 15 }}>
              Неделя {week} из {state.course.weeks}
            </span>
            <span className="pill pill-blue" style={{ fontSize: 12, padding: '4px 10px' }}>
              {stageOf(week)}
              {sprint ? ` · Спринт ${sprint.number} из ${sprintsTotal}` : ''}
            </span>
          </div>
          <span className="small muted">РК2 и сдача проекта — неделя 15</span>
        </div>
        <div className="timeline">
          {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
            <div key={w} className={`tl-week ${w < week ? (w <= 8 ? 'past' : 'team-past') : ''} ${w === week ? 'current' : ''} ${w === 8 || w === 15 ? 'ctl' : ''}`}>
              <div className="seg-line" />
              {w === 8 ? 'РК1' : w === 15 ? 'РК2' : w}
            </div>
          ))}
        </div>
        <div className="row wrap tiny muted" style={{ gap: 18 }}>
          <span>1–8 · Индивидуальный режим</span>
          <span>8–9 · Формирование команд</span>
          <span>10–15 · Командный режим</span>
        </div>
      </div>

      {sc && (
        <div className="stat-row" style={{ marginTop: 16 }}>
          <div className="stat">
            <div className="stat-label">Р1 · недели 1–8</div>
            <div className="stat-value">
              {Math.round(sc.R1)}
              <small>/100</small>
            </div>
            <div className="stat-sub">
              {week > 8 ? 'Зафиксирован после РК1' : 'Идёт'} · задания {Math.round(sc.I)}, активность {Math.round(sc.A)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Р2 · недели 9–15</div>
            <div className="stat-value">
              {Math.round(sc.R2)}
              <small>/100</small>
            </div>
            <div className="stat-sub">
              Идёт: команда {Math.round(sc.K)}, проект {Math.round(sc.P)}
            </div>
          </div>
          <div className="stat stat-dark">
            <div className="stat-label">РД сейчас</div>
            <div className="stat-value">{fmtNum(sc.RD)}</div>
            <div className={`stat-sub ${sc.RD < threshold ? 'bad' : ''}`}>
              Допуск ≥ {threshold} · {sc.RD >= threshold ? 'проходите' : `не хватает ${fmtNum(threshold - sc.RD)}`}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Место в рейтинге</div>
            <div className="stat-value">
              {sc.place} <small>из {total}</small>
            </div>
            <div className="stat-sub">
              {delta > 0 ? <span className="green">▲ {delta} за неделю</span> : delta < 0 ? <span className="orange">▼ {-delta} за неделю</span> : 'без изменений за неделю'}
            </div>
          </div>
        </div>
      )}

      <div className="dash-grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Мои задачи в спринте</div>
            <Link to="/board" className="link small">
              Открыть доску →
            </Link>
          </div>
          {!team && <div className="empty">Вы пока не в команде. Задачи появятся после формирования команд.</div>}
          {team && !myCards.length && <div className="empty">В текущем спринте на вас нет задач</div>}
          {myCards.map((c) => (
            <div key={c.id} className="task-row" onClick={() => navigate(`/board?card=${c.id}`)}>
              <span className="task-key">{c.key}</span>
              <span className="task-title">{c.title}</span>
              <StatusPill c={c} />
              <span className="hide-sm">
                <DeadlineText c={c} />
              </span>
              <span className="kbd hide-sm" style={{ textAlign: 'right' }}>
                {c.sp ?? '–'} SP
              </span>
            </div>
          ))}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-title">Требует внимания</div>
            {!attention.length && <div className="muted small">Всё в порядке 🎉</div>}
            {attention.map((a, i) => (
              <div key={i} className="attention-item" onClick={() => navigate(a.to)}>
                <span className="dot" style={{ background: a.color }} />
                <div>
                  <div className="bold" style={{ fontSize: 13 }}>
                    {a.title}
                  </div>
                  <div className="tiny muted">{a.sub}</div>
                </div>
              </div>
            ))}
          </div>
          {team && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">{team.name}</div>
                <span className="tiny muted">средний Р1 · {Math.round(avgR1)}</span>
              </div>
              {team.memberIds.map((id) => {
                const u = state.users.find((x) => x.id === id)!
                return (
                  <div key={id} className="member-row">
                    <Avatar user={u} size={32} />
                    <Link to={`/profile/${u.id}`} className="grow">
                      <div className="bold" style={{ fontSize: 13 }}>
                        {u.name}
                      </div>
                      <div className="tiny muted">{u.teamRole}</div>
                    </Link>
                    <span className="kbd">{share(id)}% SP</span>
                  </div>
                )
              })}
              <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => navigate('/chat')}>
                Перейти в чат команды
              </button>
            </div>
          )}
          {!team && (
            <div className="card">
              <div className="card-title">Команда</div>
              <p className="small muted">Команды формируются на 8–9 неделе.</p>
              <button className="btn btn-block" onClick={() => navigate('/teams')}>
                <Icon name="users" size={16} /> К командам
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
