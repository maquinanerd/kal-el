# build stage
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* is inlined at build time, not read from the environment at runtime, so the
# API origin the browser will call has to be supplied here. A deployment that forgets it
# ships a CMS whose fetches go to http://localhost:3001 from the user's own machine.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Traced output, so the runtime stage carries the server's actual dependencies rather than
# the whole workspace. Opt-in because the trace needs symlink privileges a Windows dev
# machine does not have by default - see apps/cms/next.config.mjs.
ENV NEXT_OUTPUT=standalone
RUN pnpm --filter @kal-el/cms build

# runtime stage (next standalone output traces only the files the server needs)
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/cms/.next/standalone ./
COPY --from=build /app/apps/cms/.next/static ./apps/cms/.next/static
# `public/` is NOT part of the standalone trace: Next only traces what the server
# imports, and a static asset referenced by a `src="/..."` string is not an import.
# It has to be copied explicitly, next to `.next/static`, or every asset in it 404s
# with nothing saying why — which is exactly what happened between 2026-08-20
# (when `public/` was added with the login art and the brand marks) and this commit.
COPY --from=build /app/apps/cms/public ./apps/cms/public
EXPOSE 3000
# standalone emits the server at the traced path of the app that produced it
CMD ["node", "apps/cms/server.js"]
