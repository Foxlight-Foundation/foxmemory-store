FROM node:22-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm install && npm run build && npm prune --omit=dev

USER app
EXPOSE 8082
CMD ["node", "dist/index.js"]
