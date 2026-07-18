FROM node:20 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
COPY packages/remote-gateway/patches ./packages/remote-gateway/patches

RUN npm ci

COPY build-tools ./build-tools/
COPY packages/contracts/index.d.ts ./packages/contracts/
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/tsconfig.json ./packages/backend/
COPY packages/backend/html-presets ./packages/backend/html-presets
COPY packages/frontend/src ./packages/frontend/src
COPY packages/frontend/public ./packages/frontend/public
COPY packages/frontend/index.html packages/frontend/tsconfig.json packages/frontend/vite.config.ts ./packages/frontend/
COPY packages/remote-gateway/src ./packages/remote-gateway/src
COPY packages/remote-gateway/tsconfig.json packages/remote-gateway/guacamole-lite.d.ts ./packages/remote-gateway/

RUN npm run build --workspace=@fantetic-terminal/backend \
    && npm run build --workspace=@fantetic-terminal/frontend \
    && npm run build --workspace=@fantetic-terminal/remote-gateway

# Debian does not provide a stable guacd package for every supported architecture.
# Keep the official guacd userspace isolated so the Debian Node runtime is never
# coupled to Alpine's musl libraries.
FROM guacamole/guacd:1.6.0@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f AS guacd-runtime

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    DEPLOYMENT_MODE=docker \
    APP_BACKEND_DATA_PATH=/app/data \
    REMOTE_GATEWAY_API_BASE_DOCKER=http://127.0.0.1:9090 \
    REMOTE_GATEWAY_WS_URL_DOCKER=ws://127.0.0.1:8080 \
    REMOTE_GATEWAY_API_PORT=9090 \
    REMOTE_GATEWAY_WS_PORT=8080 \
    GUACD_HOST=127.0.0.1 \
    GUACD_PORT=4822

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
COPY packages/remote-gateway/patches ./packages/remote-gateway/patches

# Build tools are purged in the same layer. The image keeps one Node runtime for
# both application services, instead of embedding a second runtime for the gateway.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends nginx tini python3 make g++ \
    && npm ci --omit=dev --workspace=@fantetic-terminal/backend --workspace=@fantetic-terminal/remote-gateway \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && rm -rf ./node_modules/esbuild ./node_modules/@esbuild \
    && rm -f ./node_modules/.bin/esbuild

COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/src/locales ./packages/backend/dist/locales
COPY --from=builder /app/packages/backend/html-presets ./packages/backend/html-presets
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY --from=builder /app/packages/remote-gateway/dist ./packages/remote-gateway/dist
# Production dependencies omit patch-package. Preserve the verified patched module
# produced in the build stage for the gateway's AES-GCM token handling.
COPY --from=builder /app/packages/remote-gateway/node_modules/guacamole-lite ./packages/remote-gateway/node_modules/guacamole-lite
COPY --from=guacd-runtime / /opt/guacd-runtime/

COPY packages/single-image/nginx.conf /etc/nginx/conf.d/fantetic-terminal.conf
COPY packages/single-image/supervisor.js /app/supervisor.js

RUN rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /app/data \
    && chmod 700 /app/data \
    && chmod 755 /app/supervisor.js

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD node -e "Promise.all([fetch('http://127.0.0.1/api/v1/health/ready'), fetch('http://127.0.0.1:9090/health/ready')]).then(results => { if (results.some(result => !result.ok)) process.exit(1); }).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/supervisor.js"]
