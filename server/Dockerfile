FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
# Numbered migrations, applied at start-up (P7.2).
COPY sql ./sql

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/index.js"]
