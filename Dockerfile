FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS prod-deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data && chown -R node:node /data

FROM runtime-base AS preview-runner
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts ./next.config.ts
USER node
EXPOSE 3100
CMD ["sh", "-c", "node scripts/tools/validate-env.js --mode ${CODIP_ENV_MODE:-production} && if [ \"${CODIP_RUN_MIGRATIONS_ON_START:-false}\" = \"true\" ]; then case \"$DATABASE_URL\" in postgresql://*|postgres://*) npx prisma migrate deploy --schema prisma/postgresql/schema.prisma && if [ \"${CODIP_SEED_ON_START:-false}\" = \"true\" ]; then npm run db:pg:seed; fi ;; *) npx prisma migrate deploy && if [ \"${CODIP_SEED_ON_START:-false}\" = \"true\" ]; then npx prisma db seed; fi ;; esac; fi && npm run start -- --hostname 0.0.0.0 --port ${PORT}"]

FROM runtime-base AS runner
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts ./next.config.ts
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 3100
CMD ["sh", "-c", "node scripts/tools/validate-env.js --mode ${CODIP_ENV_MODE:-production} && node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port ${PORT}"]
