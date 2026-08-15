# build stage
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kal-el/api build

# runtime stage (tsup bundles all workspace deps into dist/server.js)
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/db/drizzle ./drizzle
EXPOSE 3001
CMD ["node", "dist/server.js"]
