FROM qdrant/qdrant:v1.13.2 AS qdrant
FROM node:22-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

# Node app build
COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm install && npm run build && npm prune --omit=dev

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
