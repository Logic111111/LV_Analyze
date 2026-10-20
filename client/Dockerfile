# Built from the repository root (docker-compose: context ".", dockerfile client/Dockerfile) so the
# build sees the shared engine package (P7.1), a file: dependency of the client.
FROM node:22-alpine AS build

WORKDIR /app/client

COPY packages/engine /app/packages/engine
COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
