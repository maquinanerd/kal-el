# build stage
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kal-el/api build

# production dependencies stage
#
# The bundle compiles the workspace packages in (they publish TypeScript source) but imports
# every third-party package — fastify, drizzle-orm, pg, @node-rs/argon2 — from node_modules
# at runtime. They are installed here: production only, for the API and what it depends on,
# and flat ("hoisted"), so that a dependency of a bundled workspace package the API does not
# declare itself, such as `pg` for @kal-el/db, still resolves from /app/node_modules.
# Installing inside this Alpine image is also what selects the musl build of native modules.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --prod --frozen-lockfile --filter "@kal-el/api..." --config.node-linker=hoisted

# runtime stage
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/db/drizzle ./drizzle
EXPOSE 3001
CMD ["node", "dist/server.js"]
