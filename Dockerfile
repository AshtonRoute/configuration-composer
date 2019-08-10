# syntax = docker/dockerfile:experimental
FROM node:12.8.0-alpine

RUN \
  --mount=type=cache,target=/var/cache/apk \
  --mount=type=cache,target=/var/lib/apk \
  --mount=type=cache,target=/etc/apk/cache \
  apk --update add \
  git \
  bash \
  curl

WORKDIR /app

COPY package.json yarn.lock /app/
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
  yarn install

COPY src /app/src

CMD ["node", "/app/src"]
