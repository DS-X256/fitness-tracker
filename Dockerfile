# --- build the app ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# SvelteKit's build-time route analysis imports src/lib/server/db, which requires
# DATABASE_URL to be set — .env is intentionally excluded from the build context
# (.dockerignore), so this stage needs its own throwaway value. Never used to store
# real data; discarded when this stage ends.
ENV DATABASE_URL=/tmp/build.db
RUN npm run build

# --- install production-only dependencies (separately, so dev deps never reach the final image) ---
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime image ---
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts

EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js && node build/index.js"]
