FROM node:20 AS builder

WORKDIR /app


# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package.json files to ensure npm ci works correctly in monorepo
COPY packages/backend/package.json ./packages/backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/remote-gateway/package.json ./packages/remote-gateway/
COPY build-tools/apply-patches.js ./build-tools/
COPY packages/remote-gateway/patches ./packages/remote-gateway/patches

# The lock file is the deployable dependency contract.
RUN npm ci

COPY build-tools ./build-tools
COPY packages/frontend/src ./packages/frontend/src
COPY packages/contracts/index.d.ts ./packages/contracts/
COPY packages/frontend/index.html ./packages/frontend/
COPY packages/frontend/tsconfig.json ./packages/frontend/
COPY packages/frontend/vite.config.ts ./packages/frontend/
COPY packages/frontend/public ./packages/frontend/public/

RUN npm run build --workspace=@fantetic-terminal/frontend


FROM nginx:stable-alpine


RUN apk upgrade --no-cache \
    && rm -rf /usr/share/nginx/html/*


COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html


COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf


EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
