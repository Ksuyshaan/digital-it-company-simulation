import { useEffect, useMemo, useState } from 'react'
import { useMe } from '../store'
import { Link, useRoute } from '../router'
import { Avatar, Bar, Field, FilePick, Icon, Modal, PageHead, Segmented, Toggle } from '../components/ui'
import type { SystemRole, User } from '../types'
import { fmtDateTime, fmtRelDay, fmtTime, fromInputDT, now, toInputDT } from '../lib/util'
import { ROLE_RU, addUser, backupNow, createCourse, importUsers, setUserRole, toggleBlock, updateAdmin } from '../data/actions'
import { AuditLog } from './Teacher'

export default function Admin() {
  const { segments } = useRoute()
  const section = segments[1]
  useEffect(() => {
    if (section && section !== 'audit') document.getElementById(`sec-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [section])
  if (section === 'audit') return <AuditLog />
  return <AdminHome />
}

function AdminHome() {
  const { me, state, act, toast } = useMe()
  const [tab, setTab] = useState<'all' | SystemRole>('all')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<null | 'user' | 'course' | 'import'>(null)
  const [limit, setLimit] = useState(7)
  const others = state.courses.filter((c) => c.id !== state.course.id).reduce((a, c) => a + (c.status === 'active' ? c.studentsCount ?? 0 : 0), 0)
  const count = (r: SystemRole) => state.users.filter((u) => u.role === r).length
  const users = useMemo(() => {
    const s = q.trim().toLowerCase()
    const order: SystemRole[] = ['teacher', 'assistant', 'student', 'admin']
    return state.users
      .filter((u) => tab === 'all' || u.role === tab)
      .filter((u) => !s || u.name.toLowerCase().includes(s) || u.email.includes(s) || u.group.toLowerCase().includes(s))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || b.lastActiveAt - a.lastActiveAt)
  }, [state.users, tab, q])
  const courseNames = (u: User) =>
    state.courses
      .filter((c) => u.courseIds.includes(c.id) && c.status === 'active')
      .map((c) => `${c.name}, ${c.stream}`)
      .join('; ') || '—'
  const teacherName = (id: string) => {
    const [a, b] = (state.users.find((u) => u.id === id)?.name ?? '—').split(' ')
    return b ? `${a[0]}. ${b}` : a
  }

  return (
    <>
      <PageHead
        crumb="Администрирование системы"
        title="Пользователи и роли"
        actions={
          <>
            <button className="btn" onClick={() => setModal('import')}>
              Импорт из CSV / Excel
            </button>
            <button className="btn" onClick={() => setModal('course')}>
              Новый курс
            </button>
            <button className="btn btn-primary" onClick={() => setModal('user')}>
              + Добавить пользователя
            </button>
          </>
        }
      />
      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Студенты</div>
          <div className="stat-value">{(count('student') + others).toLocaleString('ru-RU')}</div>
          <div className="stat-sub">{count('student')} в текущем потоке</div>
        </div>
        <div className="stat">
          <div className="stat-label">Преподаватели</div>
          <div className="stat-value">{count('teacher')}</div>
          <div className="stat-sub">роль выдаёт администратор</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ассистенты</div>
          <div className="stat-value">{count('assistant')}</div>
          <div className="stat-sub">без доступа к настройкам курса</div>
        </div>
        <div className="stat">
          <div className="stat-label">Активные курсы</div>
          <div className="stat-value">{state.courses.filter((c) => c.status === 'active').length}</div>
          <div className="stat-sub">{state.courses.filter((c) => c.status === 'archive').length} в архиве «только чтение»</div>
        </div>
      </div>

      <div className="admin-grid">
        <div className="stack">
          <div className="card">
            <div className="row-between wrap" style={{ marginBottom: 10 }}>
              <Segmented
                value={tab}
                onChange={(v) => (setTab(v), setLimit(7))}
                options={[
                  { value: 'all', label: 'Все' },
                  { value: 'student', label: 'Студенты' },
                  { value: 'teacher', label: 'Преподаватели' },
                  { value: 'assistant', label: 'Ассистенты' },
                ]}
              />
              <div className="search" style={{ width: 240 }}>
                <Icon name="search" size={15} />
                <input className="input" placeholder="Имя, e-mail или группа" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th className="hide-sm">Курсы</th>
                    <th>Последний вход</th>
                    <th>Доступ</th>
                  </tr>
                </thead>
                <tbody>
                  {users.slice(0, limit).map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="row">
                          <Avatar user={{ ...u, role: 'student' }} size={32} />
                          <span>
                            <div className="bold">{u.name}</div>
                            <div className="tiny muted">{u.email}</div>
                          </span>
                        </span>
                      </td>
                      <td>
                        <select className="select select-sm" style={{ width: 150 }} value={u.role} disabled={u.id === me.id} onChange={(e) => act(setUserRole(u.id, e.target.value as SystemRole), 'Роль изменена и записана в журнал')}>
                          {(['student', 'assistant', 'teacher', 'admin'] as SystemRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_RU[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="small hide-sm">{courseNames(u)}</td>
                      <td className="small mono">{u.lastActiveAt ? fmtRelDay(u.lastActiveAt) : '—'}</td>
                      <td>
                        <button className={`pill ${u.blocked ? 'status-bad' : 'status-ok'}`} style={{ border: 0, cursor: 'pointer', padding: '6px 12px' }} title="Нажмите, чтобы изменить" disabled={u.id === me.id} onClick={() => confirm(`${u.blocked ? 'Разблокировать' : 'Заблокировать'} ${u.name}?`) && act(toggleBlock(u.id))}>
                          {u.blocked ? 'Заблокирован' : 'Активен'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-between tiny muted" style={{ marginTop: 10 }}>
              <span>
                Показано {Math.min(limit, users.length)} из {users.length}{' '}
                {limit < users.length && (
                  <button className="link tiny" onClick={() => setLimit(limit + 25)}>
                    Показать ещё
                  </button>
                )}
              </span>
              <span>Смена роли и блокировка записываются в журнал действий</span>
            </div>
          </div>

          <div className="card" id="sec-courses">
            <div className="card-title" style={{ fontSize: 18 }}>
              Курсы
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Курс</th>
                    <th>Преподаватель</th>
                    <th className="num">Студентов</th>
                    <th>Статус</th>
                    <th>Данные хранятся до</th>
                  </tr>
                </thead>
                <tbody>
                  {state.courses.map((c) => (
                    <tr key={c.id}>
                      <td className="bold">
                        {c.name} · {c.stream}
                      </td>
                      <td>{teacherName(c.teacherId)}</td>
                      <td className="num">{c.id === state.course.id ? count('student') : c.studentsCount}</td>
                      <td>
                        {c.status === 'active' ? (
                          <span className="pill pill-blue">Идёт · неделя {Math.min(15, Math.max(1, Math.floor((now() - c.start) / (7 * 86400000)) + 1))}</span>
                        ) : (
                          <span className="pill pill-todo">Архив · только чтение</span>
                        )}
                      </td>
                      <td className="mono small">{c.keepUntil ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card" id="sec-login">
            <div className="card-title">Вход и доступ</div>
            <div className="kv">
              <span>Провайдер входа</span>
              <select className="select select-sm" style={{ width: 160 }} value={state.admin.provider} onChange={(e) => act(updateAdmin({ provider: e.target.value }), 'Сохранено')}>
                <option>Microsoft 365</option>
                <option>Google Workspace</option>
              </select>
            </div>
            <div className="kv">
              <span>Разрешённый домен</span>
              <input className="input input-sm" style={{ width: 160 }} defaultValue={state.admin.domain} onBlur={(e) => e.target.value !== state.admin.domain && act(updateAdmin({ domain: e.target.value.replace(/^@/, '') }), 'Домен сохранён')} />
            </div>
            <div className="kv">
              <span>Сессия без действий</span>
              <b>{state.admin.sessionHours} ч</b>
            </div>
            <div style={{ marginTop: 10 }} className="stack-sm">
              <Toggle on={state.admin.blockOtherDomains} onChange={(v) => act(updateAdmin({ blockOtherDomains: v }))} label="Запретить вход с других доменов" />
              <Toggle on={state.admin.inviteCodes} onChange={(v) => act(updateAdmin({ inviteCodes: v }))} label="Код приглашения на курс" />
            </div>
          </div>

          <div className="card" id="sec-backup">
            <div className="card-title">Состояние системы</div>
            <div className="kv">
              <span>Доступность за 30 дней</span>
              <b className="green">99,7%</b>
            </div>
            <div className="tiny muted">Цель по ТЗ — 99% в учебное время</div>
            <div className="kv" style={{ marginTop: 8 }}>
              <span>Хранилище файлов</span>
              <b>118 / 200 ГБ</b>
            </div>
            <Bar value={118} max={200} color="var(--blue)" />
            <div className="kv" style={{ marginTop: 8 }}>
              <span>Последняя резервная копия</span>
              <b>{fmtRelDay(state.admin.lastBackup)}</b>
            </div>
            <div className="tiny muted">Ежедневно · хранится 30 копий · восстановление до 4 ч</div>
            <div className="kv" style={{ marginTop: 8 }}>
              <span>Заблокировано антивирусом</span>
              <b className="orange">3 файла за неделю</b>
            </div>
            <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => act(backupNow, 'Резервная копия создана')}>
              Создать копию сейчас
            </button>
          </div>

          <div className="card" id="sec-system">
            <div className="row-between">
              <div className="card-title" style={{ margin: 0 }}>
                Журнал действий
              </div>
              <Link to="/admin/audit" className="link small">
                Весь журнал
              </Link>
            </div>
            {state.audit.slice(0, 6).map((a) => (
              <div key={a.id} className="log-row">
                <div className="row-between mono tiny muted">
                  <span>{fmtTime(a.at)}</span>
                  <span>{a.ip}</span>
                </div>
                <div>
                  <b>{state.users.find((u) => u.id === a.userId)?.name ?? 'Система'}</b> · {a.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {modal === 'user' && <AddUserModal onClose={() => setModal(null)} />}
      {modal === 'course' && <NewCourseModal onClose={() => setModal(null)} />}
      {modal === 'import' && (
        <Modal title="Импорт студентов" onClose={() => setModal(null)}>
          <p className="small">
            CSV (UTF-8) с колонками <b>ФИО; e-mail; группа</b>. Файл Excel сохраните как «CSV UTF-8». Студенты с почтой не из домена @{state.admin.domain} пропускаются.
          </p>
          <FilePick
            multiple={false}
            accept=".csv,.txt,.xlsx"
            onFiles={async ([f]) => {
              if (/\.xlsx?$/i.test(f.name)) return toast('Сохраните таблицу Excel как «CSV UTF-8» и загрузите её', 'warn')
              const text = await f.text()
              const rows = text
                .split(/\r?\n/)
                .map((l) => l.split(/[;,\t]/).map((x) => x.trim().replace(/^"|"$/g, '')))
                .filter((r) => r.length >= 2 && r[1].includes('@'))
                .map((r) => ({ name: r[0], email: r[1], group: r[2] ?? '' }))
              if (act(importUsers(rows, state.course.id, f.name), `Импорт из ${f.name} выполнен`)) setModal(null)
            }}
          >
            <span className="btn btn-primary">Выбрать файл</span>
          </FilePick>
        </Modal>
      )}
    </>
  )
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const { state, act } = useMe()
  const [f, setF] = useState({ name: '', email: '', group: '', role: 'student' as SystemRole, courseId: state.course.id })
  return (
    <Modal title="Новый пользователь" onClose={onClose} footer={<button className="btn btn-primary" onClick={() => act(addUser(f), 'Пользователь добавлен') && onClose()}>Добавить</button>}>
      <div className="stack">
        <Field label="ФИО">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Корпоративная почта" hint={`Только домен @${state.admin.domain}. Пусто — сгенерируется из ФИО`}>
          <input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={`name@${state.admin.domain}`} />
        </Field>
        <div className="grid-2">
          <Field label="Группа / подразделение">
            <input className="input" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} />
          </Field>
          <Field label="Роль">
            <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as SystemRole })}>
              {(['student', 'assistant', 'teacher', 'admin'] as SystemRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_RU[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Курс">
          <select className="select" value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })}>
            {state.courses
              .filter((c) => c.status === 'active')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.stream}
                </option>
              ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}

function NewCourseModal({ onClose }: { onClose: () => void }) {
  const { state, act } = useMe()
  const teachers = state.users.filter((u) => u.role === 'teacher')
  const [f, setF] = useState({ name: 'Лидерство в IT', stream: '2027-1', start: toInputDT(now() + 60 * 86400000), teacherId: teachers[0]?.id ?? '' })
  return (
    <Modal title="Новый курс" onClose={onClose} footer={<button className="btn btn-primary" onClick={() => act(createCourse({ ...f, start: fromInputDT(f.start)! }), 'Курс создан') && onClose()}>Создать</button>}>
      <div className="stack">
        <Field label="Дисциплина">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Поток">
            <input className="input" value={f.stream} onChange={(e) => setF({ ...f, stream: e.target.value })} />
          </Field>
          <Field label="Начало (15 недель)">
            <input className="input" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </Field>
        </div>
        <Field label="Преподаватель">
          <select className="select" value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="tiny muted">Даты этапов и настройки оценивания преподаватель задаёт сам. Создан: {fmtDateTime(now())}</div>
      </div>
    </Modal>
  )
}
