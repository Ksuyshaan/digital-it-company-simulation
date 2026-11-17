import { useMemo, useState } from 'react'
import { useMe } from '../store'
import { Link, navigate, useRoute } from '../router'
import { Avatar, Empty, Field, FilePick, Icon, Modal, Segmented } from '../components/ui'
import type { Link as UrlLink, TeamRole, User } from '../types'
import { BADGES, allScores, badgesOf, courseWeek, finalGrade, isStaff, reviewCounts, scoresOf, submittedAt, teamScores } from '../lib/rules'
import { fmtAgo, fmtDay, fmtNum, round1 } from '../lib/util'
import { adjustPoints, grantBadge, setProjectAdjust, updateProfile } from '../data/actions'

export default function Profile() {
  const { me, state } = useMe()
  const { segments } = useRoute()
  const id = segments[1] ?? (me.role === 'student' ? me.id : undefined)
  const user = state.users.find((u) => u.id === id)
  return (
    <div className="profile-grid">
      <div className="stack">
        {user ? (
          <>
            <ProfileCard user={user} />
            {user.role === 'student' && <Achievements user={user} />}
            {user.role === 'student' && <Activity user={user} />}
          </>
        ) : (
          <div className="card">
            <Empty>Выберите студента в рейтинге, чтобы открыть профиль</Empty>
          </div>
        )}
      </div>
      <div className="stack">
        <Rating highlight={user?.id} />
        {user && user.role === 'student' && (me.id === user.id || isStaff(me)) && <Breakdown user={user} />}
      </div>
    </div>
  )
}

function ProfileCard({ user }: { user: User }) {
  const { me, state } = useMe()
  const [edit, setEdit] = useState(false)
  const [points, setPoints] = useState(false)
  const team = state.teams.find((t) => t.id === user.teamId)
  const own = me.id === user.id
  return (
    <div className="card">
      <div className="profile-head">
        <Avatar user={user} size={64} />
        <div className="grow">
          <h2>{user.name}</h2>
          <div className="small muted">
            {user.group ? `Группа ${user.group} · ` : ''}
            {user.email}
          </div>
          {team && (
            <div className="small blue bold">
              {user.teamRole} · {team.name}
            </div>
          )}
        </div>
      </div>
      {user.about ? <p style={{ margin: '0 0 6px', color: 'var(--ink-2)' }}>{user.about}</p> : <p className="muted small">Профиль ещё не заполнен</p>}
      {user.skills.length > 0 && (
        <>
          <div className="label-caps">Навыки</div>
          <div className="row wrap">
            {user.skills.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
        </>
      )}
      {user.wantedRoles.length > 0 && (
        <>
          <div className="label-caps">Желаемые роли</div>
          <div className="row wrap">
            {user.wantedRoles.map((s) => (
              <span key={s} className="chip chip-blue">
                {s}
              </span>
            ))}
          </div>
        </>
      )}
      {user.links.length > 0 && (
        <div className="row wrap" style={{ marginTop: 14, gap: 14 }}>
          {user.links.map((l) => (
            <a key={l.url + l.label} href={l.url} target="_blank" rel="noreferrer" className="small blue" style={{ textDecoration: 'underline' }}>
              {l.label}
            </a>
          ))}
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 16 }}>
        {own && user.role === 'student' && (
          <button className="btn btn-sm" onClick={() => setEdit(true)}>
            <Icon name="edit" size={14} /> Редактировать профиль
          </button>
        )}
        {isStaff(me) && user.role === 'student' && (
          <>
            <button className="btn btn-sm" onClick={() => setPoints(true)}>
              ± Баллы
            </button>
            {team && (
              <button className="btn btn-sm" onClick={() => navigate(`/board/${team.id}`)}>
                Доска команды
              </button>
            )}
          </>
        )}
        {!own && user.role === 'student' && <span className="tiny muted">Был(а) в системе {fmtAgo(user.lastActiveAt)}</span>}
      </div>
      {edit && <EditProfile onClose={() => setEdit(false)} />}
      {points && <PointsModal user={user} onClose={() => setPoints(false)} />}
    </div>
  )
}

function EditProfile({ onClose }: { onClose: () => void }) {
  const { me, state, act, toast } = useMe()
  const [about, setAbout] = useState(me.about)
  const [skills, setSkills] = useState<string[]>(me.skills)
  const [custom, setCustom] = useState('')
  const [roles, setRoles] = useState<TeamRole[]>(me.wantedRoles)
  const [links, setLinks] = useState<UrlLink[]>(me.links)
  const [photo, setPhoto] = useState(me.photo)
  const toggleSkill = (s: string) => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s])
  return (
    <Modal
      title="Профиль"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => act(updateProfile({ about, skills, wantedRoles: roles, links, photo }), 'Профиль сохранён') && onClose()}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <Avatar user={{ ...me, photo }} size={56} />
          <FilePick
            multiple={false}
            accept="image/png,image/jpeg"
            onFiles={([f]) => {
              if (!/\.(jpe?g|png)$/i.test(f.name)) return toast('Фото — только JPG или PNG', 'error')
              if (f.size > 5 * 1024 * 1024) return toast('Фото — до 5 МБ', 'error')
              const r = new FileReader()
              r.onload = () => setPhoto(String(r.result))
              r.readAsDataURL(f)
            }}
          >
            <span className="btn btn-sm">Загрузить фото</span>
          </FilePick>
          {photo && (
            <button className="btn btn-sm btn-ghost" onClick={() => setPhoto(undefined)}>
              Убрать
            </button>
          )}
          <span className="tiny muted">JPG/PNG до 5 МБ, необязательно</span>
        </div>
        <div className="grid-2">
          <Field label="ФИО (из корпоративной учётной записи)">
            <input className="input" value={me.name} disabled />
          </Field>
          <Field label="E-mail, группа">
            <input className="input" value={`${me.email} · ${me.group}`} disabled />
          </Field>
        </div>
        <Field label={`О себе · ${about.length}/500`} error={!about.trim() ? 'Обязательное поле' : null}>
          <textarea className="textarea" maxLength={500} value={about} onChange={(e) => setAbout(e.target.value)} />
        </Field>
        <Field label={`Навыки · ${skills.length} (от 3 до 15)`} error={skills.length < 3 || skills.length > 15 ? 'Выберите от 3 до 15 навыков' : null}>
          <div className="row wrap">
            {[...new Set([...state.settings.skillDictionary, ...skills])].map((s) => (
              <button key={s} type="button" className={`chip chip-btn ${skills.includes(s) ? 'on' : ''}`} onClick={() => toggleSkill(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input input-sm" placeholder="Свой навык" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                if (custom.trim() && !skills.includes(custom.trim())) setSkills([...skills, custom.trim()])
                setCustom('')
              }}
            >
              Добавить
            </button>
          </div>
        </Field>
        <Field label="Желаемая роль в команде (до 2)">
          <div className="row wrap">
            {state.settings.roles.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip chip-btn ${roles.includes(r) ? 'on' : ''}`}
                onClick={() => (roles.includes(r) ? setRoles(roles.filter((x) => x !== r)) : roles.length < 2 ? setRoles([...roles, r]) : toast('Можно выбрать не больше двух ролей', 'warn'))}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Ссылки · ${links.length}/5`}>
          <div className="stack-sm">
            {links.map((l, i) => (
              <div key={i} className="row">
                <input className="input input-sm" style={{ width: 140 }} value={l.label} placeholder="GitHub" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className="input input-sm" value={l.url} placeholder="https://" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button type="button" className="icon-btn" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {links.length < 5 && (
              <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLinks([...links, { label: '', url: 'https://' }])}>
                + Ссылка
              </button>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

function PointsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { me, act, state } = useMe()
  const [comp, setComp] = useState<'A' | 'K' | 'P'>('A')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [pct, setPct] = useState(String(Math.round((user.projectAdjust ?? 0) * 100)))
  const [pctReason, setPctReason] = useState('')
  const [badge, setBadge] = useState(BADGES[2].key)
  const sc = scoresOf(state, user.id)
  return (
    <Modal title={`Баллы · ${user.name}`} onClose={onClose}>
      <div className="stack">
        <div className="small muted">Любое ручное начисление требует причины, попадает в журнал действий и видно студенту в профиле.</div>
        <div className="grid-3">
          <Field label="Компонент">
            <select className="select" value={comp} onChange={(e) => setComp(e.target.value as 'A')}>
              <option value="A">Активность (А)</option>
              <option value="K">Работа в команде (К)</option>
              <option value="P">Проект (П)</option>
            </select>
          </Field>
          <Field label="Баллы (±)">
            <input className="input" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+3" />
          </Field>
          <Field label="Сейчас">
            <input className="input" disabled value={sc ? `А ${round1(sc.A)} · К ${round1(sc.K)} · П ${round1(sc.P)}` : ''} />
          </Field>
        </div>
        <Field label="Причина (обязательно)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Активность на занятии" />
        </Field>
        <button className="btn btn-primary" onClick={() => act(adjustPoints(user.id, comp, Number(delta), reason), 'Баллы начислены') && (setDelta(''), setReason(''))}>
          Начислить / списать
        </button>
        {comp === 'A' && <div className="tiny muted">Ручная активность учитывается до 7 баллов (п. 7.2)</div>}
        {me.role === 'teacher' && user.teamId && (
          <>
            <div className="divider" />
            <div className="bold small">Индивидуальная поправка к баллу проекта (не более ±20%)</div>
            <div className="row">
              <input className="input" type="number" min={-20} max={20} style={{ width: 100 }} value={pct} onChange={(e) => setPct(e.target.value)} />
              <span>%</span>
              <input className="input" placeholder="Причина, например «нулевой вклад по аналитике»" value={pctReason} onChange={(e) => setPctReason(e.target.value)} />
            </div>
            <button className="btn" onClick={() => act(setProjectAdjust(user.id, Number(pct), pctReason), 'Поправка сохранена')}>
              Применить поправку
            </button>
          </>
        )}
        <div className="divider" />
        <div className="row">
          <select className="select" value={badge} onChange={(e) => setBadge(e.target.value)}>
            {BADGES.map((b) => (
              <option key={b.key} value={b.key}>
                {b.title}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => act(grantBadge(user.id, badge), 'Достижение выдано')}>
            Выдать бейдж
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Achievements({ user }: { user: User }) {
  const { state } = useMe()
  const got = badgesOf(state, user)
  return (
    <div className="card">
      <div className="card-title">
        Достижения · {got.length} из {BADGES.length}
      </div>
      <div className="badges">
        {BADGES.map((b) => (
          <div key={b.key} className={`badge ${got.includes(b.key) ? '' : 'off'}`}>
            <Icon name="award" size={18} />
            {b.title}
          </div>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 10 }}>
        Бейджи не дают баллов
      </div>
    </div>
  )
}

function Activity({ user }: { user: User }) {
  const { state } = useMe()
  const feed = useMemo(() => {
    const res: { at: number; text: string; pts: string }[] = []
    for (const sub of state.submissions.filter((s) => s.studentId === user.id && s.versions.length)) {
      const a = state.assignments.find((x) => x.id === sub.assignmentId)!
      const at = submittedAt(sub)
      const onTime = at <= a.deadline
      res.push({ at, text: `${a.title.split('.')[0]} сдана ${onTime ? 'до дедлайна' : 'с опозданием'}`, pts: onTime && !a.isControl ? '+1' : '—' })
      if (a.isControl && sub.gradedAt) res.push({ at: sub.gradedAt, text: `${a.title.split('.')[0]}: ${finalGrade(a, sub, state)} из ${a.maxScore}`, pts: `+${finalGrade(a, sub, state)}` })
    }
    for (const sub of state.submissions) {
      const a = state.assignments.find((x) => x.id === sub.assignmentId)!
      for (const r of sub.reviews.filter((x) => x.reviewerId === user.id && x.doneAt)) {
        const ok = reviewCounts(r, sub, a, state)
        res.push({ at: r.doneAt!, text: `Peer-review работы «${a.title.replace(/^[^.]*\.\s*/, '')}» ${ok ? 'в срок' : sub.teacherScores ? '— не засчитан (отклонение > 30%)' : '— ждёт оценки преподавателя'}`, pts: ok ? '+2' : '—' })
      }
    }
    for (const adj of state.adjustments.filter((x) => x.studentId === user.id)) res.push({ at: adj.at, text: `${adj.reason} (${adj.component}, ${state.users.find((u) => u.id === adj.byId)?.name ?? ''})`, pts: `${adj.delta > 0 ? '+' : ''}${adj.delta}` })
    const team = state.teams.find((t) => t.id === user.teamId)
    if (team) res.push({ at: state.course.start + 9 * 7 * 86400000 - 86400000, text: `Команда ${team.name} утверждена преподавателем`, pts: '—' })
    if (user.profileFilledAt) res.push({ at: user.profileFilledAt, text: 'Профиль заполнен', pts: user.profileFilledAt < state.course.start + 7 * 86400000 ? '+5' : '—' })
    return res.sort((a, b) => b.at - a.at)
  }, [state, user])
  const [all, setAll] = useState(false)
  return (
    <div className="card">
      <div className="card-title">Активность</div>
      {(all ? feed : feed.slice(0, 6)).map((f, i) => (
        <div key={i} className="feed-row">
          <span className="mono muted">{fmtDay(f.at)}</span>
          <span>{f.text}</span>
          <span className={`mono bold ${f.pts.startsWith('+') ? 'green' : f.pts.startsWith('-') ? 'orange' : 'muted'}`} style={{ textAlign: 'right' }}>
            {f.pts}
          </span>
        </div>
      ))}
      {feed.length > 6 && (
        <button className="link small" onClick={() => setAll(!all)}>
          {all ? 'Свернуть' : `Показать все (${feed.length})`}
        </button>
      )}
    </div>
  )
}

export function Rating({ highlight, full }: { highlight?: string; full?: boolean }) {
  const { me, state } = useMe()
  const [tab, setTab] = useState<'students' | 'teams'>('students')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [showAll, setShowAll] = useState(!!full)
  const sc = allScores(state)
  const staff = isStaff(me)
  const vis = staff ? 'full' : state.settings.ratingVisibility
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return state.users
      .filter((u) => sc.has(u.id))
      .filter((u) => !s || u.name.toLowerCase().includes(s) || u.skills.some((k) => k.toLowerCase().includes(s)))
      .filter((u) => !role || u.wantedRoles.includes(role as TeamRole) || u.teamRole === role)
      .sort((a, b) => sc.get(a.id)!.place - sc.get(b.id)!.place)
  }, [state.users, sc, q, role])
  const myPlace = sc.get(highlight ?? me.id)?.place ?? 0
  const filtered = !!(q || role)
  let display: (User | 'gap')[] = rows
  if (vis === 'top10' && !staff) display = rows.filter((u) => sc.get(u.id)!.place <= 10 || u.id === me.id)
  else if (!showAll && !filtered && rows.length > 9) {
    const top = rows.slice(0, 5)
    const near = rows.filter((u) => Math.abs(sc.get(u.id)!.place - myPlace) <= 1 && sc.get(u.id)!.place > 5)
    display = myPlace > 6 ? [...top, 'gap', ...near] : rows.slice(0, 8)
  }
  const teams = teamScores(state)
  const week = courseWeek(state)
  const hide = vis === 'places'
  return (
    <div className="card">
      <div className="row-between wrap" style={{ marginBottom: 14 }}>
        <div>
          <div className="card-title" style={{ margin: 0, fontSize: 18 }}>
            Рейтинг курса
          </div>
          <div className="tiny muted">
            Пересчитывается автоматически · {sc.size} студентов, {state.teams.length} команд
          </div>
        </div>
        {week >= 10 && (
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'students', label: 'Студенты' },
              { value: 'teams', label: 'Команды' },
            ]}
          />
        )}
      </div>
      {tab === 'students' ? (
        <>
          <div className="row wrap" style={{ marginBottom: 8 }}>
            <div className="search grow" style={{ minWidth: 180 }}>
              <Icon name="search" size={15} />
              <input className="input input-sm" style={{ paddingLeft: 32, height: 36 }} placeholder="Имя или навык" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select select-sm" style={{ width: 170, height: 36 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Любая роль</option>
              {state.settings.roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Место</th>
                  <th>Студент</th>
                  <th className="hide-sm">Команда</th>
                  {!hide && <th className="num">Р1</th>}
                  {!hide && <th className="num">Р2</th>}
                  {!hide && <th className="num">РД</th>}
                  <th className="num">За неделю</th>
                </tr>
              </thead>
              <tbody>
                {display.map((u, i) => {
                  if (u === 'gap')
                    return (
                      <tr key={'gap' + i}>
                        <td colSpan={7} className="muted">
                          …
                        </td>
                      </tr>
                    )
                  const v = sc.get(u.id)!
                  const d = v.prevPlace - v.place
                  const t = state.teams.find((x) => x.id === u.teamId)
                  return (
                    <tr key={u.id} className={`clickable ${u.id === (highlight ?? me.id) ? 'me' : ''}`} onClick={() => navigate(`/profile/${u.id}`)}>
                      <td className="mono">{v.place}</td>
                      <td className="bold">
                        {u.name}
                        {u.id === me.id ? ' (вы)' : ''}
                      </td>
                      <td className="muted hide-sm">{t?.name ?? '—'}</td>
                      {!hide && <td className="num">{Math.round(v.R1)}</td>}
                      {!hide && <td className="num">{Math.round(v.R2)}</td>}
                      {!hide && <td className="num bold">{fmtNum(v.RD)}</td>}
                      <td className="num">{d > 0 ? <span className="delta-up">▲ {d}</span> : d < 0 ? <span className="delta-down">▼ {-d}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!filtered && vis !== 'top10' && rows.length > 9 && (
            <button className="link small" style={{ marginTop: 10 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Свернуть' : `Показать всех (${rows.length})`}
            </button>
          )}
        </>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Место</th>
                <th>Команда</th>
                <th className="num">Участников</th>
                {!hide && <th className="num">Ср. Р1</th>}
                {!hide && <th className="num">Ср. Р2</th>}
                {!hide && <th className="num">Ср. РД</th>}
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.team.id} className={t.team.id === me.teamId ? 'me' : ''}>
                  <td className="mono">{i + 1}</td>
                  <td className="bold">{t.team.name}</td>
                  <td className="num">{t.team.memberIds.length}</td>
                  {!hide && <td className="num">{Math.round(t.R1)}</td>}
                  {!hide && <td className="num">{Math.round(t.R2)}</td>}
                  {!hide && <td className="num bold">{fmtNum(t.RD)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tiny muted" style={{ marginTop: 12 }}>
        РД = (Р1 + Р2) / 2. Допуск к экзамену при РД ≥ {state.settings.admissionThreshold}. Р2 растёт до 15 недели.
        {hide && ' Преподаватель скрыл баллы — показаны только места.'}
      </div>
    </div>
  )
}

function Breakdown({ user }: { user: User }) {
  const { state } = useMe()
  const v = scoresOf(state, user.id)
  if (!v) return null
  const th = state.settings.admissionThreshold
  const rows: [string, number, number, string][] = [
    ['Индивидуальные задания (И)', v.I, 60, 'Р1'],
    ['Профиль заполнен на 1 неделе', v.A_parts.profile, 5, 'А'],
    ['Peer-review в срок и принят', v.A_parts.reviews, 20, 'А'],
    ['Работы сданы до дедлайна', v.A_parts.onTime, 8, 'А'],
    ['Активность (вручную)', v.A_parts.manual, 7, 'А'],
    ['Соблюдение сроков карточек', v.K_parts.onTime, 15, 'К'],
    ['Вклад в объём работы', v.K_parts.volume, 10, 'К'],
    ['Оценка коллег на ретро', v.K_parts.peers, 10, 'К'],
    ['Участие в ретроспективах', v.K_parts.retro, 5, 'К'],
    ['Проект команды (П)', v.P, 60, 'Р2'],
  ]
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Из чего складывается рейтинг</div>
        <span className={`pill ${v.RD >= th ? 'pill-done' : 'pill-orange'}`}>
          РД {fmtNum(v.RD)} · {v.RD >= th ? 'допуск есть' : `до допуска ${fmtNum(th - v.RD)}`}
        </span>
      </div>
      <table className="t">
        <tbody>
          {rows.map(([l, val, max, g]) => (
            <tr key={l}>
              <td className="muted mono tiny">{g}</td>
              <td>{l}</td>
              <td className="num">
                {fmtNum(val)} <span className="muted">/ {max}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tiny muted" style={{ marginTop: 10 }}>
        Р1 = И + А = {fmtNum(v.R1)} · Р2 = К + П = {fmtNum(v.K)} + {fmtNum(v.P)} = {fmtNum(v.R2)}. Автоматические баллы за число сообщений не начисляются.
      </div>
      <Link to="/assignments" className="link small">
        Мои задания →
      </Link>
    </div>
  )
}
