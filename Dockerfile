FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/sync-protocol/package.json packages/sync-protocol/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --dir apps/web build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next-build/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next-build/static ./apps/web/.next-build/static
# The public demo's daily reseed applies the Better Auth schema from this file.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/db/better-auth.sql ./apps/web/db/better-auth.sql
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
