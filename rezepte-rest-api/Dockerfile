# syntax=docker/dockerfile:1.7

# ---------- Builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /workspace

# OpenSSL für Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# libs werden über Path-Alias eingebunden, daher mitkopieren
COPY libs ./libs
COPY rezepte-rest-api/package.json rezepte-rest-api/package.json
WORKDIR /workspace/rezepte-rest-api
RUN npm install --no-audit --no-fund --legacy-peer-deps

WORKDIR /workspace
COPY rezepte-rest-api/tsconfig.json rezepte-rest-api/tsconfig.json
COPY rezepte-rest-api/tsconfig.build.json rezepte-rest-api/tsconfig.build.json
COPY rezepte-rest-api/nest-cli.json rezepte-rest-api/nest-cli.json
COPY rezepte-rest-api/prisma.config.ts rezepte-rest-api/prisma.config.ts
COPY rezepte-rest-api/prisma rezepte-rest-api/prisma
COPY rezepte-rest-api/src rezepte-rest-api/src

WORKDIR /workspace/rezepte-rest-api
# DATABASE_URL beim Build: Dummy-Wert, prisma generate braucht sie nur formal
RUN DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder" npx prisma generate
RUN npm run build

# Prod-Deps mit Prisma-Engines (für späteres Stage)
RUN npm prune --omit=dev --legacy-peer-deps

# ---------- Runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# libs für Path-Alias-Resolver zur Laufzeit (tsconfig-paths)
COPY --from=builder /workspace/libs ./libs
COPY --from=builder /workspace/rezepte-rest-api/package.json ./package.json
COPY --from=builder /workspace/rezepte-rest-api/node_modules ./node_modules
COPY --from=builder /workspace/rezepte-rest-api/dist ./dist
COPY --from=builder /workspace/rezepte-rest-api/prisma ./prisma
COPY --from=builder /workspace/rezepte-rest-api/prisma.config.ts ./prisma.config.ts

RUN mkdir -p /app/uploads /app/data

EXPOSE 3000

# Migrations bei jedem Start anwenden, dann App starten.
# `db push` ist für Single-User/Hobby-Setup ausreichend (kein Migration-Verlauf nötig).
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && (test -f dist/rezepte-rest-api/src/main.js && node dist/rezepte-rest-api/src/main.js || node dist/main.js)"]
