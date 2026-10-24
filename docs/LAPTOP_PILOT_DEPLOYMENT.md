# Laptop pilot staging backend

This is an invitation-only **engineering staging** configuration, not a public
production deployment. It runs the existing API, worker, Redis, and ClamAV images
on a Windows 11 laptop through Docker Desktop and WSL2. Neon staging PostgreSQL
and the private Cloudflare R2 staging bucket remain external. Vercel and Cloudflare
Tunnel are future integrations; this change does not deploy either one.

## Architecture and isolation

`docker-compose.laptop.yml` is an override of
`docker-compose.staging.yml`. Always pass both files, in that order, and use
`.env.staging`. The base Compose project is `tender-intelligence-staging`, so
its `redis_data` and `clamav_data` volumes are distinct from the development
project in `docker-compose.yml`. The staging `backend` network carries private
Redis, worker, and ClamAV traffic. The API also retains the staging `edge`
network, but the Caddy `edge` service is in the opt-in `vm-only` profile and
does not start in laptop mode. No local PostgreSQL, MinIO, tunnel, or frontend
container is included.

Only the API publishes a port: `127.0.0.1:4000:4000`. Its container may listen
on `0.0.0.0:4000`; the Windows host bind remains loopback-only. Redis (6379),
ClamAV (3310), worker readiness (4001), and metrics (4100/4101) are not
published. The base health checks, restart policies, bounded logs, resource
limits, and `no-new-privileges` settings remain in effect. Do not use
`--profile vm-only` for this laptop configuration: it would enable Caddy's
inherited 80/443 bindings.

## Prerequisites and environment

- Windows 11, Docker Desktop with the WSL2 backend, and a working Linux/x86_64
  Docker engine. The verified laptop offers 11.25 GiB to Docker; confirm current
  free memory and disk space before building. Check that host port 4000 is free.
- An already prepared **Neon staging** branch and private R2 staging bucket.
  Use only synthetic or explicitly approved non-sensitive documents in early
  tests. Do not connect a production database or copy development credentials.
- A separately generated staging Redis password, cookie secret, and scoped R2
  credentials. Store them only in the ignored `.env.staging` or an approved
  secret manager. Never pass them as Docker build arguments or include them in
  logs, screenshots, tickets, or commits.

If `.env.staging` does not exist, copy `.env.production.example` to it; never
overwrite an existing file. `.gitignore` ignores `.env` and `.env.*`, while
`.dockerignore` excludes them from image build contexts. Replace every template
placeholder before starting containers. Set `STAGING_ENV_FILE=.env.staging` and
an immutable `IMAGE_TAG` for the reviewed commit. The following requirements
are guidance for the private file, **not working credentials**:

| Setting                                                           | Required staging value                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                        | `production`; retain production validation and secure cookies.                                                                                                         |
| `DATABASE_URL`                                                    | Existing Neon **staging pooled** PostgreSQL URL for API and worker runtime. A direct URL is for separately controlled migration work only; do not run migrations here. |
| `REDIS_PASSWORD`, `REDIS_URL`                                     | Independently generated staging password; URL form `redis://:URL_ENCODED_PASSWORD@redis:6379`. The decoded password must equal the Redis container's `REDIS_PASSWORD`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`                           | Existing R2 account S3 API endpoint, `auto`, `tender-platform-staging`.                                                                                                |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Existing scoped R2 staging key and secret; `true` for path style.                                                                                                      |
| `API_HOST`, `API_PORT`, `QUEUE_NAME`                              | `0.0.0.0`, `4000`, `platform-jobs`. Host publication is still loopback-only.                                                                                           |
| `CLAMAV_HOST`, `CLAMAV_PORT`                                      | `clamav`, `3310`.                                                                                                                                                      |
| `SESSION_COOKIE_SECURE`, `COOKIE_SECRET`                          | `true`; a separate strong random secret of at least 32 characters.                                                                                                     |
| `WEB_APP_URL`, `WEB_ORIGIN`                                       | The same real HTTPS Vercel staging origin once provisioned.                                                                                                            |
| `API_PUBLIC_URL`, `API_PROXY_ORIGIN`                              | The approved HTTPS Cloudflare Tunnel API origin once provisioned.                                                                                                      |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STORAGE_ORIGIN`               | `/api`; the R2 S3 API origin, respectively.                                                                                                                            |
| `EMAIL_DELIVERY_URL`, `EMAIL_DELIVERY_TOKEN`, `EMAIL_FROM`        | A real approved transactional mail provider and sender, configured together. Production API startup rejects missing mail settings.                                     |

Keep `GEMINI_API_KEY` private if the existing Gemini features are enabled; never
hardcode it or fabricate mail or domain values. `TRUST_PROXY=true` is required
by current production-mode API validation, but it is safe for external traffic
only after the actual Cloudflare Tunnel forwarding path and header sanitization
are verified. Loopback binding alone is not authorization. Do not admit external
testers until the Vercel web origin, tunnel API origin, cookie/CSRF behavior,
proxy trust, email delivery, and access policy have passed manual checks.

## Safe validation before startup

Run from the repository root in PowerShell. These commands do not start
containers or run migrations. Compose may read secrets from `.env.staging`;
**never print or share the full resolved configuration**.

```powershell
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml config --quiet
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml config --services
```

The active service list should contain exactly `api`, `worker`, `redis`, and
`clamav`. To inspect the API port without displaying environment values:

```powershell
$config = docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml config --format json | ConvertFrom-Json
$config.services.api.ports | Select-Object host_ip,published,target
Remove-Variable config
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
```

Expect `127.0.0.1`, `4000`, `4000` for the API and no other published service
ports. If port 4000 is occupied, investigate and resolve it manually; do not
stop another process or change the published address silently. Verify that
`.env.staging` remains ignored with `git check-ignore .env.staging`; do not
display its contents. Validate the ignored file's values privately against
the production environment schema before startup.

## Build and operate after prerequisites are complete

Building images does not start services. Run only after the staging file has
real, approved settings and the Docker engine has adequate resources:

```powershell
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml build api worker clamav
```

Once the external services and security gates above are ready, start private
dependencies first, then the application:

```powershell
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml up -d --no-build redis clamav
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml ps
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml up -d --no-build api worker
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml ps
```

Wait for Redis and ClamAV to become healthy; ClamAV may need time to download
signatures. Check the API endpoints with PowerShell. `/ready` checks external
PostgreSQL, Redis, and R2. The worker's Compose health status checks its
`/ready` endpoint; the command below requests it explicitly:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:4000/health
Invoke-WebRequest -Uri http://127.0.0.1:4000/ready
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml exec -T worker node -e 'fetch("http://127.0.0.1:4001/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml exec -T clamav sh -c 'find /var/lib/clamav -maxdepth 1 -name "daily.*" -mmin -2880 -print -quit | grep -q .'
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml ps clamav redis
```

The ClamAV service health check verifies both a fresh `daily.*` signature file
and a daemon PING; a healthy worker alone does not prove scanner readiness.
Use `docker stats` and Docker Desktop's resource view to monitor memory and
CPU. For bounded logs, inspect one service at a time with
`docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml logs --tail 50 api`
and redact any unexpected sensitive content before sharing. Do not use
`config` without `--quiet` or a narrow field selection when secrets are loaded.

Stop without removing volumes or touching development containers:

```powershell
docker compose --env-file .env.staging -f docker-compose.staging.yml -f docker-compose.laptop.yml stop api worker redis clamav
```

Do not use `down -v`, `docker volume prune`, or destructive cleanup. The staging
project name distinguishes these containers and volumes from the development
Compose project; inspect the project name before any manual maintenance.

## Expected errors and remaining gates

- Template values, missing mail configuration, weak cookie secrets, insecure
  origin settings, or a mismatched Redis password will prevent production-mode
  readiness. Fix only in the ignored staging environment or approved secret
  manager; do not weaken validation.
- A busy host port 4000 prevents the API from publishing. An unhealthy Redis or
  ClamAV prevents dependent startup; absent or stale signatures must fail closed.
- A Neon direct URL is unsuitable for long-running runtime connections. R2
  CORS, path-style requests, private bucket policy, and signed URL behavior
  require live verification before browser use.
- The laptop's 11.25 GiB Docker allocation is an initial constraint. Measure
  actual memory, OCR performance, ClamAV loading, restart recovery, and 50-page
  PDF processing before admitting a pilot.
- Before Cloudflare Tunnel and Vercel integration, approve the exact HTTPS
  origins, protect tunnel access, verify forwarded-header handling and IP rate
  limits, configure R2 CORS and mail, and test secure host-only cookies, CSRF,
  login/logout, upload/download, worker progress, and two-tenant isolation.
  External testers need invitation-only access, synthetic or explicitly
  approved non-sensitive data, restricted operator logs, and a rollback plan.
  See [Phase 4A staging deployment](PHASE4A_STAGING_DEPLOYMENT.md) and
  [Security Model](SECURITY_MODEL.md) for the broader acceptance gates.
