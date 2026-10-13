FROM node:24-alpine

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN apk add --no-cache docker-cli

# Caddy binary for caddy fmt, validation and version detection in local mode
# (instances without a container name). Docker mode uses the container's own.
COPY --from=caddy:latest /usr/bin/caddy /usr/bin/caddy

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache libcrypto3 \
    && apk add --no-cache --virtual .auth-build python3 make g++ openssl-dev \
    && npm ci --omit=dev \
    && apk del .auth-build

COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
