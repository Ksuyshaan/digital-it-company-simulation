FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
# openssl — для Prisma; postgresql-client — pg_dump для резервных копий; DejaVu — кириллица в PDF
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl postgresql-client fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json tsconfig.json ./
COPY src/domain ./src/domain
RUN mkdir -p /app/backups && chown node:node /app/backups
USER node
EXPOSE 3000
# миграции применяются при каждом старте (идемпотентно)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
