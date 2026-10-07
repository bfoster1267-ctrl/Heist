# Heist game server. Build from the repo root:  docker build -f packages/server/Dockerfile -t heist-server .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/server packages/server
RUN npm ci --workspace packages/server --workspace packages/engine --include-workspace-root=false && npm run build -w packages/server

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/packages/server/dist/main.js ./main.js
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
# mount a volume at /data so game logs (and tables mid-game) survive restarts and deploys
CMD ["node", "main.js"]
