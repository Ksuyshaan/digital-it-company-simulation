# Digital IT Company Simulation

Веб-платформа для дисциплины «Лидерство в IT»: 15 недель студенты работают как IT-компания —
сначала индивидуально, затем в командах по Scrum/Kanban. Преподаватель видит всю работу и переписку, баллы считаются автоматически.

Техническое задание — `Техническое_задание_«Digital_IT_Company_Simulation».docx`.

| Папка | Что внутри |
|---|---|
| [frontend/](frontend/) | SPA: React 18 + TypeScript + Vite ([README](frontend/README.md)) |
| [backend/](backend/) | API: NestJS + Prisma + PostgreSQL, Socket.IO, S3 ([README](backend/README.md)) |
| [deploy/](deploy/) | nginx и образ фронтенда, конфигурация хранилища файлов |

## Запуск всего в Docker

```bash
docker compose up -d --build
docker compose exec api npm run seed     # демо-курс
```

Сайт — http://localhost:8080, API — http://localhost:8080/api, документация API — http://localhost:8080/api/docs.
Подробности, настройка входа через Microsoft 365 / Google и запуск для разработки — в [backend/README.md](backend/README.md).
