# better-sqlite3 is a native module, so the build stage needs a toolchain that
# the final image does not have to carry.
FROM node:24-bookworm-slim AS build

RUN corepack enable
WORKDIR /repo

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/

RUN pnpm install --frozen-lockfile --filter @challenge/server...

COPY packages/core packages/core
COPY apps/server apps/server

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /repo

RUN corepack enable

COPY --from=build /repo /repo

# The database lives on a volume; without one, every redeploy wipes the
# accumulated totals and the challenge restarts from zero.
VOLUME ["/repo/apps/server/data"]
ENV DATABASE_PATH=/repo/apps/server/data/challenge.db

WORKDIR /repo/apps/server
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
