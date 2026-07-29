#!/usr/bin/env sh
set -eu

api_url="${API_PUBLIC_URL:-http://localhost:4000}"
worker_url="${WORKER_PUBLIC_URL:-http://localhost:4001}"

curl --fail --silent --show-error "${api_url}/health"
printf "\n"
curl --fail --silent --show-error "${api_url}/ready"
printf "\n"
curl --fail --silent --show-error "${worker_url}/health"
printf "\n"
curl --fail --silent --show-error "${worker_url}/ready"
printf "\n"
