FROM qdrant/qdrant:v1.17.0 AS qdrant

# ── Build stage ──────────────────────────────────────────────────────────────
# python3/make/g++ are needed only to compile sqlite3 native bindings.
# They are NOT copied to the runtime stage.
FROM node:22.23.4-alpine AS builder
WORKDIR /app
# Use the npm version bundled with this Node release. A floating npm major can
# change dependency lifecycle policy independently of the runtime update.
RUN apk add --no-cache python3 make g++
COPY package.json .npmrc tsconfig.json ./
COPY src ./src
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    npm install && npm run build && npm prune --omit=dev && \
    sed -i '/_authToken/d' .npmrc

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine
RUN addgroup -S app && adduser -S app -G app
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

# A TypeScript build does not load native addons. Exercise the final image's
# SQLite binding as its runtime user before the image can be published.
RUN node -e 'const a=require("node:assert/strict");const db=new(require("sqlite3").Database)(":memory:");db.get("SELECT 1 AS ok",(error,row)=>{if(error)throw error;a.equal(row.ok,1);db.close(error=>{if(error)throw error;});});'

EXPOSE 8082 6333
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
