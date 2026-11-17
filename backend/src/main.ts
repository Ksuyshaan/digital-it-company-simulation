import './env'
import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { config } from './common/config'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false })
  app.set('trust proxy', 1)
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
  app.use(cookieParser())
  app.useBodyParser('json', { limit: '2mb' })
  app.setGlobalPrefix('api')
  app.enableCors({ origin: config.frontendUrl.split(',').map((x) => x.trim()), credentials: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }))
  app.enableShutdownHooks()

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Digital IT Company Simulation API')
      .setDescription(
        'REST API платформы «Лидерство в IT». Авторизация — cookie сессии (OIDC) или Authorization: Bearer. ' +
          'Курс выбирается заголовком X-Course-Id. Realtime — socket.io (события changed, message, notification).',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('dits_session')
      .build(),
  )
  SwaggerModule.setup('api/docs', app, doc)

  await app.listen(config.port, '0.0.0.0')
  Logger.log(`API: ${config.publicUrl}/api · документация: ${config.publicUrl}/api/docs`, 'Bootstrap')
}
bootstrap()
