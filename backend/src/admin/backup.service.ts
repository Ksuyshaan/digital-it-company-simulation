import { Injectable, Logger } from '@nestjs/common'
import { spawn } from 'child_process'
import { promises as fs, createWriteStream } from 'fs'
import { join, resolve } from 'path'
import { PrismaService } from '../common/prisma.service'
import { config } from '../common/config'
import { fail } from '../common/errors'

/**
 * Резервное копирование БД: pg_dump в сжатом формате, ежедневно, хранение 30 дней (п. 8 ТЗ).
 * Восстановление: pg_restore --clean -d $DATABASE_URL <файл>. Файлы MinIO копируются
 * снапшотом тома (см. README).
 */
@Injectable()
export class BackupService {
  private readonly log = new Logger('Backup')
  private running = false

  constructor(private readonly db: PrismaService) {}

  async run(by: 'system' | 'manual') {
    if (this.running) fail('Резервное копирование уже выполняется')
    if (!config.databaseUrl) fail('DATABASE_URL не задан')
    this.running = true
    const dir = resolve(config.backup.dir)
    await fs.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
    const file = join(dir, `dits-${stamp}.dump`)
    try {
      // строка подключения без параметров Prisma (?schema=…)
      const url = config.databaseUrl.replace(/\?.*$/, '')
      await new Promise<void>((ok, bad) => {
        const p = spawn('pg_dump', ['--format=custom', '--no-owner', `--dbname=${url}`], { stdio: ['ignore', 'pipe', 'pipe'] })
        const out = createWriteStream(file)
        let err = ''
        let code: number | null = null
        let written = false
        // ждём и завершения процесса, и записи файла — в любом порядке
        const settle = () => {
          if (code === null || !written) return
          if (code === 0) ok()
          else bad(new Error(err || `pg_dump завершился с кодом ${code}`))
        }
        p.stdout.pipe(out)
        p.stderr.on('data', (d) => (err += d.toString()))
        p.on('error', (e) => bad(new Error(`pg_dump не найден: ${e.message}`)))
        out.on('finish', () => ((written = true), settle()))
        out.on('error', bad)
        p.on('close', (c) => ((code = c ?? 1), settle()))
      })
      const { size } = await fs.stat(file)
      await this.retention(dir)
      const row = await this.db.systemSettings.findUnique({ where: { id: 1 } })
      await this.db.systemSettings.upsert({
        where: { id: 1 },
        create: { id: 1, data: { lastBackup: Date.now() } },
        update: { data: { ...((row?.data as object) ?? {}), lastBackup: Date.now() } },
      })
      const mb = (size / 1024 / 1024).toFixed(1).replace('.', ',')
      await this.db.auditEntry.create({ data: { userId: 'system', ip: 'system', text: `Резервная копия создана${by === 'manual' ? ' вручную' : ''} · ${mb} МБ`, objectType: 'backup', newValue: file } })
      this.log.log(`Резервная копия ${file} (${mb} МБ)`)
      return { file, size }
    } catch (e) {
      await fs.rm(file, { force: true })
      this.log.error(`Резервное копирование не удалось: ${(e as Error).message}`)
      throw e
    } finally {
      this.running = false
    }
  }

  async list() {
    const dir = resolve(config.backup.dir)
    try {
      const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.dump'))
      const rows = await Promise.all(names.map(async (n) => ({ name: n, ...(await fs.stat(join(dir, n))) })))
      return rows.map((r) => ({ name: r.name, size: r.size, at: r.mtimeMs })).sort((a, b) => b.at - a.at)
    } catch {
      return []
    }
  }

  private async retention(dir: string) {
    const edge = Date.now() - config.backup.keepDays * 86_400_000
    for (const n of await fs.readdir(dir)) {
      if (!n.endsWith('.dump')) continue
      const st = await fs.stat(join(dir, n))
      if (st.mtimeMs < edge) await fs.rm(join(dir, n), { force: true })
    }
  }
}
