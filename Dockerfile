# SYSONE digital twin — một container: giao diện (dist/) + API + WebSocket + SQLite.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DB_PATH=/data/sysone.db
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
