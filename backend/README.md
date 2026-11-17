# Digital IT Company Simulation — бэкенд

Сервер платформы «Лидерство в IT» по ТЗ (корень репозитория). Стек — вариант 2 из п. 9 ТЗ:
**NestJS + TypeScript, PostgreSQL 15, S3-совместимое хранилище файлов, Socket.IO, Docker Compose**, REST API с OpenAPI.

Бизнес-правила и формулы (`src/domain/rules.ts`) перенесены с фронтенда один в один, поэтому сервер и клиент
считают рейтинг, штрафы, проверки команд и сигналы одинаково. Все проверки прав выполняются на сервере для каждого запроса.

## Быстрый старт (локально)

```bash
# из корня репозитория: PostgreSQL (127.0.0.1:55432) и хранилище файлов S3 (127.0.0.1:8333)
docker compose up -d db s3

cd backend
cp .env.example .env          # AUTH_DEV_LOGIN=true — демо-вход по почте
npm install
npx prisma migrate deploy     # схема БД
npm run seed                  # демо-курс: 96 студентов, 22 команды (как во фронтенде)
npm run build && npm start    # http://localhost:3000/api, документация — /api/docs
```

Демо-учётки (вход `POST /api/auth/dev-login {"email": …}`):

| Роль | Почта |
|---|---|
| Администратор | admin@university.kz |
| Преподаватель | zh.nurlanova@university.kz |
| Ассистент | o.bekonov@university.kz |
| Студентка, Team Lead Nomad Labs | a.saparova@university.kz |
| Студент, Scrum Master Nomad Labs | d.akhmetov@university.kz |

Код приглашения на демо-курс: `LEAD-2026`.

## Всё в Docker (сервер университета)

```bash
docker compose up -d --build                  # db, s3, api, web (фронтенд + прокси /api и /socket.io)
docker compose exec api npm run seed          # демо-данные, или:
docker compose exec -e SEED_MODE=empty -e ADMIN_EMAIL=it@university.kz api npm run seed   # чистая установка
docker compose --profile antivirus up -d      # + ClamAV; задайте CLAMAV_HOST=clamav для api
```

Сайт: http://localhost:8080. Для продакшена: HTTPS на внешнем прокси, `COOKIE_SECURE=true`, `AUTH_DEV_LOGIN=false`,
свои пароли (`DB_PASSWORD`, `S3_ACCESS_KEY/S3_SECRET_KEY` и `deploy/s3.json`), OIDC-приложение (ниже).

> MinIO больше не публикует образы в открытых реестрах, поэтому в compose — SeaweedFS с тем же S3 API.
> Если у IT-службы есть MinIO или другой S3 — уберите сервис `s3` и задайте `S3_ENDPOINT` и ключи.

### Вход через Microsoft 365 / Google Workspace (OIDC)

1. Зарегистрируйте приложение, redirect URI: `${PUBLIC_URL}/api/auth/callback`.
2. `.env`: `OIDC_PROVIDER=microsoft|google`, `OIDC_ISSUER` (Microsoft: `https://login.microsoftonline.com/<tenant>/v2.0`,
   Google: `https://accounts.google.com`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `AUTH_DEV_LOGIN=false`.
3. Фронтенд ведёт на `GET /api/auth/login?invite=КОД&redirect=/путь` — после входа сервер ставит cookie и возвращает на фронтенд.

Вход с другого домена отклоняется. Новый студент без записи в списках попадает на курс только по коду приглашения.
Сессия закрывается после 8 ч бездействия (настраивается администратором).

## Проверка

```bash
npm test          # формулы ТЗ на примерах (вклад 8 баллов, 0,7/0,3, штраф, отклонение 30%, РД, правила команд)
npm run smoke     # 68 проверок API по сценариям приёмки (п. 11 ТЗ) на демо-данных; затем npm run seed
```

## Как устроено

```
src/
  domain/         types.ts, rules.ts (формулы ТЗ), util.ts, defaults.ts — общие с фронтендом
  state/          снимок курса в формате State фронтенда, фильтр по правам, кэш (≤ 60 с)
  auth/           OIDC, dev-вход, серверные сессии, глобальный guard (права, курс, CSRF, согласие)
  board/          карточки, переходы, чек-лист, файлы, спринты, burndown, ретроспектива (п. 4)
  chat/           каналы, ветки, реакции, правка 15 мин, удаление, поиск (п. 5)
  assignments/    задания, сдачи, штрафы, peer-review, оспаривание (п. 3.2–3.3)
  teams/          окно формирования, заявки, правила, утверждение, заморозка, переводы (п. 3.4)
  profile/        профиль, поиск, рейтинг, ручные баллы, проект ±20%, достижения, уведомления (п. 3.1, 3.5, 7)
  teacher/        блокировки, сигналы, метрики за период, настройки курса, журнал (п. 4.4, 6)
  admin/          пользователи, роли, курсы, импорт CSV/Excel, вход, резервные копии, состояние системы
  reports/        PDF и Excel: ведомость, отчёт по команде, карточка студента, история чата (п. 8)
  files/          загрузка в S3, 25 МБ, 2 ГБ на команду, запрет исполняемых, ClamAV
  realtime/       Socket.IO: changed / message / notification
  jobs/           расписание: блокировки, рецензенты, напоминания о дедлайнах, окно команд, снимки РД, бэкап
prisma/           schema.prisma, миграции, seed (демо-курс из frontend/src/data/seed.ts)
scripts/smoke.mjs приёмочный тест
```

**Журнал действий** нельзя изменить или удалить: на таблицу стоит триггер БД. **Резервные копии** — `pg_dump` ежедневно в 03:00
(Алматы) в том `backups`, хранятся 30 дней. Восстановление: `pg_restore --clean -d $DATABASE_URL файл.dump`. Том файлов `files`
копируется снапшотом средствами сервера.

## Подключение фронтенда

Фронтенд сейчас хранит всё в `localStorage`. Чтобы перевести его на сервер:

1. **Загрузка состояния.** `store.tsx` берёт `State` из `GET /api/state` (`credentials: 'include'`, заголовок `X-Course-Id`) вместо `createSeed()`.
   Ответ — тот же `State` плюс `computed` (рейтинг `scores`, `teamScores`, `badges`, для преподавателя `signals`) и `meta`.
   Студенту приходят только разрешённые данные, поэтому `allScores()` / `badgesOf()` на клиенте нужно заменить на `state.computed`.
2. **Realtime.** Подключиться к `socket.io` (cookie передаётся сама). На `changed` — перезапросить `/api/state`
   (с задержкой ~300 мс); `message` — добавить или обновить сообщение в чате; `notification` — показать.
3. **Действия.** Каждую функцию из `data/actions.ts` заменить на вызов API. Тексты ошибок совпадают — сервер возвращает
   их в `message`, их можно показывать тем же тостом.
4. **Вход.** Кнопка провайдера → `/api/auth/login`; демо-форма → `POST /api/auth/dev-login`; `GET /api/auth/me` →
   `consentRequired` → `POST /api/auth/consent`. «Вид студента» — заголовок `X-View-As: <id>` (только чтение).
5. **Файлы.** Сначала `POST /api/files` (multipart, `?context=channel|card|submission&teamId=`), затем `fileIds` в сообщении или карточке.

| actions.ts | API |
|---|---|
| createCard / updateCard / moveCard | `POST /teams/:id/cards`, `PATCH /cards/:id`, `POST /cards/:id/move {to, comment}` |
| archiveCard / restoreCard | `POST /cards/:id/archive`, `POST /cards/:id/restore` |
| commentCard / attachToCard | `POST /cards/:id/comments {text, fileIds}`, `POST /cards/:id/files {fileIds}` |
| checklistAdd / Toggle / Remove | `POST /cards/:id/checklist`, `POST /cards/:id/checklist/:item/toggle`, `DELETE …/:item` |
| setCardSprint | `PUT /cards/:id/sprint {sprintId}` |
| startSprint / closeSprint | `POST /teams/:id/sprints`, `POST /sprints/:id/close {unfinished}` |
| addRetroItem / rateTeammates | `POST /sprints/:id/retro/items`, `PUT /sprints/:id/retro/ratings` |
| sendMessage / editMessage / deleteMessage / react | `POST /channels/:id/messages`, `PATCH /messages/:id`, `DELETE /messages/:id`, `POST /messages/:id/reactions` |
| updateProfile | `PUT /profile`; фото — `POST /profile/photo` |
| adjustPoints / setProjectAdjust / setProjectScore | `POST /points/adjust`, `PUT /students/:id/project-adjust`, `PUT /teams/:id/project-score` |
| grantBadge | `POST /badges` |
| createAssignment / submitWork / gradeWork / extendFor | `POST /assignments`, `POST /assignments/:id/submit`, `POST /submissions/:id/grade`, `POST /assignments/:id/extend` |
| runReviewAssignment / submitReview / disputeReview / resolveDispute | `POST /assignments/:id/assign-reviewers`, `POST /submissions/:id/reviews/:rid`, `…/dispute`, `…/resolve` |
| startFormationDemo | `POST /formation/open {deadline?}` (окно открывается и автоматически в понедельник 8 недели) |
| createDraftTeam / requestJoin / inviteStudent / answerRequest | `POST /formation/teams`, `POST /formation/teams/:id/requests`, `…/invites`, `POST /formation/requests/:id/answer` |
| setMemberRole / removeFromDraft / submitTeam / reviewTeam | `PUT /formation/teams/:id/roles/:sid`, `DELETE /formation/teams/:id/members/:sid`, `…/submit`, `…/review` |
| autoDistribute / freezeTeams | `POST /formation/auto-distribute`, `POST /formation/freeze` |
| moveStudentTeam / setTeamRole / renameTeam | `PUT /students/:id/team`, `PUT /students/:id/team-role`, `PATCH /teams/:id` |
| addLock / cancelLock / dismissSignal | `POST /locks`, `DELETE /locks/:id`, `POST /analytics/signals/:id/dismiss` |
| updateSettings | `PUT /course/settings {settings, course}` |
| markNotificationsRead | `POST /notifications/read` |
| setUserRole / toggleBlock / addUser / importUsers | `PUT /admin/users/:id/role`, `POST /admin/users/:id/toggle-block`, `POST /admin/users`, `POST /admin/import?courseId=` |
| createCourse / updateAdmin / backupNow | `POST /admin/courses`, `PUT /admin/settings`, `POST /admin/backup` |
| экспорт CSV/печать | `GET /reports/gradebook?format=xlsx|pdf`, `/reports/teams/:id`, `/reports/students/:id`, `/reports/teams/:id/chat` |

Дополнительно: `GET /analytics/metrics?scope=course|team|student&period=week|sprint|stage|custom`, `GET /users?skill=&role=&sort=rating`,
`GET /messages/search`, `GET /teams/:id/planning` (SP на участника, скорость прошлого спринта, следующий SM при ротации),
`GET /sprints/:id/burndown`, `GET /rating`, `GET /audit`, `GET /admin/health`.
