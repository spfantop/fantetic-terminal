FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY packages/remote-gateway/package.json packages/remote-gateway/package-lock.json* ./

# Install ALL dependencies (including devDependencies like typescript)
RUN npm install

# Copy source code and tsconfig
COPY packages/remote-gateway/src ./src
COPY packages/remote-gateway/tsconfig.json ./tsconfig.json
COPY packages/remote-gateway/guacamole-lite.d.ts ./guacamole-lite.d.ts

# Build the TypeScript code
RUN npm run build

# Remove development dependencies after build
RUN npm prune --production

# --- Production Stage: guacd + Node.js ---
FROM guacamole/guacd:latest

USER root
RUN apk add --no-cache nodejs npm curl ca-certificates bash netcat-openbsd

WORKDIR /app

# Copy built code and node_modules from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# --- Add patch application steps ---
# Copy the patches directory from the build context (relative to project root)
COPY patches ./patches

# Install patch-package temporarily to apply patches
# Note: We install it here again in case prune removed it, and ensure it's available in the final stage.
# Using --no-save as we don't need it in the final package.json dependencies.
RUN npm install patch-package --no-save

# Apply patches
RUN npx patch-package --error-on-fail

# Uninstall patch-package after applying to keep the image clean
RUN npm uninstall patch-package && rm -rf patches /root/.npm /tmp/*
# --- End patch application steps ---

COPY packages/remote-gateway/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R guacd:guacd /app

USER guacd

EXPOSE 9090 8081

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:9090/health > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
