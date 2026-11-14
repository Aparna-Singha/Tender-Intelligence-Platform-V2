#!/usr/bin/env bash
set -euo pipefail

approved_sha=48e80f60a396bbb869b66b3873840d6275bc46bd
deployed_sha=e71616555ad0ec47be4cfc98f193bcd69660048c
image="tender-worker:${approved_sha}"
source_dir="${GITHUB_WORKSPACE:?}/approved-source"
suffix="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
network="bidveda-runtime-${suffix}"
host_network="bidveda-runtime-host-${suffix}"
postgres="bidveda-runtime-pg-${suffix}"
redis="bidveda-runtime-redis-${suffix}"
worker="bidveda-runtime-worker-${suffix}"
stage=source
image_id=unbuilt
layer_fingerprint=unverified
idle_exit=unverified
idle_oom=unverified
result=FAIL

finish() {
  code=$?
  trap - EXIT
  set +e
  docker rm -fv "$worker" "$postgres" "$redis" >/dev/null 2>&1
  docker network rm "$network" >/dev/null 2>&1
  docker network rm "$host_network" >/dev/null 2>&1
  for resource in "$worker" "$postgres" "$redis"; do
    if docker inspect "$resource" >/dev/null 2>&1; then code=1; fi
  done
  if docker network inspect "$network" >/dev/null 2>&1; then code=1; fi
  if docker network inspect "$host_network" >/dev/null 2>&1; then code=1; fi
  if [[ $code -eq 0 ]]; then result=PASS; fi
  {
    echo '## Disposable worker runtime rehearsal'
    echo "- Result: ${result}"
    echo "- Last checkpoint: ${stage}"
    echo "- Approved source: ${approved_sha}"
    echo "- CI-built image ID: ${image_id}"
    echo '- Windows loaded OCI manifest ID: sha256:d0d3c1ba64a029e46c3df1b4526075b965d9680449d9ca888e766cc18a55c96e'
    echo "- CI-built layer DiffID fingerprint: ${layer_fingerprint}"
    echo '- Windows imported image: **not tested by this run**; IDs from different image stores may use different digest types'
    echo "- Idle SIGTERM exit / OOMKilled: ${idle_exit} / ${idle_oom}"
    echo '- Active-job drain: isolated real BullMQ integration test (not the application worker container)'
    echo '- Never-settling job: isolated negative unit test; no unconditional graceful-exit claim'
    echo '- Disposable containers and network: cleanup attempted'
  } >> "${GITHUB_STEP_SUMMARY:?}"
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

test "$(git -C "$source_dir" rev-parse HEAD)" = "$approved_sha"
git -C "$source_dir" merge-base --is-ancestor 33bb4d202099af6c28c31597260a3d79479f21ec "$approved_sha"
test -f "$source_dir/apps/worker/src/worker-shutdown.ts"
grep -Fq reciprocal-rank-fusion-v2 "$source_dir/packages/domain/src/rag-policy.ts"
if git -C "$source_dir" diff --name-only "$deployed_sha" "$approved_sha" | grep -Ei '(^|/)(eligibility|gemini-eligibility)|migration'; then
  echo 'Unexpected source scope.' >&2
  exit 1
fi
test ! -e "$source_dir/.env.staging"

stage=image-build
docker build --platform linux/amd64 \
  --file "$source_dir/infrastructure/docker/worker.Dockerfile" \
  --tag "$image" \
  --label "org.opencontainers.image.revision=$approved_sha" \
  "$source_dir"
image_id=$(docker image inspect "$image" --format '{{.Id}}')
layer_fingerprint=$(docker image inspect "$image" | jq -c '.[0].RootFS.Layers' | sha256sum | cut -d ' ' -f 1)
test "$(docker image inspect "$image" --format '{{.Architecture}}')" = amd64
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$approved_sha"
docker run --rm --network none --entrypoint /bin/sh "$image" -ec \
  'test "$(id -un)" = node && test -f /app/dist/main.js && test -f /app/dist/worker-shutdown.js && grep -Rq reciprocal-rank-fusion-v2 /app/dist /app/node_modules/@tender/domain'

stage=disposable-services
docker network create --internal "$network" >/dev/null
docker network create "$host_network" >/dev/null
# The host-facing bridge owns loopback publications; only the data services
# join both bridges. The application worker has no route outside the internal one.
docker run -d --name "$postgres" --network "$host_network" \
  -p 127.0.0.1:15442:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=synthetic-runtime-only \
  -e POSTGRES_DB=shutdown_rehearsal \
  pgvector/pgvector@sha256:5895949dfcdf308eb0cd31c950c93c14895c77f33fbedfecf1fa511ab1d4bcd2 >/dev/null
docker run -d --name "$redis" --network "$host_network" \
  -p 127.0.0.1:16391:6379 \
  redis@sha256:02419de7eddf55aa5bcf49efb74e88fa8d931b4d77c07eff8a6b2144472b6952 >/dev/null
docker network connect "$network" "$postgres"
docker network connect "$network" "$redis"
for attempt in {1..60}; do
  if docker exec "$postgres" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d shutdown_rehearsal >/dev/null 2>&1 &&
    [[ $(docker exec "$postgres" psql -U postgres -d shutdown_rehearsal -Atqc 'SELECT 1' 2>/dev/null) == 1 ]] &&
    [[ $(docker exec "$redis" redis-cli ping 2>/dev/null) == PONG ]]; then break; fi
  if [[ $attempt -eq 60 ]]; then echo 'Disposable service readiness failed.' >&2; exit 1; fi
  sleep 2
done

stage=disposable-migrations
export DATABASE_URL=postgresql://postgres:synthetic-runtime-only@127.0.0.1:15442/shutdown_rehearsal
export REDIS_URL=redis://127.0.0.1:16391
(
  cd "$source_dir"
  pnpm install --frozen-lockfile
  # Fail before migrations if either fixed loopback path used by the tests is unavailable.
  node -e 'const {Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});(async()=>{try{await c.connect();const q=await c.query("SELECT 1 AS ok");if(q.rows[0]?.ok!==1)throw new Error("unexpected response")}finally{await c.end().catch(()=>undefined)}})().catch(()=>{console.error("Disposable PostgreSQL host preflight failed");process.exitCode=1})'
  (cd apps/worker && node -e 'const Redis=require("ioredis");const r=new Redis(process.env.REDIS_URL,{connectTimeout:3000,maxRetriesPerRequest:1,retryStrategy:()=>null});r.ping().then(v=>{if(v!=="PONG")throw new Error("unexpected response");return r.quit()}).catch(()=>{r.disconnect();console.error("Disposable Redis host preflight failed");process.exitCode=1})')
  pnpm --filter @tender/database db:migrate:deploy
  pnpm turbo run build --filter=@tender/worker...
)
completed=$(docker exec "$postgres" psql -U postgres -d shutdown_rehearsal -Atqc \
  'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
failed=$(docker exec "$postgres" psql -U postgres -d shutdown_rehearsal -Atqc \
  'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL')
test "$completed" = 18 && test "$failed" = 0

stage=isolated-shutdown-tests
(
  cd "$source_dir"
  BIDVEDA_SHUTDOWN_POSTGRES_URL="$DATABASE_URL" \
    BIDVEDA_ISOLATED_SHUTDOWN_REDIS=YES \
    pnpm --filter @tender/worker exec vitest run \
      test/company-upload-recovery-postgres.test.ts \
      test/worker-shutdown-redis.test.ts \
      test/worker-shutdown.test.ts
)

stage=worker-startup
docker run -d --name "$worker" --network "$network" --memory 1g \
  -e NODE_ENV=production -e LOG_LEVEL=silent \
  -e DATABASE_URL="postgresql://postgres:synthetic-runtime-only@${postgres}:5432/shutdown_rehearsal" \
  -e REDIS_URL="redis://${redis}:6379" \
  -e QUEUE_NAME="synthetic-runtime-${suffix}" \
  -e S3_ENDPOINT=https://storage.invalid -e S3_REGION=us-east-1 \
  -e S3_BUCKET=synthetic-runtime-only \
  -e S3_ACCESS_KEY_ID=synthetic-runtime-only \
  -e S3_SECRET_ACCESS_KEY=synthetic-runtime-only \
  -e CLAMAV_HOST=clamav.invalid -e DRAFT_PROVIDER=disabled \
  -e WORKER_HEALTH_HOST=0.0.0.0 -e WORKER_HEALTH_PORT=4001 \
  "$image" >/dev/null
test "$(docker exec "$worker" cat /proc/1/comm)" = node
for attempt in {1..60}; do
  if docker exec "$worker" node -e 'fetch("http://127.0.0.1:4001/health").then(async r=>{const j=await r.json();if(r.status!==200||j.data.status!=="ok")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1 &&
    docker exec "$worker" node -e 'fetch("http://127.0.0.1:4001/ready").then(async r=>{const j=await r.json();if(r.status!==200||j.data.status!=="ready")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then break; fi
  if [[ $attempt -eq 60 ]]; then echo 'Worker health or readiness failed.' >&2; exit 1; fi
  sleep 2
done

stage=idle-sigterm
worker_ip=$(docker inspect "$worker" --format "{{(index .NetworkSettings.Networks \"$network\").IPAddress}}")
test -n "$worker_ip"
docker kill --signal=TERM "$worker" >/dev/null
idle_exit=$(timeout 90 docker wait "$worker")
idle_oom=$(docker inspect "$worker" --format '{{.State.OOMKilled}}')
test "$idle_exit" = 0 && test "$idle_oom" = false
pg_connections=$(docker exec "$postgres" psql -U postgres -d shutdown_rehearsal -Atqc \
  "SELECT count(*) FROM pg_stat_activity WHERE client_addr = '$worker_ip'::inet")
test "$pg_connections" = 0
redis_connections=$(docker exec "$redis" redis-cli CLIENT LIST | grep -c "addr=${worker_ip}:") || true
test "$redis_connections" = 0

stage=complete
