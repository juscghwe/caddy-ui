# syntax=docker/dockerfile:1
FROM node:24-alpine AS build

ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci

COPY index.html .
COPY vite.config.js .
COPY caddyui-logo.ico caddyui-logo.svg caddyui-logo.png ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    NODE_USE_ENV_PROXY=1 npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.d/25-auth-proxy.sh /docker-entrypoint.d/25-auth-proxy.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
