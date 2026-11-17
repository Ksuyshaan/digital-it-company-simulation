import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMe, useStore } from '../store'
import { Link, navigate, useRoute } from '../router'
import { Avatar, Icon } from './ui'
import { isStaff, courseWeek } from '../lib/rules'
import { fmtAgo } from '../lib/util'
import { canRead, markNotificationsRead, startFormationDemo, endFormationDemo, ROLE_RU } from '../data/actions'

type NavItem = { to: string; icon: string; label: string; match?: string[]; badge?: number }

export function Layout({ children }: { children: ReactNode }) {
  const { me, state, real, viewAs } = useMe()
  const { path } = useRoute()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(false)
  }, [path])

  const pendingTeams = state.formation?.teams.filter((t) => t.status === 'pending').length ?? 0
  const disputes = state.submissions.filter((s) => s.reviews.some((r) => r.disputed && !r.disputed.resolution)).length

  let items: NavItem[] = []
  let sub = 'Лидерство в IT'
  if (me.role === 'student') {
    items = [
      { to: '/dashboard', icon: 'dashboard', label: 'Дашборд' },
      { to: '/board', icon: 'board', label: 'Доска задач' },
      { to: '/chat', icon: 'chat', label: 'Чат команды' },
      { to: '/profile', icon: 'chart', label: 'Профиль и рейтинг' },
      { to: '/teams', icon: 'users', label: 'Команды' },
      { to: '/assignments', icon: 'task', label: 'Задания' },
    ]
  } else if (isStaff(me)) {
    sub = me.role === 'teacher' ? 'Кабинет преподавателя' : 'Кабинет ассистента'
    items = [
      { to: '/analytics', icon: 'trend', label: 'Аналитика' },
      { to: '/teacher/teams', icon: 'users', label: 'Команды', badge: pendingTeams },
      { to: '/assignments', icon: 'list', label: 'Задания и оценки', badge: disputes },
      { to: '/gradebook', icon: 'chart', label: 'Рейтинг и ведомость' },
      { to: '/channels', icon: 'chat', label: 'Все каналы' },
      { to: '/audit', icon: 'clock', label: 'Журнал действий' },
      { to: '/settings', icon: 'gear', label: 'Настройки курса' },
    ]
  } else {
    sub = 'Админ-панель'
    items = [
      { to: '/admin', icon: 'users', label: 'Пользователи и роли' },
      { to: '/admin/courses', icon: 'list', label: 'Курсы' },
      { to: '/admin/login', icon: 'lock', label: 'Вход и интеграции' },
      { to: '/admin/backup', icon: 'db', label: 'Резервные копии' },
      { to: '/admin/audit', icon: 'clock', label: 'Журнал действий' },
      { to: '/admin/system', icon: 'sun', label: 'Настройки системы' },
    ]
  }
  const isActive = (to: string) => (to === '/admin' ? path === '/admin' : path === to || path.startsWith(to + '/'))
  const demoStudent = state.users.find((u) => u.name === 'Айгерим Сапарова')!

  return (
    <div className="app">
      <div className="mobile-top">
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Меню">
          <Icon name="menu" />
        </button>
        <span className="bold grow">Digital IT Company</span>
        <Bell dark />
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">DC</div>
          <div>
            <div className="brand-name">Digital IT Company</div>
            <div className="brand-sub">{sub}</div>
          </div>
        </div>
        <nav className="nav">
          {items.map((it) => (
            <Link key={it.to} to={it.to} className={isActive(it.to) ? 'active' : ''}>
              <Icon name={it.icon} />
              {it.label}
              {!!it.badge && <span className="nav-badge">{it.badge}</span>}
            </Link>
          ))}
          {me.role === 'student' && real && isStaff(real) && (
            <>
              <div className="nav-section">Режим преподавателя</div>
              <a
                href="#/analytics"
                onClick={(e) => {
                  e.preventDefault()
                  viewAs(null)
                  navigate('/analytics')
                }}
              >
                <Icon name="trend" />
                Аналитика
              </a>
            </>
          )}
        </nav>
        {isStaff(me) && (
          <>
            <button
              className="nav-outline"
              onClick={() => {
                viewAs(demoStudent.id)
                navigate('/dashboard')
              }}
            >
              ← Вид студента
            </button>
            {real?.role === 'admin' && (
              <button
                className="nav-outline"
                onClick={() => {
                  viewAs(null)
                  navigate('/admin')
                }}
              >
                Админ-панель →
              </button>
            )}
          </>
        )}
        {me.role === 'admin' && (
          <button
            className="nav-outline"
            onClick={() => {
              viewAs('t1')
              navigate('/analytics')
            }}
          >
            ← Кабинет преподавателя
          </button>
        )}
        <div style={{ height: 16 }} />
        <SideUser />
      </aside>
      <main className="main">{children}</main>
      <DemoPanel />
    </div>
  )
}

function SideUser() {
  const { me, state, logout } = useMe()
  const team = state.teams.find((t) => t.id === me.teamId)
  const sub =
    me.role === 'student'
      ? state.formation?.teams.find((t) => t.initiatorId === me.id)
        ? 'Инициатор команды'
        : `${me.teamRole ?? 'Без роли'}${team ? ` · ${team.name}` : ''}`
      : me.role === 'admin'
        ? 'IT-служба университета'
        : ROLE_RU[me.role]
  return (
    <div className="side-user">
      <Link to={me.role === 'student' ? '/profile' : '#'}>
        <Avatar user={me} size={34} />
      </Link>
      <div className="grow">
        <div className="name">{me.name}</div>
        <div className="sub">{sub}</div>
      </div>
      <button
        className="icon-btn"
        title="Выйти"
        onClick={() => {
          logout()
          navigate('/login')
        }}
      >
        <Icon name="logout" size={16} />
      </button>
    </div>
  )
}

export function Bell({ dark }: { dark?: boolean }) {
  const { me, state, act } = useMe()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const list = state.notifications.filter((n) => n.userId === me.id).slice(0, 30)
  const unread = list.filter((n) => !n.read).length
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className={dark ? 'icon-btn' : 'bell'} onClick={() => setOpen(!open)} aria-label="Уведомления" style={dark ? { position: 'relative' } : undefined}>
        <Icon name="bell" />
        {unread > 0 && <span className="bell-dot" style={dark ? { top: 4, right: 4, borderColor: 'var(--side)' } : undefined} />}
      </button>
      {open && (
        <div className="pop" style={{ color: 'var(--ink)' }}>
          <div className="row-between pop-head">
            <span>Уведомления</span>
            {unread > 0 && (
              <button className="link small" onClick={() => act(markNotificationsRead)}>
                Прочитать все
              </button>
            )}
          </div>
          {list.length === 0 && <div className="empty">Уведомлений нет</div>}
          {list.map((n) => (
            <button
              key={n.id}
              className={`pop-item ${n.read ? '' : 'unread'}`}
              onClick={() => {
                setOpen(false)
                navigate(n.link)
              }}
            >
              <span className="dot" style={{ background: n.kind === 'mention' ? 'var(--blue)' : n.kind === 'review' || n.kind === 'deadline' ? 'var(--orange)' : 'var(--muted-2)' }} />
              <span className="grow">
                {n.text}
                <div className="tiny muted">{fmtAgo(n.at)}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Поиск задач, людей, файлов */
export function GlobalSearch() {
  const { me, state } = useMe()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const res = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return null
    const cards = state.cards
      .filter((c) => !c.archived && (isStaff(me) || c.teamId === me.teamId) && (c.title.toLowerCase().includes(s) || c.key.toLowerCase().includes(s)))
      .slice(0, 6)
    const people = state.users.filter((u) => u.courseIds.includes(state.course.id) && (u.name.toLowerCase().includes(s) || u.skills.some((k) => k.toLowerCase().includes(s)))).slice(0, 6)
    const files = [
      ...state.cards.filter((c) => isStaff(me) || c.teamId === me.teamId).flatMap((c) => c.files.map((f) => ({ name: f.name, to: `${isStaff(me) ? `/board/${c.teamId}` : '/board'}?card=${c.id}`, where: c.key }))),
      ...state.messages
        .filter((m) => !m.deletedAt && canRead(state, me, m.channelId))
        .flatMap((m) => (m.files ?? []).map((f) => ({ name: f.name, to: isStaff(me) ? `/channels/${m.channelId}` : m.channelId === state.teams.find((t) => t.id === me.teamId)?.channelId ? '/chat' : `/chat/${m.channelId}`, where: '#' + (state.channels.find((c) => c.id === m.channelId)?.name ?? '') }))),
    ]
      .filter((f) => f.name.toLowerCase().includes(s))
      .slice(0, 5)
    return { cards, people, files }
  }, [q, state, me])
  const go = (to: string) => {
    setOpen(false)
    setQ('')
    navigate(to)
  }
  return (
    <div className="search" ref={ref} style={{ position: 'relative' }}>
      <Icon name="search" size={16} />
      <input className="input" placeholder="Поиск задач, людей, файлов" value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} />
      {open && res && (
        <div className="pop">
          {!res.cards.length && !res.people.length && !res.files.length && <div className="empty">Ничего не найдено</div>}
          {res.cards.length > 0 && <div className="pop-head">Задачи</div>}
          {res.cards.map((c) => (
            <button key={c.id} className="pop-item" onClick={() => go(`${isStaff(me) ? `/board/${c.teamId}` : '/board'}?card=${c.id}`)}>
              <span className="task-key">{c.key}</span>
              <span className="grow">{c.title}</span>
            </button>
          ))}
          {res.people.length > 0 && <div className="pop-head">Люди</div>}
          {res.people.map((u) => (
            <button key={u.id} className="pop-item" onClick={() => go(`/profile/${u.id}`)}>
              <Avatar user={u} size={24} />
              <span className="grow">
                {u.name}
                <div className="tiny muted">{u.skills.slice(0, 3).join(' · ')}</div>
              </span>
            </button>
          ))}
          {res.files.length > 0 && <div className="pop-head">Файлы</div>}
          {res.files.map((f, i) => (
            <button key={i} className="pop-item" onClick={() => go(f.to)}>
              <Icon name="file" size={16} />
              <span className="grow">
                {f.name}
                <div className="tiny muted">{f.where}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TopBar() {
  return (
    <div className="topbar">
      <GlobalSearch />
      <Bell />
    </div>
  )
}

/** Демо-панель: быстрый вход под разными ролями и сценарии ТЗ (в продакшене не нужна) */
function DemoPanel() {
  const { state, me, login, act, resetDemo } = useStore()
  const [open, setOpen] = useState(false)
  if (!me) return null
  const accounts = [
    { id: state.users.find((u) => u.name === 'Айгерим Сапарова')!.id, label: 'Айгерим — Team Lead' },
    { id: state.users.find((u) => u.name === 'Данияр Ахметов')!.id, label: 'Данияр — Scrum Master' },
    { id: state.users.find((u) => u.name === 'Мадина Ержанова')!.id, label: 'Мадина — Developer' },
    { id: 't1', label: 'Ж. Нурланова — преподаватель' },
    { id: 'as1', label: 'О. Беконов — ассистент' },
    { id: 'adm', label: 'Администратор' },
  ]
  return (
    <>
      <button className="btn btn-sm demo-fab no-print" onClick={() => setOpen(!open)} title="Демо-режим">
        <Icon name="gear" size={14} /> Демо
      </button>
      {open && (
        <div className="demo-panel no-print">
          <div className="bold" style={{ marginBottom: 4 }}>
            Демо-режим
          </div>
          <div className="tiny muted" style={{ marginBottom: 10 }}>
            Неделя {courseWeek(state)} из 15. Данные хранятся в браузере. Откройте вторую вкладку под другой ролью — изменения появятся без перезагрузки.
          </div>
          <div className="label-caps" style={{ marginTop: 0 }}>
            Войти как
          </div>
          <div className="stack-sm">
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`btn btn-sm ${me.id === a.id ? 'on' : ''}`}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => {
                  login(a.id)
                  const u = state.users.find((x) => x.id === a.id)!
                  navigate(u.role === 'student' ? '/dashboard' : u.role === 'admin' ? '/admin' : '/analytics')
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="label-caps">Сценарии</div>
          <div className="stack-sm">
            {!state.formation ? (
              <button className="btn btn-sm" onClick={() => act(startFormationDemo, 'Открыто окно формирования команд') && navigate(isStaff(me) ? '/teacher/teams' : '/teams')}>
                Окно формирования команд (нед. 8–9)
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => act(endFormationDemo, 'Сценарий завершён')}>
                Завершить сценарий формирования
              </button>
            )}
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (confirm('Сбросить все демо-данные к исходным?')) resetDemo()
              }}
            >
              Сбросить демо-данные
            </button>
          </div>
        </div>
      )}
    </>
  )
}
