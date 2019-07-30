# syntax = docker/dockerfile:experimental
FROM node:12.7.0-alpine

RUN \
--mount=type=cache,target=/var/cache/apk \
--mount=type=cache,target=/var/lib/apk \
--mount=type=cache,target=/etc/apk/cache \
apk --update add \
bash \
curl

COPY --from=hairyhenderson/gomplate:v3.5.0 /gomplate /usr/local/bin/

WORKDIR /app

COPY package.json yarn.lock /app/
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install

COPY src /app/src

CMD ["node", "/app/src"]
