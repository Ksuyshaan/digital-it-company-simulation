import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createConnection } from 'net'
import { randomUUID } from 'crypto'
import type { Readable } from 'stream'
import { PrismaService } from '../common/prisma.service'
import { config } from '../common/config'
import { fail, forbid, must } from '../common/errors'
import { isStaffRole, type Actor } from '../common/actor'
import type { Attachment } from '../domain/types'
import { checkFile } from '../domain/util'

export type FileContext = 'channel' | 'card' | 'submission' | 'assignment' | 'photo' | 'other'

/** Файлы: S3-совместимое хранилище (MinIO), до 25 МБ на файл, до 2 ГБ на команду, проверка антивирусом (п. 8 ТЗ) */
@Injectable()
export class FilesService implements OnModuleInit {
  private readonly log = new Logger('Files')
  readonly s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
  })

  constructor(private readonly db: PrismaService) {}

  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }))
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }))
        this.log.log(`Создан бакет ${config.s3.bucket}`)
      } catch (e) {
        this.log.warn(`Хранилище файлов недоступно (${config.s3.endpoint}): ${(e as Error).message}`)
      }
    }
  }

  async upload(
    actor: Actor,
    file: { originalname: string; size: number; mimetype: string; buffer: Buffer },
    opts: { context: FileContext; teamId?: string | null },
  ): Promise<Attachment> {
    if (!file) fail('Файл не передан')
    // multer отдаёт имя в latin1 — восстанавливаем UTF-8 (кириллица в именах файлов)
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/]/g, '_').slice(0, 200)
    const err = checkFile({ name, size: file.size })
    if (err) fail(err)
    if (opts.context === 'photo') {
      if (!/^image\/(jpeg|png)$/.test(file.mimetype)) fail('Фото — только JPG или PNG')
      if (file.size > 5 * 1024 * 1024) fail('Фото — до 5 МБ')
    }
    if (opts.teamId) {
      const used = await this.db.fileObject.aggregate({ where: { teamId: opts.teamId }, _sum: { size: true } })
      if ((used._sum.size ?? 0) + file.size > config.teamQuotaBytes) fail('Превышен лимит хранилища команды — 2 ГБ')
    }
    const scan = await this.scan(file.buffer)
    if (scan === 'infected') fail(`Файл «${name}» не прошёл проверку антивирусом`)

    const key = `${actor.courseId ?? 'system'}/${randomUUID()}`
    await this.s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype || 'application/octet-stream' }))
    const row = await this.db.fileObject.create({
      data: {
        name,
        size: file.size,
        mime: file.mimetype || 'application/octet-stream',
        storageKey: key,
        uploaderId: actor.user.id,
        courseId: actor.courseId,
        teamId: opts.teamId ?? null,
        context: opts.context,
        scanStatus: scan,
      },
    })
    return { id: row.id, name: row.name, size: row.size }
  }

  /** Вложения по id: только свои загруженные файлы (защита от подстановки чужих id) */
  async attachments(actor: Actor, ids: string[] | undefined): Promise<Attachment[]> {
    if (!ids?.length) return []
    if (ids.length > 10) fail('Не больше 10 файлов за раз')
    const rows = await this.db.fileObject.findMany({ where: { id: { in: ids } } })
    if (rows.length !== new Set(ids).size) fail('Файл не найден — загрузите его заново')
    for (const r of rows) if (r.uploaderId !== actor.user.id) forbid('Можно прикрепить только свои файлы')
    return rows.map((r) => ({ id: r.id, name: r.name, size: r.size }))
  }

  /** Скачать файл с проверкой прав: команда — участники и преподаватели; курс — участники курса */
  async open(actor: Actor, id: string): Promise<{ name: string; mime: string; size: number; body: Readable }> {
    const f = must(await this.db.fileObject.findUnique({ where: { id } }), 'Файл не найден')
    const u = actor.user
    let ok = u.role === 'admin' || f.uploaderId === u.id || f.context === 'photo'
    if (!ok && f.courseId) {
      const en = await this.db.enrollment.findUnique({ where: { userId_courseId: { userId: u.id, courseId: f.courseId } } })
      if (en) ok = isStaffRole(u.role) || !f.teamId || en.teamId === f.teamId || f.context === 'assignment'
      // работа на peer-review: файл доступен назначенному рецензенту
      if (!ok && f.context === 'submission') {
        const rv = await this.db.review.findFirst({ where: { reviewerId: u.id, submission: { versions: { some: { content: { contains: f.id } } } } } })
        ok = !!rv
      }
    }
    if (!ok) forbid('Нет доступа к файлу')
    const obj = await this.s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: f.storageKey }))
    return { name: f.name, mime: f.mime, size: f.size, body: obj.Body as Readable }
  }

  /** Проверка ClamAV по протоколу clamd INSTREAM. Без настроенного CLAMAV_HOST — пропуск */
  private scan(buf: Buffer): Promise<'clean' | 'infected' | 'skipped'> {
    if (!config.clamav.host) return Promise.resolve('skipped')
    return new Promise((resolve) => {
      const sock = createConnection({ host: config.clamav.host, port: config.clamav.port })
      let out = ''
      sock.setTimeout(30_000)
      sock.on('connect', () => {
        sock.write('zINSTREAM\0')
        const CH = 64 * 1024
        for (let i = 0; i < buf.length; i += CH) {
          const part = buf.subarray(i, i + CH)
          const len = Buffer.alloc(4)
          len.writeUInt32BE(part.length)
          sock.write(len)
          sock.write(part)
        }
        sock.write(Buffer.alloc(4))
      })
      sock.on('data', (d) => (out += d.toString()))
      sock.on('end', () => resolve(/FOUND/.test(out) ? 'infected' : 'clean'))
      sock.on('timeout', () => {
        this.log.warn('ClamAV: таймаут проверки')
        sock.destroy()
        resolve('skipped')
      })
      sock.on('error', (e) => {
        this.log.warn(`ClamAV недоступен: ${e.message}`)
        resolve('skipped')
      })
    })
  }
}
