FROM qdrant/qdrant:v1.17.0 AS qdrant

# ── Build stage ──────────────────────────────────────────────────────────────
# python3/make/g++ are needed only to compile sqlite3 native bindings.
# They are NOT copied to the runtime stage.
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ && npm install -g npm@latest
COPY package.json .npmrc tsconfig.json ./
COPY src ./src
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    npm install && npm run build && npm prune --omit=dev && \
    sed -i '/_authToken/d' .npmrc

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine
RUN npm install -g npm@latest \
 && addgroup -S app && adduser -S app -G app
WORKDIR /app

# App (built output + prod node_modules only — no build tools)
COPY --from=builder /app/dist       ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.npmrc     ./.npmrc

# Embedded qdrant binary
COPY --from=qdrant /qdrant /qdrant

# Runtime files
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /tmp/mem0 /qdrant/storage \
 && chown -R app:app /tmp/mem0 /app /qdrant/storage /tmp

USER app
ENV HOME=/tmp
ENV MEM0_DIR=/tmp/mem0
ENV QDRANT_HOST=127.0.0.1
ENV QDRANT_PORT=6333
EXPOSE 8082 6333
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
