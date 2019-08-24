# syntax = docker/dockerfile:experimental
FROM node:12.9.0-alpine

RUN \
  --mount=type=cache,target=/var/cache/apk \
  --mount=type=cache,target=/var/lib/apk \
  --mount=type=cache,target=/etc/apk/cache \
  apk --update add \
  git \
  bash \
  curl

WORKDIR /app

RUN yarn config set save-exact
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
  yarn global add npm-check-updates

COPY package.json yarn.lock /app/
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
  yarn install

COPY babel.config.js /app/
COPY src /app/src

CMD ["node", "/app/src"]
