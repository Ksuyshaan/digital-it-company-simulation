import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { PrismaService } from './common/prisma.service'
import { AuditService } from './common/audit.service'
import { NotifyService } from './common/notify.service'
import { CourseContext } from './common/course-context.service'
import { StateService } from './state/state.service'
import { StateController } from './state/state.controller'
import { RealtimeGateway } from './realtime/realtime.gateway'
import { SessionService } from './auth/session.service'
import { AuthService } from './auth/auth.service'
import { AuthController } from './auth/auth.controller'
import { AuthGuard } from './auth/auth.guard'
import { FilesService } from './files/files.service'
import { FilesController } from './files/files.controller'
import { BoardService } from './board/board.service'
import { BoardController } from './board/board.controller'
import { ChatService } from './chat/chat.service'
import { ChatController } from './chat/chat.controller'
import { AssignmentsService } from './assignments/assignments.service'
import { AssignmentsController } from './assignments/assignments.controller'
import { TeamsService } from './teams/teams.service'
import { TeamsController } from './teams/teams.controller'
import { ProfileService } from './profile/profile.service'
import { ProfileController } from './profile/profile.controller'
import { TeacherService } from './teacher/teacher.service'
import { TeacherController } from './teacher/teacher.controller'
import { AdminService } from './admin/admin.service'
import { AdminController } from './admin/admin.controller'
import { BackupService } from './admin/backup.service'
import { ReportsService } from './reports/reports.service'
import { ReportsController } from './reports/reports.controller'
import { JobsService } from './jobs/jobs.service'

@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    // базовая защита от перебора и флуда: 300 запросов в минуту с одного адреса
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],
  controllers: [
    StateController, AuthController, FilesController, BoardController, ChatController, AssignmentsController,
    TeamsController, ProfileController, TeacherController, AdminController, ReportsController,
  ],
  providers: [
    PrismaService, AuditService, NotifyService, CourseContext, StateService, RealtimeGateway, SessionService, AuthService,
    FilesService, BoardService, ChatService, AssignmentsService, TeamsService, ProfileService, TeacherService,
    AdminService, BackupService, ReportsService, JobsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
