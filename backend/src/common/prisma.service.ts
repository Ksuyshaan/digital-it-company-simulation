import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Prisma')

  async onModuleInit() {
    await this.$connect()
    await this.protectAudit()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }

  /** Журнал действий нельзя изменить или удалить (п. 8 ТЗ) — запрещаем UPDATE/DELETE на уровне БД */
  private async protectAudit() {
    try {
      await this.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION audit_readonly() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'Журнал действий нельзя изменять или удалять'; END;
        $$ LANGUAGE plpgsql;`)
      await this.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_readonly_trg ON "AuditEntry";`)
      await this.$executeRawUnsafe(`CREATE TRIGGER audit_readonly_trg BEFORE UPDATE OR DELETE ON "AuditEntry" FOR EACH ROW EXECUTE FUNCTION audit_readonly();`)
    } catch (e) {
      this.log.warn(`Не удалось установить защиту журнала: ${(e as Error).message}`)
    }
  }
}
