import { useMemo, useState } from 'react'
import { useMe } from '../store'
import { navigate } from '../router'
import { Avatar, Empty, Field, Icon, Modal, PageHead, Segmented } from '../components/ui'
import type { State, Team } from '../types'
import { activeSprint, allScores, burndown, computeSignals, courseWeek, isLocked, memberMetrics, scoresOf, teamMetrics, weekStart, type Period } from '../lib/rules'
import { DAY, WEEK, download, fmtAgo, fmtDateTime, fmtDay, fmtNum, fromInputDT, now, shortName, toCsv, toInputDT } from '../lib/util'
import { addLock, cancelLock, dismissSignal } from '../data/actions'

type PKey = 'sprint:2' | 'sprint:1' | 'week' | 'stage:team' | 'stage:ind'

function periodOf(s: State, key: string): Period & { sprintNo?: number } {
  const w = courseWeek(s)
  if (key.startsWith('sprint:')) {
    const n = Number(key.split(':')[1])
    const sp = s.sprints.find((x) => x.number === n)
    const from = sp?.start ?? weekStart(s, 9 + n)
    return { from, to: sp?.end ?? from + WEEK, label: `Спринт ${n}`, sprintNo: n }
  }
  if (key === 'week') return { from: weekStart(s, w), to: weekStart(s, w) + WEEK, label: `Неделя ${w}` }
  if (key === 'stage:ind') return { from: s.course.start, to: weekStart(s, 9), label: 'Этап 1–8' }
  return { from: weekStart(s, 10), to: weekStart(s, 16), label: 'Этап 10–15' }
}

const LOAD_COLORS = ['#1f3aa8', '#3355d1', '#6f8ae3', '#a9b9ef', '#d5ddf7']

export default function Analytics() {
  const { state, act } = useMe()
  const sprintNos = [...new Set(state.sprints.map((s) => s.number))].sort((a, b) => b - a)
  const [pkey, setPkey] = useState<string>(`sprint:${sprintNos[0] ?? 2}`)
  const [lockOpen, setLockOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState<Team | null>(null)
  const p = periodOf(state, pkey)
  const students = state.users.filter((u) => u.role === 'student' && u.courseIds.includes(state.course.id))
  const sc = allScores(state)
  const teams = state.teams.filter((t) => t.status === 'approved')
  const sprintOf = (t: Team) => (p.sprintNo ? state.sprints.find((s) => s.teamId === t.id && s.number === p.sprintNo) : undefined)
  const rows = useMemo(() => teams.map((t) => ({ t, m: teamMetrics(state, t, p, sprintOf(t)?.id) })), [state, pkey]) // eslint-disable-line react-hooks/exhaustive-deps
  const signals = computeSignals(state)

  const active5 = students.filter((u) => now() - u.lastActiveAt < state.settings.signalInactiveDays * DAY).length
  const spDone = rows.reduce((a, r) => a + r.m.spDone, 0)
  const spTotal = rows.reduce((a, r) => a + r.m.spTotal, 0)
  const doneAll = rows.reduce((a, r) => a + r.m.doneCount, 0)
  const onTimeAll = rows.reduce((a, r) => a + ((r.m.onTimePct ?? 0) * r.m.doneCount) / 100, 0)
  const onTime = doneAll ? Math.round((100 * onTimeAll) / doneAll) : 0
  const prevKey = p.sprintNo && p.sprintNo > 1 ? `sprint:${p.sprintNo - 1}` : null
  const prevOnTime = useMemo(() => {
    if (!prevKey) return null
    const pp = periodOf(state, prevKey)
    const r = teams.map((t) => teamMetrics(state, t, pp, state.sprints.find((s) => s.teamId === t.id && s.number === pp.sprintNo)?.id))
    const d = r.reduce((a, x) => a + x.doneCount, 0)
    return d ? Math.round((100 * r.reduce((a, x) => a + ((x.onTimePct ?? 0) * x.doneCount) / 100, 0)) / d) : null
  }, [state, prevKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const admitted = students.filter((u) => (sc.get(u.id)?.RD ?? 0) >= state.settings.admissionThreshold).length
  const anySprint = teams.map((t) => sprintOf(t)).find(Boolean)
  const bd = anySprint && anySprint.status === 'active' ? burndown(state, anySprint) : null
  const lock = isLocked(state)

  const exportExcel = () => {
    const header = ['Место', 'ФИО', 'E-mail', 'Группа', 'Команда', 'Роль', 'И', 'А', 'Р1', 'К', 'П', 'Р2', 'РД', 'Допуск']
    const data = students
      .map((u) => ({ u, v: sc.get(u.id)! }))
      .sort((a, b) => a.v.place - b.v.place)
      .map(({ u, v }) => [v.place, u.name, u.email, u.group, state.teams.find((t) => t.id === u.teamId)?.name ?? '', u.teamRole ?? '', fmtNum(v.I), fmtNum(v.A), fmtNum(v.R1), fmtNum(v.K), fmtNum(v.P), fmtNum(v.R2), fmtNum(v.RD), v.RD >= state.settings.admissionThreshold ? 'да' : 'нет'])
    const teamsSheet = [[], ['Команды', p.label], ['Команда', 'SP сделано', 'SP план', 'В срок %', 'Просрочено', 'Чат/нед'], ...rows.map((r) => [r.t.name, r.m.spDone, r.m.spTotal, r.m.onTimePct ?? '', r.m.overdue, r.m.chatPerWeek])]
    download(`vedomost_${state.course.stream.replace(/\s/g, '_')}.csv`, toCsv([header, ...data, ...teamsSheet]))
  }

  return (
    <>
      <PageHead
        crumb={`${state.course.name} · ${state.course.stream} · ${students.length} студентов, ${teams.length} команды`}
        title="Аналитика курса"
        actions={
          <>
            <Field label="Период">
              <select className="select" style={{ width: 210 }} value={pkey} onChange={(e) => setPkey(e.target.value as PKey)}>
                {sprintNos.map((n) => {
                  const sp = state.sprints.find((s) => s.number === n)!
                  return (
                    <option key={n} value={`sprint:${n}`}>
                      Спринт {n} ({new Date(sp.start).getDate()}–{fmtDay(sp.end)})
                    </option>
                  )
                })}
                <option value="week">Текущая неделя</option>
                <option value="stage:team">Командный этап</option>
                <option value="stage:ind">Индивидуальный этап</option>
              </select>
            </Field>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => window.print()}>
              Экспорт PDF
            </button>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={exportExcel}>
              Экспорт Excel
            </button>
            <button className="btn btn-dark" style={{ alignSelf: 'flex-end' }} onClick={() => setLockOpen(true)}>
              {lock ? <Icon name="lock" size={14} /> : null} Блокировка досок…
            </button>
          </>
        }
      />
      {lock && (
        <div className="banner banner-dark">
          <Icon name="lock" size={16} /> Действует блокировка: «{lock.reason}» — студенты видят доски только для чтения
        </div>
      )}
      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Активны за {state.settings.signalInactiveDays} дней</div>
          <div className="stat-value">
            {active5} <small>/ {students.length}</small>
          </div>
          <div className="stat-sub orange">{students.length - active5} студентов без действий</div>
        </div>
        <div className="stat">
          <div className="stat-label">SP сделано {p.sprintNo ? 'в спринте' : 'за период'}</div>
          <div className="stat-value">
            {spDone} <small>/ {spTotal}</small>
          </div>
          <div className="stat-sub">{bd ? `день ${bd.today} из ${bd.days} · план ${Math.round(spTotal * (bd.today / bd.days))}` : p.label}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Соблюдение сроков</div>
          <div className="stat-value">
            {onTime}
            <small>%</small>
          </div>
          <div className="stat-sub">
            {prevOnTime !== null ? (
              onTime >= prevOnTime ? (
                <span className="green">▲ {onTime - prevOnTime} п. к спринту {(p.sprintNo ?? 2) - 1}</span>
              ) : (
                <span className="orange">▼ {prevOnTime - onTime} п. к спринту {(p.sprintNo ?? 2) - 1}</span>
              )
            ) : (
              'доля карточек, закрытых до дедлайна'
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Проходят допуск (РД ≥ {state.settings.admissionThreshold})</div>
          <div className="stat-value">
            {admitted} <small>/ {students.length}</small>
          </div>
          <div className="stat-sub orange">{students.length - admitted} студентов ниже порога</div>
        </div>
      </div>

      <div className="an-grid">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Команды · {p.label.toLowerCase()}</div>
            <span className="tiny muted hide-sm">
              Нагрузка: доля story points каждого участника в Done. Норма {state.settings.signalShareMin}–{state.settings.signalShareMax}%.
            </span>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Команда</th>
                  <th className="num">SP сделано</th>
                  <th className="num">В срок</th>
                  <th className="num">Просрочено</th>
                  <th className="num">Чат / нед</th>
                  <th>Нагрузка</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t, m }) => {
                  const sm = state.users.find((u) => t.memberIds.includes(u.id) && u.teamRole === 'Scrum Master')
                  const bad = m.load.some((l) => l.pct < state.settings.signalShareMin || l.pct > state.settings.signalShareMax) && m.spDone > 0
                  return (
                    <tr key={t.id} className="clickable" onClick={() => setTeamOpen(t)}>
                      <td>
                        <div className="bold">{t.name}</div>
                        <div className="tiny muted">
                          {t.memberIds.length} чел. · SM {sm ? shortName(sm.name) : '—'}
                        </div>
                      </td>
                      <td className="num">
                        {m.spDone} / {m.spTotal}
                      </td>
                      <td className={`num ${m.onTimePct !== null && m.onTimePct < 70 ? 'orange bold' : ''}`}>{m.onTimePct ?? '—'}%</td>
                      <td className={`num ${m.overduePct > state.settings.signalOverduePct ? 'orange bold' : ''}`}>{m.overdue}</td>
                      <td className="num">{m.chatPerWeek}</td>
                      <td>
                        <div className="loadbar">
                          {m.load.map((l, i) => (
                            <div key={l.id} style={{ width: `${Math.max(l.pct, 2)}%`, background: LOAD_COLORS[i] ?? '#ddd' }} title={`${state.users.find((u) => u.id === l.id)?.name}: ${l.pct}%`} />
                          ))}
                        </div>
                        <div className={`tiny mono ${bad ? 'orange bold' : 'muted'}`} style={{ marginTop: 4 }}>
                          {m.load.map((l) => l.pct).join(' · ')}%
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Сигналы</div>
            <span className="small orange bold">{signals.length} новых</span>
          </div>
          {!signals.length && <Empty>Сигналов нет</Empty>}
          {signals.map((s) => (
            <div key={s.id} className="signal">
              <div className="signal-kind">{s.kind}</div>
              <div className="signal-text">{s.text}</div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => navigate(s.action.to)}>
                  {s.action.label}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => act(dismissSignal(s.id))}>
                  Скрыть
                </button>
              </div>
            </div>
          ))}
          <div className="tiny muted">Пороги сигналов настраиваются в настройках курса</div>
        </div>
      </div>
      {lockOpen && <LockModal onClose={() => setLockOpen(false)} />}
      {teamOpen && <TeamDrill team={teamOpen} period={p} sprintId={sprintOf(teamOpen)?.id} onClose={() => setTeamOpen(null)} />}
    </>
  )
}

function TeamDrill({ team, period, sprintId, onClose }: { team: Team; period: Period; sprintId?: string; onClose: () => void }) {
  const { state } = useMe()
  const m = teamMetrics(state, team, period, sprintId)
  return (
    <Modal title={`${team.name} · ${period.label}`} wide onClose={onClose}>
      <div className="stat-row" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">SP сделано</div>
          <div className="stat-value">
            {m.spDone} <small>/ {m.spTotal}</small>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">В срок</div>
          <div className="stat-value">{m.onTimePct ?? '—'}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Время выполнения</div>
          <div className="stat-value">
            {m.cycleDays !== null ? fmtNum(m.cycleDays) : '—'} <small>дн.</small>
          </div>
          <div className="stat-sub">от In Progress до Done</div>
        </div>
        <div className="stat">
          <div className="stat-label">Просрочено сейчас</div>
          <div className="stat-value orange">{m.overdue}</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Участник</th>
              <th className="num">Создал</th>
              <th className="num">Выполнил</th>
              <th className="num">В срок</th>
              <th className="num">Просроч.</th>
              <th className="num">Чат/нед</th>
              <th className="num">Доля SP</th>
              <th className="num">Р1 / Р2</th>
              <th>Последнее действие</th>
            </tr>
          </thead>
          <tbody>
            {team.memberIds.map((id) => {
              const u = state.users.find((x) => x.id === id)!
              const mm = memberMetrics(state, u, period)
              const share = m.load.find((l) => l.id === id)?.pct ?? 0
              const v = scoresOf(state, id)
              return (
                <tr key={id} className="clickable" onClick={() => navigate(`/profile/${id}`)}>
                  <td>
                    <span className="row">
                      <Avatar user={u} size={26} />
                      <span>
                        <div className="bold">{u.name}</div>
                        <div className="tiny muted">{u.teamRole}</div>
                      </span>
                    </span>
                  </td>
                  <td className="num">{mm.created}</td>
                  <td className="num">{mm.done}</td>
                  <td className="num">{mm.onTimePct ?? '—'}%</td>
                  <td className={`num ${mm.overdue ? 'orange' : ''}`}>{mm.overdue}</td>
                  <td className="num">{mm.chatPerWeek}</td>
                  <td className={`num ${share < state.settings.signalShareMin || share > state.settings.signalShareMax ? 'orange bold' : ''}`}>{share}%</td>
                  <td className="num">
                    {Math.round(v?.R1 ?? 0)} / {Math.round(v?.R2 ?? 0)}
                  </td>
                  <td className={`small ${now() - u.lastActiveAt > state.settings.signalInactiveDays * DAY ? 'orange' : 'muted'}`}>{fmtAgo(u.lastActiveAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => navigate(`/board/${team.id}`)}>
          Открыть доску
        </button>
        <button className="btn" onClick={() => navigate(`/channels/${team.channelId}`)}>
          Открыть канал
        </button>
        {activeSprint(state, team.id) && <span className="tiny muted">Активный спринт: {activeSprint(state, team.id)!.name}</span>}
      </div>
    </Modal>
  )
}

function LockModal({ onClose }: { onClose: () => void }) {
  const { state, act } = useMe()
  const [scope, setScope] = useState<'all' | 'team' | 'assignment'>('all')
  const [target, setTarget] = useState(state.teams[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [when, setWhen] = useState<'now' | 'at'>('now')
  const [at, setAt] = useState(toInputDT(now() + 60 * 60000))
  const locks = state.locks.filter((l) => !l.cancelled).sort((a, b) => a.from - b.from)
  return (
    <Modal title="Блокировка «только чтение»" onClose={onClose}>
      <div className="stack">
        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v)
            setTarget(v === 'team' ? state.teams[0].id : v === 'assignment' ? state.assignments[0].id : '')
          }}
          options={[
            { value: 'all', label: 'Все доски' },
            { value: 'team', label: 'Доска команды' },
            { value: 'assignment', label: 'Задание' },
          ]}
        />
        {scope !== 'all' && (
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {(scope === 'team' ? state.teams.map((t) => ({ id: t.id, name: t.name })) : state.assignments.map((a) => ({ id: a.id, name: a.title }))).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <Field label="Причина (студенты увидят на баннере)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Дедлайн РК2 — доски только для чтения" />
        </Field>
        <div className="row wrap">
          <label className="row small">
            <input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Сейчас
          </label>
          <label className="row small">
            <input type="radio" checked={when === 'at'} onChange={() => setWhen('at')} /> По расписанию
          </label>
          {when === 'at' && <input className="input input-sm" style={{ width: 200 }} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}
        </div>
        <button className="btn btn-dark" onClick={() => act(addLock(scope, target || undefined, reason, when === 'now' ? now() : fromInputDT(at)!), when === 'now' ? 'Блокировка включена' : 'Блокировка запланирована') && setReason('')}>
          {when === 'now' ? 'Заблокировать' : 'Запланировать'}
        </button>
        <div className="label-caps">Блокировки</div>
        {!locks.length && <div className="small muted">Нет</div>}
        {locks.map((l) => (
          <div key={l.id} className="row-between small" style={{ padding: '6px 0', borderTop: '1px solid var(--line-2)' }}>
            <span>
              <b>{l.scope === 'all' ? 'Все доски' : l.scope === 'team' ? state.teams.find((t) => t.id === l.targetId)?.name : state.assignments.find((a) => a.id === l.targetId)?.title}</b> · «{l.reason}»
              <div className="tiny muted">{l.from > now() ? `сработает ${fmtDateTime(l.from)}` : `действует с ${fmtDateTime(l.from)}`}</div>
            </span>
            <button className="btn btn-sm" onClick={() => act(cancelLock(l.id), 'Блокировка снята')}>
              Снять
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
