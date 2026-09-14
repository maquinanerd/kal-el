# build stage
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kal-el/worker build

# production dependencies stage — the bundle compiles the workspace packages in and imports
# third-party packages (drizzle-orm, pg, zod) from node_modules at runtime. Production only,
# for the worker and what it depends on, flat ("hoisted") so transitive dependencies of the
# bundled workspace packages resolve from /app/node_modules. See apps/api/Dockerfile.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --prod --frozen-lockfile --filter "@kal-el/worker..." --config.node-linker=hoisted

# runtime stage
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The bundle is ESM; without a package.json saying so, Node parses it twice on every boot.
RUN echo '{"type":"module"}' > package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
CMD ["node", "dist/worker.js"]
