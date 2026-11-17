import { useMemo, useState } from 'react'
import { useMe } from '../store'
import { Link, navigate } from '../router'
import { Avatar, Empty, Field, Icon, Modal, PageHead } from '../components/ui'
import type { Team, TeamRole, User } from '../types'
import { allScores, checkTeam, scoresOf } from '../lib/rules'
import { avg, fmtDateTime, fmtDayLong, fmtLeft, fmtTime, fmtWeekday, now, plural } from '../lib/util'
import {
  answerRequest, autoDistribute, createDraftTeam, freezeTeams, inviteStudent, moveStudentTeam, removeFromDraft, renameTeam, requestJoin, reviewTeam, setMemberRole, setProjectScore, setTeamRole, submitTeam,
} from '../data/actions'

const STATUS: Record<Team['status'], [string, string]> = {
  draft: ['Черновик', 'pill-todo'],
  pending: ['На утверждении', 'pill-blue'],
  approved: ['Утверждена', 'pill-done'],
  returned: ['Возвращена', 'pill-orange'],
}

export function Countdown({ deadline }: { deadline: number }) {
  const left = deadline - now()
  return (
    <div className="countdown">
      <span>Окно закрывается</span>
      <b>{fmtLeft(left)}</b>
      <span style={{ color: '#a8a9ae' }}>
        {fmtWeekday(deadline).toLowerCase()} {fmtDayLong(deadline)}, {fmtTime(deadline)}
      </span>
    </div>
  )
}

export default function Teams() {
  const { state } = useMe()
  return state.formation ? <Formation /> : <Frozen />
}

/* ─────────── Студент: окно формирования ─────────── */

function Formation() {
  const { me, state, act } = useMe()
  const f = state.formation!
  const myTeam = f.teams.find((t) => t.memberIds.includes(me.id))
  const [name, setName] = useState('')
  const [idea, setIdea] = useState('')
  const invites = f.requests.filter((r) => r.studentId === me.id && r.kind === 'invite')
  const myReqs = f.requests.filter((r) => r.studentId === me.id && r.kind === 'request')

  return (
    <>
      <PageHead crumb="Неделя 9 · Окно формирования команд" title="Соберите команду" actions={<Countdown deadline={f.deadline} />} />
      <div className="teams-grid">
        <div className="stack">
          {myTeam ? (
            <DraftCard team={myTeam} />
          ) : (
            <>
              {invites.length > 0 && (
                <div className="card">
                  <div className="card-title">Приглашения</div>
                  {invites.map((r) => {
                    const t = f.teams.find((x) => x.id === r.teamId)!
                    return (
                      <div key={r.id} className="row-between" style={{ padding: '8px 0' }}>
                        <span>
                          <b>{t.name}</b> <span className="muted small">· {t.idea}</span>
                        </span>
                        <span className="row">
                          <button className="btn btn-sm btn-dark" onClick={() => act(answerRequest(r.id, true), `Вы в команде ${t.name}`)}>
                            Принять
                          </button>
                          <button className="btn btn-sm" onClick={() => act(answerRequest(r.id, false))}>
                            Отклонить
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="card">
                <div className="card-title">Создать команду</div>
                <div className="stack-sm">
                  <input className="input" placeholder="Название команды" value={name} onChange={(e) => setName(e.target.value)} />
                  <textarea className="textarea" placeholder="Идея проекта" value={idea} onChange={(e) => setIdea(e.target.value)} />
                  <button className="btn btn-primary" onClick={() => act(createDraftTeam(name, idea), 'Команда создана — вы инициатор')}>
                    Создать и стать инициатором
                  </button>
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Команды курса</div>
                  <span className="tiny muted">Активных заявок: {myReqs.length} из 3</span>
                </div>
                {f.teams.map((t) => {
                  const sent = myReqs.some((r) => r.teamId === t.id)
                  return (
                    <div key={t.id} className="student-row">
                      <span className="avatar" style={{ width: 36, height: 36 }}>
                        {t.memberIds.length}
                      </span>
                      <div>
                        <div className="bold">
                          {t.name} <span className={`pill ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span>
                        </div>
                        <div className="tiny muted">
                          {t.idea} · {t.memberIds.length}/{state.settings.teamMax}
                        </div>
                      </div>
                      <button className="btn btn-sm" disabled={sent || t.memberIds.length >= state.settings.teamMax || t.status === 'approved'} onClick={() => act(requestJoin(t.id), 'Заявка отправлена')}>
                        {sent ? 'Заявка отправлена' : 'Подать заявку'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <FreeStudents canInvite={!!myTeam && myTeam.initiatorId === me.id} teamId={myTeam?.id} />
      </div>
    </>
  )
}

function DraftCard({ team }: { team: Team }) {
  const { me, state, act } = useMe()
  const f = state.formation!
  const init = team.initiatorId === me.id
  const reqs = f.requests.filter((r) => r.teamId === team.id && r.kind === 'request')
  const checks = checkTeam(state, team, team.roles ?? {})
  const bad = checks.filter((c) => !c.ok)
  const editable = init && team.status !== 'approved' && team.status !== 'pending'
  const sc = allScores(state)
  return (
    <div className="card">
      <div className="row-between">
        <div className="label-caps" style={{ margin: 0 }}>
          {team.status === 'draft' ? 'Черновик команды' : STATUS[team.status][0]}
        </div>
        <span className="pill pill-todo mono">
          {team.memberIds.length} / {state.settings.teamMax}
        </span>
      </div>
      <h2 style={{ fontSize: 20, margin: '4px 0' }}>{team.name}</h2>
      <div className="small muted" style={{ marginBottom: 10 }}>
        Идея: {team.idea}
      </div>
      {team.status === 'returned' && (
        <div className="banner">
          <Icon name="alert" size={16} /> Преподаватель вернул: «{team.returnComment}»
        </div>
      )}
      {team.status === 'pending' && (
        <div className="banner banner-blue">
          <Icon name="clock" size={16} /> Отправлено на утверждение преподавателю
        </div>
      )}
      {team.status === 'approved' && (
        <div className="banner banner-blue">
          <Icon name="check" size={16} /> Состав утверждён{team.approvedOverride ? ` в обход правил: «${team.approvedOverride}»` : ''}
        </div>
      )}
      {team.memberIds.map((id) => {
        const u = state.users.find((x) => x.id === id)!
        return (
          <div key={id} className="member-line">
            <Avatar user={u} size={36} />
            <div>
              <div className="bold">{u.name}</div>
              <div className="tiny muted">
                Р1 {Math.round(sc.get(id)?.R1 ?? 0)} · хочет: {u.wantedRoles.join(', ') || '—'}
              </div>
            </div>
            <Field label="Роль">
              <select className="select" disabled={!editable} value={team.roles?.[id] ?? ''} onChange={(e) => act(setMemberRole(team.id, id, e.target.value as TeamRole))}>
                <option value="">—</option>
                {state.settings.roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            {(editable && id !== me.id) || (id === me.id && !init && team.status !== 'approved') ? (
              <button className="icon-btn" title={id === me.id ? 'Выйти из команды' : 'Исключить'} onClick={() => confirm(id === me.id ? 'Выйти из команды?' : `Исключить ${u.name}?`) && act(removeFromDraft(team.id, id))}>
                <Icon name="x" size={15} />
              </button>
            ) : (
              <span />
            )}
          </div>
        )
      })}
      {init &&
        reqs.map((r) => {
          const u = state.users.find((x) => x.id === r.studentId)!
          return (
            <div key={r.id} className="request-box">
              <div className="label-caps" style={{ margin: '0 0 6px' }}>
                Заявка · {reqs.length} {plural(reqs.length, 'новая', 'новые', 'новых')}
              </div>
              <div className="row-between wrap">
                <span className="small">
                  <b>{u.name}</b> · Р1 {Math.round(sc.get(u.id)?.R1 ?? 0)} · {u.wantedRoles[0]}
                </span>
                <span className="row">
                  <button className="btn btn-sm btn-dark" onClick={() => act(answerRequest(r.id, true), `${u.name} в команде`)}>
                    Принять
                  </button>
                  <button className="btn btn-sm" onClick={() => act(answerRequest(r.id, false))}>
                    Отклонить
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      <div className="bold small" style={{ margin: '16px 0 6px' }}>
        Проверка перед отправкой
      </div>
      {checks.map((c) => (
        <div key={c.label} className="rule">
          <span className={`rule-ic ${c.ok ? '' : 'bad'}`}>{c.ok ? <Icon name="check" size={12} /> : '!'}</span>
          {c.label}
          <span className={`val ${c.ok ? '' : 'bad'}`}>{c.value}</span>
        </div>
      ))}
      {init && editable && (
        <button className={`btn btn-block ${bad.length ? '' : 'btn-primary'}`} style={{ marginTop: 14, height: 44 }} disabled={!!bad.length} onClick={() => act(submitTeam(team.id), 'Команда отправлена на утверждение')}>
          {bad.length ? hint(bad[0].label) : 'Отправить на утверждение'}
        </button>
      )}
    </div>
  )
}

const hint = (label: string) =>
  label.includes('Scrum') ? 'Назначьте Scrum Master, чтобы отправить' : label.includes('Team Lead') ? 'Назначьте одного Team Lead' : label.includes('Р1') ? 'Средний Р1 ниже порога' : 'Размер команды не подходит'

function FreeStudents({ canInvite, teamId }: { canInvite: boolean; teamId?: string }) {
  const { state, act } = useMe()
  const f = state.formation!
  const inTeam = new Set(f.teams.flatMap((t) => t.memberIds))
  const sc = allScores(state)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [hi, setHi] = useState(false)
  const free = useMemo(
    () =>
      state.users
        .filter((u) => u.role === 'student' && u.courseIds.includes(state.course.id) && !inTeam.has(u.id))
        .filter((u) => {
          const s = q.trim().toLowerCase()
          return !s || u.name.toLowerCase().includes(s) || u.skills.some((k) => k.toLowerCase().includes(s)) || u.wantedRoles.some((r) => r.toLowerCase().includes(s))
        })
        .filter((u) => !role || u.wantedRoles.includes(role as TeamRole))
        .filter((u) => !hi || (sc.get(u.id)?.R1 ?? 0) >= 60)
        .sort((a, b) => (f.requests.some((r) => r.studentId === b.id) ? 1 : 0) - (f.requests.some((r) => r.studentId === a.id) ? 1 : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, q, role, hi],
  )
  const total = state.users.filter((u) => u.role === 'student' && u.courseIds.includes(state.course.id) && !inTeam.has(u.id)).length
  return (
    <div className="card">
      <div className="card-title" style={{ fontSize: 18 }}>
        Студенты без команды · {total}
      </div>
      <div className="search" style={{ marginBottom: 10 }}>
        <Icon name="search" size={15} />
        <input className="input" placeholder="Имя, навык или роль" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row wrap" style={{ marginBottom: 6 }}>
        {['', 'Scrum Master', 'Designer', 'QA', 'Analyst', 'Developer'].map((r) => (
          <button key={r} className={`chip chip-btn ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>
            {r || 'Все роли'}
          </button>
        ))}
        <button className={`chip chip-btn ${hi ? 'on' : ''}`} onClick={() => setHi(!hi)}>
          Р1 ≥ 60
        </button>
      </div>
      {free.map((u) => {
        const invited = teamId && f.requests.some((r) => r.teamId === teamId && r.studentId === u.id)
        return (
          <div key={u.id} className="student-row">
            <Avatar user={u} size={36} />
            <div style={{ minWidth: 0 }}>
              <div>
                <Link to={`/profile/${u.id}`} className="bold">
                  {u.name}
                </Link>{' '}
                <span className="tiny muted">Р1 {Math.round(sc.get(u.id)?.R1 ?? 0)}</span>
              </div>
              <div className="small muted">{u.skills.slice(0, 3).join(' · ')}</div>
              <div className="tiny blue bold">Хочет: {u.wantedRoles.join(', ')}</div>
            </div>
            {canInvite && teamId && (
              <button className="btn btn-sm" disabled={!!invited} onClick={() => act(inviteStudent(teamId, u.id), `Приглашение отправлено`)}>
                {invited ? 'Приглашён' : 'Пригласить'}
              </button>
            )}
          </div>
        )
      })}
      {!free.length && <Empty>Никого не нашли</Empty>}
    </div>
  )
}

/* ─────────── Студент: составы заморожены ─────────── */

function Frozen() {
  const { me, state } = useMe()
  const mine = state.teams.find((t) => t.id === me.teamId)
  const [q, setQ] = useState('')
  const list = state.teams.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.idea.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHead crumb={`${state.course.name} · ${state.course.stream}`} title="Команды" />
      <div className="banner banner-blue">
        <Icon name="lock" size={16} /> Составы команд заморожены в конце 9 недели. Изменить состав может только преподаватель.
      </div>
      <div className="teams-grid">
        <div className="stack">
          {mine ? (
            <TeamTile team={mine} big />
          ) : (
            <div className="card">
              <Empty>Вы не состоите в команде. Обратитесь к преподавателю.</Empty>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Все команды · {state.teams.length}</div>
            <input className="input input-sm" style={{ width: 180 }} placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="stack-sm">
            {list.map((t) => (
              <TeamTile key={t.id} team={t} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function TeamTile({ team, big }: { team: Team; big?: boolean }) {
  const { state } = useMe()
  const members = team.memberIds.map((id) => state.users.find((u) => u.id === id)!)
  const avgR1 = avg(team.memberIds.map((id) => scoresOf(state, id)?.R1 ?? 0))
  return (
    <div className={big ? 'card' : 'team-tile'}>
      <div className="row-between">
        <div>
          <div className="bold" style={{ fontSize: big ? 18 : 14 }}>
            {team.name}
          </div>
          <div className="tiny muted">{team.idea}</div>
        </div>
        <span className="tiny muted">ср. Р1 {Math.round(avgR1)}</span>
      </div>
      <div className={big ? 'stack-sm' : 'row wrap'} style={{ marginTop: 10 }}>
        {members.map((u) =>
          big ? (
            <div key={u.id} className="member-row">
              <Avatar user={u} size={32} />
              <Link to={`/profile/${u.id}`} className="grow">
                <div className="bold small">{u.name}</div>
                <div className="tiny muted">{u.teamRole}</div>
              </Link>
            </div>
          ) : (
            <Link key={u.id} to={`/profile/${u.id}`} className="chip">
              {u.name.split(' ')[0]} · <span className="muted">{u.teamRole}</span>
            </Link>
          ),
        )}
      </div>
      {big && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => navigate('/board')}>
            Доска
          </button>
          <button className="btn btn-sm" onClick={() => navigate('/chat')}>
            Чат команды
          </button>
        </div>
      )}
    </div>
  )
}

/* ─────────── Преподаватель ─────────── */

export function TeacherTeams() {
  const { me, state, act } = useMe()
  const f = state.formation
  const [ret, setRet] = useState<{ id: string; mode: 'return' | 'override' } | null>(null)
  const [comment, setComment] = useState('')
  if (!f) return <FrozenAdmin />
  const inTeam = new Set(f.teams.flatMap((t) => t.memberIds))
  const free = state.users.filter((u) => u.role === 'student' && u.courseIds.includes(state.course.id) && !inTeam.has(u.id))
  const order: Team['status'][] = ['pending', 'returned', 'draft', 'approved']
  const teams = [...f.teams].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  return (
    <>
      <PageHead
        crumb="Окно формирования команд"
        title="Команды"
        actions={
          <>
            <Countdown deadline={f.deadline} />
            <button className="btn" onClick={() => act(autoDistribute, 'Студенты распределены по неполным командам')}>
              Распределить без команды · {free.length}
            </button>
            {me.role === 'teacher' && (
              <button className="btn btn-dark" onClick={() => confirm('Заморозить составы? После этого их меняет только преподаватель.') && act(freezeTeams, 'Составы заморожены')}>
                Заморозить составы
              </button>
            )}
          </>
        }
      />
      <div className="stack">
        {teams.map((t) => {
          const checks = checkTeam(state, t, t.roles ?? {})
          const ok = checks.every((c) => c.ok)
          return (
            <div key={t.id} className="card">
              <div className="row-between wrap">
                <div>
                  <div className="row">
                    <b style={{ fontSize: 16 }}>{t.name}</b>
                    <span className={`pill ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span>
                  </div>
                  <div className="small muted">{t.idea}</div>
                </div>
                {t.status !== 'approved' && (
                  <div className="row">
                    <button className="btn btn-sm btn-primary" disabled={!ok} onClick={() => act(reviewTeam(t.id, 'approve'), 'Состав утверждён')}>
                      Утвердить
                    </button>
                    {!ok && (
                      <button className="btn btn-sm" onClick={() => (setRet({ id: t.id, mode: 'override' }), setComment(''))}>
                        В обход правил…
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={() => (setRet({ id: t.id, mode: 'return' }), setComment(''))}>
                      Вернуть
                    </button>
                  </div>
                )}
              </div>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div>
                  {t.memberIds.map((id) => {
                    const u = state.users.find((x) => x.id === id)!
                    return (
                      <div key={id} className="row small" style={{ padding: '3px 0' }}>
                        <Avatar user={u} size={22} /> {u.name} <span className="muted">· {t.roles?.[id] ?? '—'}</span>
                        {id === t.initiatorId && <span className="tiny muted">(инициатор)</span>}
                      </div>
                    )
                  })}
                </div>
                <div>
                  {checks.map((c) => (
                    <div key={c.label} className="rule">
                      <span className={`rule-ic ${c.ok ? '' : 'bad'}`}>{c.ok ? <Icon name="check" size={12} /> : '!'}</span>
                      <span className="small">{c.label}</span>
                      <span className={`val ${c.ok ? '' : 'bad'}`}>{c.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {t.approvedOverride && <div className="tiny muted">Утверждена в обход правил: «{t.approvedOverride}»</div>}
              {t.returnComment && t.status === 'returned' && <div className="tiny orange">Возвращена: «{t.returnComment}»</div>}
            </div>
          )
        })}
      </div>
      {ret && (
        <Modal
          title={ret.mode === 'return' ? 'Вернуть команду с комментарием' : 'Утвердить в обход правил'}
          onClose={() => setRet(null)}
          footer={
            <button className="btn btn-primary" onClick={() => act(reviewTeam(ret.id, ret.mode, comment), ret.mode === 'return' ? 'Команда возвращена' : 'Состав утверждён') && setRet(null)}>
              {ret.mode === 'return' ? 'Вернуть' : 'Утвердить'}
            </button>
          }
        >
          <Field label={ret.mode === 'return' ? 'Что исправить' : 'Причина (попадёт в журнал)'}>
            <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </>
  )
}

function FrozenAdmin() {
  const { me, state, act } = useMe()
  const [move, setMove] = useState<User | null>(null)
  const [target, setTarget] = useState('')
  const [rename, setRename] = useState<Team | null>(null)
  const [name, setName] = useState('')
  return (
    <>
      <PageHead crumb={`${state.course.name} · ${state.course.stream}`} title="Команды" />
      <div className="banner banner-blue">
        <Icon name="lock" size={16} /> Составы заморожены — изменить их может только преподаватель или ассистент. Все изменения попадают в журнал.
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Команда</th>
                <th>Состав и роли</th>
                <th className="num">Ср. Р1</th>
                <th className="num">Проект (П)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.teams.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="bold">{t.name}</div>
                    <div className="tiny muted">{t.idea}</div>
                  </td>
                  <td>
                    <div className="row wrap" style={{ gap: 4 }}>
                      {t.memberIds.map((id) => {
                        const u = state.users.find((x) => x.id === id)!
                        return (
                          <span key={id} className="chip" style={{ padding: '2px 4px 2px 10px' }}>
                            <Link to={`/profile/${id}`}>{u.name.split(' ')[0]}</Link>
                            <select className="select select-sm" style={{ height: 24, width: 'auto', border: 0, background: 'transparent', padding: '0 4px', fontSize: 11 }} value={u.teamRole} onChange={(e) => act(setTeamRole(id, e.target.value as TeamRole), 'Роль изменена')}>
                              {state.settings.roles.map((r) => (
                                <option key={r}>{r}</option>
                              ))}
                            </select>
                            <button title="Перевести в другую команду" onClick={() => (setMove(u), setTarget(''))}>
                              <Icon name="arrow" size={12} />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="num">{Math.round(avg(t.memberIds.map((id) => scoresOf(state, id)?.R1 ?? 0)))}</td>
                  <td className="num">
                    {me.role === 'teacher' ? (
                      <input
                        className="input input-sm"
                        type="number"
                        min={0}
                        max={60}
                        style={{ width: 70, textAlign: 'right' }}
                        defaultValue={t.projectScore}
                        onBlur={(e) => Number(e.target.value) !== t.projectScore && act(setProjectScore(t.id, Number(e.target.value)), `Балл проекта ${t.name} сохранён`)}
                      />
                    ) : (
                      t.projectScore
                    )}
                  </td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => navigate(`/board/${t.id}`)}>
                      Доска
                    </button>{' '}
                    <button className="btn btn-sm btn-ghost" onClick={() => (setRename(t), setName(t.name))}>
                      <Icon name="edit" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tiny muted" style={{ marginTop: 10 }}>
          Последняя заморозка: {fmtDateTime(state.course.start + 9 * 7 * 86400000 - 60000)}
        </div>
      </div>
      {move && (
        <Modal
          title={`Перевести ${move.name}`}
          onClose={() => setMove(null)}
          footer={
            <button className="btn btn-primary" disabled={!target} onClick={() => act(moveStudentTeam(move.id, target), 'Студент переведён') && setMove(null)}>
              Перевести
            </button>
          }
        >
          <Field label="В команду">
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">—</option>
              {state.teams
                .filter((t) => t.id !== move.teamId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.memberIds.length} чел.
                  </option>
                ))}
            </select>
          </Field>
        </Modal>
      )}
      {rename && (
        <Modal title="Переименовать команду" onClose={() => setRename(null)} footer={<button className="btn btn-primary" onClick={() => act(renameTeam(rename.id, name), 'Переименовано') && setRename(null)}>Сохранить</button>}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Modal>
      )}
    </>
  )
}

