#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and replace local placeholders." >&2
  exit 1
fi

docker compose up -d --wait postgres redis minio
docker compose run --rm minio-init
docker compose ps
