/** Загрузка .env для локального запуска (в Docker переменные задаёт compose). Уже заданные переменные не перезаписываются */
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const file = resolve(process.cwd(), '.env')
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
