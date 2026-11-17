import { useEffect, type ReactNode } from 'react'
import { StoreProvider, useStore } from './store'
import { navigate, useRoute } from './router'
import { Layout } from './components/Layout'
import { Toasts } from './components/ui'
import { isStaff } from './lib/rules'
import type { User } from './types'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Board from './pages/Board'
import Chat from './pages/Chat'
import Profile from './pages/Profile'
import Teams, { TeacherTeams } from './pages/Teams'
import Assignments from './pages/Assignments'
import Analytics from './pages/Analytics'
import Admin from './pages/Admin'
import { AuditLog, Gradebook, Settings } from './pages/Teacher'

const home = (u: User) => (u.role === 'student' ? '/dashboard' : u.role === 'admin' ? '/admin' : '/analytics')

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to)
  }, [to])
  return null
}

function Routes() {
  const { me } = useStore()
  const { segments, path } = useRoute()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [path])

  if (!me) return path === '/login' ? <Login /> : <Redirect to="/login" />
  if (path === '/login' || path === '/') return <Redirect to={home(me)} />

  const s0 = segments[0]
  const staff = isStaff(me)
  const student = me.role === 'student'
  let page: ReactNode = null

  if (student) {
    page = { dashboard: <Dashboard />, board: <Board />, chat: <Chat />, profile: <Profile />, teams: <Teams />, assignments: <Assignments /> }[s0] ?? null
  } else if (staff) {
    if (s0 === 'teacher' && segments[1] === 'teams') page = <TeacherTeams />
    else page = { analytics: <Analytics />, assignments: <Assignments />, gradebook: <Gradebook />, channels: <Chat />, audit: <AuditLog />, settings: <Settings />, board: <Board />, profile: <Profile /> }[s0] ?? null
  } else if (me.role === 'admin') {
    if (s0 === 'admin') page = <Admin />
  }
  if (!page) return <Redirect to={home(me)} />
  return <Layout>{page}</Layout>
}

export default function App() {
  return (
    <StoreProvider>
      <Routes />
      <Toasts />
    </StoreProvider>
  )
}
