import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'

/** Минимальный hash-роутер: #/board/tm2?card=xyz */
function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, qs = ''] = raw.split('?')
  const query = Object.fromEntries(new URLSearchParams(qs))
  return { path: path || '/', query, segments: path.split('/').filter(Boolean) }
}

export function useRoute() {
  const [r, setR] = useState(parse)
  useEffect(() => {
    const on = () => {
      setR(parse())
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

export function navigate(to: string) {
  if (window.location.hash !== '#' + to) window.location.hash = to
}

/** Обновить query без перехода (например, открыть карточку) */
export function setQuery(patch: Record<string, string | null>) {
  const { path, query } = parse()
  const q = { ...query }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete q[k]
    else q[k] = v
  }
  const qs = new URLSearchParams(q).toString()
  navigate(path + (qs ? `?${qs}` : ''))
}

export function Link({ to, children, className, onClick }: { to: string; children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <a
      href={'#' + to}
      className={className}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {children}
    </a>
  )
}
