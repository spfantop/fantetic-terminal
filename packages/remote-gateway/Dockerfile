FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
COPY packages/remote-gateway/patches ./packages/remote-gateway/patches

RUN npm ci

COPY packages/remote-gateway/src ./packages/remote-gateway/src
COPY packages/remote-gateway/tsconfig.json ./packages/remote-gateway/tsconfig.json
COPY packages/remote-gateway/guacamole-lite.d.ts ./packages/remote-gateway/guacamole-lite.d.ts

RUN npm run build --workspace=@fantetic-terminal/remote-gateway

FROM node:20-alpine AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
COPY packages/remote-gateway/patches ./packages/remote-gateway/patches

RUN npm ci --omit=dev --workspace=@fantetic-terminal/remote-gateway \
    && npm cache clean --force

FROM guacamole/guacd:1.6.0@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f

USER root
RUN apk upgrade --no-cache \
    && apk add --no-cache curl bash netcat-openbsd su-exec libstdc++ libgcc

WORKDIR /app

COPY --from=builder /app/packages/remote-gateway/dist ./dist
COPY --from=production-dependencies /app/node_modules ./node_modules
# npm 将仅属于工作区的运行时依赖安装在工作区目录下；合并到应用根目录以供 dist/server.js 解析。
COPY --from=production-dependencies /app/packages/remote-gateway/node_modules ./node_modules
# production-dependencies omits patch-package, so preserve the verified AES-GCM-compatible module from builder.
COPY --from=builder /app/packages/remote-gateway/node_modules/guacamole-lite ./node_modules/guacamole-lite
# The gateway runtime needs Node.js but never npm; copy only the runtime binary to keep npm CVEs out of the image.
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
COPY packages/remote-gateway/package.json ./package.json
COPY packages/remote-gateway/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && chown -R guacd:guacd /app

EXPOSE 9090 8081

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:9090/health/ready > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
