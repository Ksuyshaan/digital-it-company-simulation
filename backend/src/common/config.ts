/** Конфигурация из переменных окружения (см. .env.example) */
const env = (k: string, d = '') => process.env[k] ?? d
const bool = (k: string, d = false) => (process.env[k] === undefined ? d : ['1', 'true', 'yes'].includes(String(process.env[k]).toLowerCase()))

export const config = {
  port: Number(env('PORT', '3000')),
  /** Адрес фронтенда — для CORS и редиректа после входа */
  frontendUrl: env('FRONTEND_URL', 'http://localhost:5173'),
  /** Публичный адрес API — для redirect_uri OIDC */
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000'),
  cookieSecure: bool('COOKIE_SECURE', false),
  /** Вход по почте без OIDC — только для разработки и демо */
  devLogin: bool('AUTH_DEV_LOGIN', false),
  /** Стартовый домен корпоративной почты (дальше меняется в админ-панели) */
  domain: env('AUTH_DOMAIN', 'university.kz'),
  oidc: {
    /** microsoft | google */
    provider: env('OIDC_PROVIDER', 'microsoft'),
    issuer: env('OIDC_ISSUER', ''), // напр. https://login.microsoftonline.com/<tenant>/v2.0
    clientId: env('OIDC_CLIENT_ID', ''),
    clientSecret: env('OIDC_CLIENT_SECRET', ''),
  },
  s3: {
    endpoint: env('S3_ENDPOINT', 'http://localhost:9000'),
    region: env('S3_REGION', 'us-east-1'),
    accessKey: env('S3_ACCESS_KEY', 'minioadmin'),
    secretKey: env('S3_SECRET_KEY', 'minioadmin'),
    bucket: env('S3_BUCKET', 'dits-files'),
  },
  /** ClamAV (clamd) для проверки файлов антивирусом; пусто — проверка пропускается */
  clamav: { host: env('CLAMAV_HOST', ''), port: Number(env('CLAMAV_PORT', '3310')) },
  smtp: {
    host: env('SMTP_HOST', ''),
    port: Number(env('SMTP_PORT', '587')),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('SMTP_FROM', 'Digital IT Company <noreply@university.kz>'),
  },
  backup: { dir: env('BACKUP_DIR', './backups'), keepDays: Number(env('BACKUP_KEEP_DAYS', '30')) },
  /** Шрифт с кириллицей для PDF */
  pdfFont: env('PDF_FONT', ''),
  databaseUrl: env('DATABASE_URL', ''),
  teamQuotaBytes: 2 * 1024 * 1024 * 1024,
}
