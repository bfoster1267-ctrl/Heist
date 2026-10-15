# Heist game server, serving the web app too. Build from the repo root:  docker build -f packages/server/Dockerfile -t heist-server .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/profile packages/profile
COPY packages/server packages/server
COPY apps/web apps/web
RUN npm ci --workspace packages/server --workspace packages/engine --workspace packages/profile --workspace apps/web --include-workspace-root=false
RUN npm run build -w packages/server
# the app talks to this same server for accounts and online play
RUN VITE_SERVER_URL=same-origin npm run build -w apps/web

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/packages/server/dist/main.js ./main.js
COPY --from=build /app/apps/web/dist ./web
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web
EXPOSE 8080
# mount a volume at /data so accounts, game logs and tables mid-game survive restarts and deploys
CMD ["node", "main.js"]
