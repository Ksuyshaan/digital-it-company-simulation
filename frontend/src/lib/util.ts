export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY

export const now = () => Date.now()

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`

export function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const pad = (n: number) => String(n).padStart(2, '0')

export const fmtTime = (t: number) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fmtDay = (t: number) => {
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export const fmtDayLong = (t: number) => {
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`
}

export const fmtWeekdayTime = (t: number) => `${WD[new Date(t).getDay()]}, ${fmtTime(t)}`

export const fmtWeekday = (t: number) => WD[new Date(t).getDay()]

export const fmtDateTime = (t: number) => `${fmtDay(t)}, ${fmtTime(t)}`

export function fmtRelDay(t: number) {
  const d0 = startOfDay(now())
  const d = startOfDay(t)
  if (d === d0) return `сегодня ${fmtTime(t)}`
  if (d === d0 - DAY) return `вчера ${fmtTime(t)}`
  const days = Math.round((d0 - d) / DAY)
  if (days > 0 && days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  return fmtDateTime(t)
}

export function fmtAgo(t: number) {
  const diff = now() - t
  if (diff < MIN) return 'только что'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} мин назад`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ч назад`
  const d = Math.floor(diff / DAY)
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`
}

export function fmtLeft(ms: number) {
  if (ms <= 0) return 'время вышло'
  const d = Math.floor(ms / DAY)
  const h = Math.floor((ms % DAY) / HOUR)
  const m = Math.floor((ms % HOUR) / MIN)
  if (d > 0) return `${d} д ${pad(h)} ч`
  return `${h} ч ${pad(m)} мин`
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

export const toInputDT = (t: number | null | undefined) => {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromInputDT = (s: string) => (s ? new Date(s).getTime() : null)

export const initials = (name: string) =>
  name
    .replace(/[.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export const shortName = (name: string) => {
  const [a, b] = name.split(' ')
  return b ? `${a} ${b[0]}.` : a
}

export const firstName = (name: string) => name.split(' ')[0]

export const round1 = (n: number) => Math.round(n * 10) / 10

export const fmtNum = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')

export const fmtSize = (b: number) => (b > 1024 * 1024 ? `${fmtNum(b / 1024 / 1024)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`)

export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

export const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

export const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0)

export function download(name: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** CSV для Excel: UTF-8 с BOM, разделитель «;» */
export function toCsv(rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
}

export const FORBIDDEN_EXT = ['exe', 'bat', 'sh', 'cmd', 'msi', 'com', 'scr', 'ps1', 'vbs', 'jar', 'apk', 'dll']
export const MAX_FILE = 25 * 1024 * 1024

export function checkFile(f: { name: string; size: number }): string | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  if (FORBIDDEN_EXT.includes(ext)) return `Файл «${f.name}» запрещён: исполняемые файлы (.${ext}) загружать нельзя`
  if (f.size > MAX_FILE) return `Файл «${f.name}» больше 25 МБ`
  return null
}
