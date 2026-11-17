import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import type { Actor } from './actor'

export interface AuditExtra {
  objectType?: string
  objectId?: string
  oldValue?: unknown
  newValue?: unknown
}

const str = (v: unknown) => (v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v))

/** Журнал действий: кто, когда, что, объект, старое и новое значение, IP (п. 8 ТЗ) */
@Injectable()
export class AuditService {
  constructor(private readonly db: PrismaService) {}

  async log(actor: Actor | 'system', courseId: string | null | undefined, text: string, extra: AuditExtra = {}) {
    await this.db.auditEntry.create({
      data: {
        userId: actor === 'system' ? 'system' : actor.user.id,
        ip: actor === 'system' ? 'system' : actor.ip,
        courseId: courseId ?? null,
        text,
        objectType: extra.objectType,
        objectId: extra.objectId,
        oldValue: str(extra.oldValue),
        newValue: str(extra.newValue),
      },
    })
  }
}
