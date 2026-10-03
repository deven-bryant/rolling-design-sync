# syntax=docker/dockerfile:1

# Neutral by default: no RDS_STORE, HOST, or RDS_DATA_DIR here, so a platform
# build (e.g. Railway) runs DATABASE_URL mode exactly like `npm start`.
# Local-mode settings live in compose.yaml.
ARG NODE_IMAGE=node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN npm ci --omit=dev --workspace @rolling-design-sync/api --include-workspace-root=false --no-audit --no-fund \
  && npm cache clean --force

FROM ${NODE_IMAGE} AS portal
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/portal/package.json apps/portal/
RUN npm ci --workspace @rolling-design-sync/portal --include-workspace-root=false --no-audit --no-fund
COPY apps/portal apps/portal
RUN npm run build --workspace @rolling-design-sync/portal

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/core/package.json packages/core/index.js packages/core/
COPY apps/api/package.json apps/api/LICENSE.md apps/api/
COPY apps/api/src apps/api/src
COPY --from=portal /app/apps/portal/dist apps/portal/dist
COPY supabase/migrations supabase/migrations
RUN mkdir -p /data && chown node:node /data && chmod 0700 /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/src/server.js"]
