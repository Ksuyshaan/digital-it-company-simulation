import { useMemo, useState } from 'react'
import { useMe } from '../store'
import { navigate } from '../router'
import { Field, Icon, PageHead, Segmented, Toggle } from '../components/ui'
import type { CourseSettings, TeamRole } from '../types'
import { allScores } from '../lib/rules'
import { download, fmtDateTime, fmtNum, fromInputDT, toCsv, toInputDT } from '../lib/util'
import { updateSettings } from '../data/actions'

/* ─────────── Рейтинг и ведомость ─────────── */

export function Gradebook() {
  const { state } = useMe()
  const sc = allScores(state)
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('')
  const [only, setOnly] = useState<'all' | 'below' | 'ok'>('all')
  const th = state.settings.admissionThreshold
  const rows = useMemo(
    () =>
      state.users
        .filter((u) => sc.has(u.id))
        .filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.group.toLowerCase().includes(q.toLowerCase()))
        .filter((u) => !team || u.teamId === team)
        .filter((u) => only === 'all' || (only === 'below' ? sc.get(u.id)!.RD < th : sc.get(u.id)!.RD >= th))
        .sort((a, b) => sc.get(a.id)!.place - sc.get(b.id)!.place),
    [state.users, sc, q, team, only, th],
  )
  const header = ['Место', 'ФИО', 'Группа', 'Команда', 'И (60)', 'А (40)', 'Р1', 'К (40)', 'П (60)', 'Р2', 'РД', 'Допуск']
  const exportCsv = () =>
    download(
      `vedomost_${state.course.stream}.csv`,
      toCsv([
        header,
        ...rows.map((u) => {
          const v = sc.get(u.id)!
          return [v.place, u.name, u.group, state.teams.find((t) => t.id === u.teamId)?.name ?? '', fmtNum(v.I), fmtNum(v.A), fmtNum(v.R1), fmtNum(v.K), fmtNum(v.P), fmtNum(v.R2), fmtNum(v.RD), v.RD >= th ? 'да' : 'нет']
        }),
      ]),
    )
  return (
    <>
      <PageHead
        crumb={`${state.course.name} · ${state.course.stream}`}
        title="Рейтинг и ведомость"
        actions={
          <>
            <button className="btn" onClick={() => window.print()}>
              Экспорт PDF
            </button>
            <button className="btn" onClick={exportCsv}>
              Экспорт Excel
            </button>
          </>
        }
      />
      <div className="card">
        <div className="row wrap no-print" style={{ marginBottom: 12 }}>
          <input className="input" style={{ width: 240 }} placeholder="ФИО или группа" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ width: 200 }} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Все команды</option>
            {state.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Segmented
            value={only}
            onChange={setOnly}
            options={[
              { value: 'all', label: 'Все' },
              { value: 'ok', label: `Допуск` },
              { value: 'below', label: `Ниже ${th}` },
            ]}
          />
          <span className="small muted">Показано {rows.length}</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                {header.map((h, i) => (
                  <th key={h} className={i >= 4 ? 'num' : ''}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const v = sc.get(u.id)!
                return (
                  <tr key={u.id} className="clickable" onClick={() => navigate(`/profile/${u.id}`)}>
                    <td className="mono">{v.place}</td>
                    <td className="bold">{u.name}</td>
                    <td className="muted">{u.group}</td>
                    <td className="muted">{state.teams.find((t) => t.id === u.teamId)?.name ?? '—'}</td>
                    <td className="num">{fmtNum(v.I)}</td>
                    <td className="num">{fmtNum(v.A)}</td>
                    <td className="num bold">{fmtNum(v.R1)}</td>
                    <td className="num">{fmtNum(v.K)}</td>
                    <td className="num">{fmtNum(v.P)}</td>
                    <td className="num bold">{fmtNum(v.R2)}</td>
                    <td className="num bold">{fmtNum(v.RD)}</td>
                    <td className="num">{v.RD >= th ? <span className="pill pill-done">да</span> : <span className="pill pill-orange">−{fmtNum(th - v.RD)}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="tiny muted" style={{ marginTop: 12 }}>
          Р1 = И + А (недели 1–8) · Р2 = К + П (недели 9–15) · РД = (Р1 + Р2) / 2. Пересчёт — сразу после начисления баллов.
        </div>
      </div>
    </>
  )
}

/* ─────────── Журнал действий ─────────── */

export function AuditLog() {
  const { state } = useMe()
  const [q, setQ] = useState('')
  const list = state.audit.filter((a) => !q || a.text.toLowerCase().includes(q.toLowerCase()) || (state.users.find((u) => u.id === a.userId)?.name ?? '').toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHead
        crumb="Все действия с баллами, ролями, блокировками и составами"
        title="Журнал действий"
        actions={
          <button className="btn" onClick={() => download('audit.csv', toCsv([['Время', 'Кто', 'Действие', 'IP'], ...list.map((a) => [fmtDateTime(a.at), state.users.find((u) => u.id === a.userId)?.name ?? 'Система', a.text, a.ip ?? ''])]))}>
            Экспорт
          </button>
        }
      />
      <div className="card">
        <div className="search" style={{ maxWidth: 360, marginBottom: 10 }}>
          <Icon name="search" size={15} />
          <input className="input" placeholder="Поиск по журналу" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>Время</th>
              <th>Кто</th>
              <th>Действие</th>
              <th className="num hide-sm">IP</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td className="mono small nowrap">{fmtDateTime(a.at)}</td>
                <td className="bold nowrap">{state.users.find((u) => u.id === a.userId)?.name ?? 'Система'}</td>
                <td>{a.text}</td>
                <td className="num tiny muted hide-sm">{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tiny muted" style={{ marginTop: 10 }}>
          Записи журнала не редактируются и не удаляются.
        </div>
      </div>
    </>
  )
}

/* ─────────── Настройки курса ─────────── */

export function Settings() {
  const { me, state, act } = useMe()
  const [s, setS] = useState<CourseSettings>(state.settings)
  const [start, setStart] = useState(toInputDT(state.course.start))
  const [newRole, setNewRole] = useState('')
  const ro = me.role !== 'teacher'
  const num = (k: keyof CourseSettings) => ({
    className: 'input',
    type: 'number',
    disabled: ro,
    value: s[k] as number,
    onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: Number(e.target.value) }),
  })
  return (
    <>
      <PageHead
        crumb={`${state.course.name} · ${state.course.stream}`}
        title="Настройки курса"
        actions={
          !ro && (
            <button className="btn btn-primary" onClick={() => act(updateSettings(s, { start: fromInputDT(start)! }), 'Настройки сохранены — рейтинг пересчитан')}>
              Сохранить
            </button>
          )
        }
      />
      {ro && (
        <div className="banner">
          <Icon name="lock" size={16} /> Ассистент видит настройки, но менять их может только преподаватель.
        </div>
      )}
      <div className="grid-2" style={{ alignItems: 'start', gap: 16 }}>
        <div className="card stack">
          <div className="card-title" style={{ margin: 0 }}>
            Курс и доска
          </div>
          <Field label="Начало курса (неделя 1)">
            <input className="input" type="datetime-local" disabled={ro} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Режим доски">
            <Segmented
              value={s.boardMode}
              onChange={(v) => !ro && setS({ ...s, boardMode: v })}
              options={[
                { value: 'scrum', label: 'Scrum (доска + спринты)' },
                { value: 'kanban', label: 'Kanban' },
              ]}
            />
          </Field>
          <div className="grid-2">
            <Field label="Длительность спринта">
              <select className="select" disabled={ro} value={s.sprintWeeks} onChange={(e) => setS({ ...s, sprintWeeks: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>1 неделя</option>
                <option value={2}>2 недели</option>
              </select>
            </Field>
            <Field label="Лимит In Progress на человека">
              <input {...num('wipLimit')} />
            </Field>
          </div>
          <Toggle on={s.smRotation} onChange={(v) => !ro && setS({ ...s, smRotation: v })} label="Ротация Scrum Master каждый спринт" />
        </div>

        <div className="card stack">
          <div className="card-title" style={{ margin: 0 }}>
            Команды
          </div>
          <div className="grid-3">
            <Field label="Мин. размер">
              <input {...num('teamMin')} />
            </Field>
            <Field label="Макс. размер">
              <input {...num('teamMax')} />
            </Field>
            <Field label="Средний Р1 ≥">
              <input {...num('minAvgR1')} />
            </Field>
          </div>
          <Field label="Роли в команде">
            <div className="row wrap">
              {s.roles.map((r) => (
                <span key={r} className="chip">
                  {r}
                  {!ro && r !== 'Team Lead' && r !== 'Scrum Master' && (
                    <button onClick={() => setS({ ...s, roles: s.roles.filter((x) => x !== r) })}>
                      <Icon name="x" size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!ro && (
              <div className="row" style={{ marginTop: 6 }}>
                <input className="input input-sm" placeholder="Новая роль" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
                <button className="btn btn-sm" onClick={() => newRole.trim() && (setS({ ...s, roles: [...s.roles, newRole.trim() as TeamRole] }), setNewRole(''))}>
                  Добавить
                </button>
              </div>
            )}
          </Field>
        </div>

        <div className="card stack">
          <div className="card-title" style={{ margin: 0 }}>
            Задания и peer-review
          </div>
          <div className="grid-2">
            <Field label="Штраф за сутки опоздания, %">
              <input {...num('latePenaltyPct')} />
            </Field>
            <Field label="Сдача закрывается через, ч">
              <input {...num('lateCloseHours')} />
            </Field>
            <Field label="Вес оценки преподавателя">
              <input className="input" type="number" step={0.05} disabled={ro} value={s.teacherWeight} onChange={(e) => setS({ ...s, teacherWeight: Number(e.target.value), peerWeight: Math.round((1 - Number(e.target.value)) * 100) / 100 })} />
            </Field>
            <Field label="Вес рецензентов">
              <input className="input" type="number" step={0.05} disabled={ro} value={s.peerWeight} onChange={(e) => setS({ ...s, peerWeight: Number(e.target.value), teacherWeight: Math.round((1 - Number(e.target.value)) * 100) / 100 })} />
            </Field>
            <Field label="Допустимое отклонение рецензента, %">
              <input {...num('peerDeviationPct')} />
            </Field>
            <Field label="Порог допуска (РД ≥)">
              <input {...num('admissionThreshold')} />
            </Field>
          </div>
        </div>

        <div className="card stack">
          <div className="card-title" style={{ margin: 0 }}>
            Рейтинг и сигналы
          </div>
          <Field label="Видимость рейтинга для студентов">
            <Segmented
              value={s.ratingVisibility}
              onChange={(v) => !ro && setS({ ...s, ratingVisibility: v })}
              options={[
                { value: 'full', label: 'Баллы и места' },
                { value: 'places', label: 'Только места' },
                { value: 'top10', label: 'Только топ-10' },
              ]}
            />
          </Field>
          <div className="grid-2">
            <Field label="Нет действий, дней">
              <input {...num('signalInactiveDays')} />
            </Field>
            <Field label="Тихий канал, дней">
              <input {...num('signalSilentDays')} />
            </Field>
            <Field label="Доля SP меньше, %">
              <input {...num('signalShareMin')} />
            </Field>
            <Field label="Доля SP больше, %">
              <input {...num('signalShareMax')} />
            </Field>
            <Field label="Просрочено карточек спринта больше, %">
              <input {...num('signalOverduePct')} />
            </Field>
          </div>
        </div>
      </div>
    </>
  )
}
