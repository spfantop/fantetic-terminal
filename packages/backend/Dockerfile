FROM node:20 AS builder

WORKDIR /app


# Copy root package files including the lock file
COPY package.json package-lock.json ./

# Copy workspace package.json files to ensure npm ci works correctly in monorepo
COPY packages/backend/package.json ./packages/backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
COPY packages/remote-gateway/patches ./packages/remote-gateway/patches

RUN npm ci

COPY packages/backend/src ./packages/backend/src
COPY packages/backend/tsconfig.json ./packages/backend/
COPY packages/backend/html-presets ./packages/backend/html-presets
COPY packages/contracts/index.d.ts ./packages/contracts/

RUN npm run build --workspace=@fantetic-terminal/backend


FROM node:20-alpine

WORKDIR /app


COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

COPY --from=builder /app/packages/backend/src/locales ./packages/backend/dist/locales
COPY --from=builder /app/packages/backend/html-presets ./packages/backend/html-presets

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
RUN apk add --no-cache --virtual .build-deps python3 py3-setuptools make g++ \
    && npm ci --omit=dev --workspace=@fantetic-terminal/backend \
    && npm cache clean --force \
    && apk del .build-deps


EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/v1/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "packages/backend/dist/index.js"]
