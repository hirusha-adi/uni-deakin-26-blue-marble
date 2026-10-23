# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PROMPT_CHAT_DATA_DIR=/app/.data

RUN groupadd --gid 1001 nextjs \
    && useradd --uid 1001 --gid nextjs --no-create-home nextjs \
    && mkdir -p /app/.data \
    && chown nextjs:nextjs /app/.data \
    && chmod 700 /app/.data

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/SYSTEM_PROMPT.md ./SYSTEM_PROMPT.md

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
