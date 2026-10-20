# Built from the repository root (docker-compose: context ".", dockerfile server/Dockerfile) so the
# image contains the shared engine package next to the server, as in the repository (P7.1).
FROM node:22-alpine

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src ./src
# Numbered migrations, applied at start-up (P7.2).
COPY server/sql ./sql
# The shared engine (pure ES modules), loaded with import() by src/engine.js.
COPY packages/engine /app/packages/engine

ENV NODE_ENV=production
EXPOSE 4000
USER node

CMD ["node", "src/index.js"]
