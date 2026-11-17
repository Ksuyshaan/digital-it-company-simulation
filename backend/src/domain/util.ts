/** Общие утилиты домена (из frontend/src/lib/util.ts, без браузерных функций) */
export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY

export const now = () => Date.now()

export function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const pad = (n: number) => String(n).padStart(2, '0')

/** Часовой пояс отображения дат в текстах уведомлений и журнала */
const TZ_OFFSET_MIN = Number(process.env.APP_TZ_OFFSET_MIN ?? 300) // Алматы, UTC+5
const local = (t: number) => new Date(t + TZ_OFFSET_MIN * MIN)

export const fmtTime = (t: number) => {
  const d = local(t)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export const fmtDay = (t: number) => {
  const d = local(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
export const fmtDateTime = (t: number) => `${fmtDay(t)}, ${fmtTime(t)}`
export const fmtDate = (t: number) => {
  const d = local(t)
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}

export const shortName = (name: string) => {
  const [a, b] = name.split(' ')
  return b ? `${a} ${b[0]}.` : a
}

export const round1 = (n: number) => Math.round(n * 10) / 10
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
export const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
export const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0)

export const FORBIDDEN_EXT = ['exe', 'bat', 'sh', 'cmd', 'msi', 'com', 'scr', 'ps1', 'vbs', 'jar', 'apk', 'dll', 'bin', 'run', 'app', 'deb', 'rpm', 'vbe', 'wsf', 'hta', 'cpl', 'pif', 'reg']
export const MAX_FILE = 25 * 1024 * 1024

export function checkFile(f: { name: string; size: number }): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  if (FORBIDDEN_EXT.includes(ext)) return `Файл «${f.name}» запрещён: исполняемые файлы (.${ext}) загружать нельзя`
  if (f.size > MAX_FILE) return `Файл «${f.name}» больше 25 МБ`
  return null
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`
