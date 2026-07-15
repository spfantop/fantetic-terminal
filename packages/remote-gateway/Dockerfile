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

FROM guacamole/guacd:latest

USER root
RUN apk add --no-cache nodejs curl bash netcat-openbsd su-exec

WORKDIR /app

COPY --from=builder /app/packages/remote-gateway/dist ./dist
COPY --from=production-dependencies /app/node_modules ./node_modules
# npm 将仅属于工作区的运行时依赖安装在工作区目录下；合并到应用根目录以供 dist/server.js 解析。
COPY --from=production-dependencies /app/packages/remote-gateway/node_modules ./node_modules
COPY packages/remote-gateway/package.json ./package.json
COPY packages/remote-gateway/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && chown -R guacd:guacd /app

EXPOSE 9090 8081

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:9090/health/ready > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
