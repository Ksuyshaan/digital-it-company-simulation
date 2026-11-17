import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { State, User } from './types'
import { STATE_VERSION, createSeed } from './data/seed'
import { housekeeping, type Act } from './data/actions'
import { now } from './lib/util'

const KEY = 'dits:state'
const ME_KEY = 'dits:me'

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as State
      if (s.version === STATE_VERSION) return s
    }
  } catch {
    /* повреждённые данные — пересоздаём */
  }
  const s = createSeed()
  save(s)
  return s
}

function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch (e) {
    console.warn('Не удалось сохранить состояние', e)
  }
}

function loadMe(): string | null {
  try {
    return sessionStorage.getItem(ME_KEY) ?? localStorage.getItem(ME_KEY)
  } catch {
    return null
  }
}

export interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error' | 'warn'
}

interface Ctx {
  state: State
  me: User | null
  /** Выполнить действие. Возвращает true при успехе; ошибка показывается тостом. */
  act: (fn: Act, okText?: string) => boolean
  login: (userId: string) => void
  logout: () => void
  /** «Вид студента» / «Кабинет преподавателя»: войти под демо-учёткой, сохранив исходную */
  viewAs: (userId: string | null) => void
  real: User | null
  toast: (text: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  resetDemo: () => void
  tick: number
}

const StoreCtx = createContext<Ctx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load)
  const [meId, setMeId] = useState<string | null>(loadMe)
  const [realId, setRealId] = useState<string | null>(() => sessionStorage.getItem('dits:real'))
  const [toasts, setToasts] = useState<Toast[]>([])
  const [tick, setTick] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Math.random()
    setToasts((t) => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3000)
  }, [])

  const me = useMemo(() => state.users.find((u) => u.id === meId) ?? null, [state.users, meId])
  const meRef = useRef(me)
  meRef.current = me

  const act = useCallback(
    (fn: Act, okText?: string) => {
      const current = meRef.current
      if (!current) return false
      const draft = structuredClone(stateRef.current)
      const meDraft = draft.users.find((u) => u.id === current.id)!
      const err = fn(draft, meDraft)
      if (typeof err === 'string') {
        toast(err, 'error')
        return false
      }
      meDraft.lastActiveAt = now()
      stateRef.current = draft
      setState(draft)
      save(draft)
      if (okText) toast(okText)
      return true
    },
    [toast],
  )

  // синхронизация между вкладками: новые сообщения и изменения появляются без перезагрузки
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) {
        try {
          const s = JSON.parse(e.newValue) as State
          stateRef.current = s
          setState(s)
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // «серверное» расписание: блокировки по времени, назначение рецензентов, таймеры
  useEffect(() => {
    const run = () => {
      const draft = structuredClone(stateRef.current)
      if (housekeeping(draft)) {
        stateRef.current = draft
        setState(draft)
        save(draft)
      }
      setTick((t) => t + 1)
    }
    run()
    const id = setInterval(run, 20_000)
    return () => clearInterval(id)
  }, [])

  const login = useCallback((id: string) => {
    sessionStorage.setItem(ME_KEY, id)
    localStorage.setItem(ME_KEY, id)
    sessionStorage.removeItem('dits:real')
    setRealId(null)
    setMeId(id)
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(ME_KEY)
    localStorage.removeItem(ME_KEY)
    sessionStorage.removeItem('dits:real')
    setRealId(null)
    setMeId(null)
  }, [])

  const viewAs = useCallback(
    (id: string | null) => {
      if (id === null) {
        const back = realId
        if (!back) return
        sessionStorage.removeItem('dits:real')
        sessionStorage.setItem(ME_KEY, back)
        setRealId(null)
        setMeId(back)
        return
      }
      const orig = realId ?? meId
      if (orig && orig !== id) {
        sessionStorage.setItem('dits:real', orig)
        setRealId(orig)
      } else {
        sessionStorage.removeItem('dits:real')
        setRealId(null)
      }
      sessionStorage.setItem(ME_KEY, id)
      setMeId(id)
    },
    [realId, meId],
  )
  const real = useMemo(() => state.users.find((u) => u.id === realId) ?? null, [state.users, realId])

  const resetDemo = useCallback(() => {
    const s = createSeed()
    save(s)
    stateRef.current = s
    setState(s)
    toast('Демо-данные сброшены')
  }, [toast])

  const value = useMemo(
    () => ({ state, me, act, login, logout, viewAs, real, toast, toasts, resetDemo, tick }),
    [state, me, act, login, logout, viewAs, real, toast, toasts, resetDemo, tick],
  )
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const c = useContext(StoreCtx)
  if (!c) throw new Error('StoreProvider missing')
  return c
}

/** Хук для страниц, доступных только после входа */
export function useMe() {
  const c = useStore()
  return { ...c, me: c.me as User }
}
