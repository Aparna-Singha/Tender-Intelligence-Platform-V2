# BidVeda staging mail adapter

This Cloudflare Worker implements the API's existing server-to-server email contract. It accepts `POST /deliver` with a bearer token and sends one fixed BidVeda invitation or password-reset message through Resend. It does not store or log message content, links, credentials, or Resend responses.

## Configuration

The existing Worker is named `bidveda-mail-staging`. Keep its existing `RESEND_API_KEY` and `EMAIL_ADAPTER_TOKEN` secrets. Before deployment, add `ALLOWED_FRONTEND_ORIGIN` as a Worker secret in Cloudflare's dashboard. Its value must be the exact HTTPS origin of the staging web app, with no path or trailing slash. The Worker rejects delivery when any of these three settings is missing or invalid. Do not put secret values in `wrangler.jsonc`, this repository, or shell history.

The API should retain its existing notification contract and use:

- `EMAIL_DELIVERY_URL`: the deployed Worker's HTTPS URL followed by `/deliver`.
- `EMAIL_DELIVERY_TOKEN`: the same value as the Worker's `EMAIL_ADAPTER_TOKEN`.
- `EMAIL_FROM`: `notifications@send.bidveda.space`.

The only accepted links are HTTPS URLs at `ALLOWED_FRONTEND_ORIGIN` with exactly one `token` parameter, on `/accept-invitation` or `/reset-password` for the corresponding template. Tokens must use the API's 43-character base64url format.

The current web build includes `/accept-invitation` but has no `/reset-password` page. Add and verify that page in a separate frontend change before enabling password-reset delivery to users; this adapter deliberately does not change the frontend.

## Review and deploy

After the PR has been reviewed, from the repository root:

```powershell
pnpm exec tsc -p infrastructure/cloudflare/bidveda-mail-staging/tsconfig.json --noEmit
pnpm exec vitest run infrastructure/cloudflare/bidveda-mail-staging/test/index.test.ts
wrangler whoami
wrangler deploy --config infrastructure/cloudflare/bidveda-mail-staging/wrangler.jsonc
```

Use an approved Wrangler installation and verify the account and Worker name before deployment. The `wrangler deploy` command updates the existing `bidveda-mail-staging` Worker. This repository does not perform that deployment automatically. Keep the two existing Cloudflare secrets unchanged. Confirm all three secret names are present in the intended Cloudflare environment before deploying. Set the API values only after the Worker endpoint has been verified.

## Safe unauthorized smoke test

Set `$WorkerUrl` to the deployed Worker's HTTPS base URL, then run this request. It uses an intentionally invalid token and a body that cannot send mail. Expect HTTP 401 and an empty body; any other status needs investigation.

```powershell
$WorkerUrl = Read-Host 'Worker HTTPS base URL'
try {
  Invoke-WebRequest -Uri "$WorkerUrl/deliver" -Method Post -Headers @{ Authorization = 'Bearer intentionally-invalid'; 'Content-Type' = 'application/json' } -Body '{}' -ErrorAction Stop | Out-Null
  throw 'Unexpected success'
} catch {
  $status = [int]$_.Exception.Response.StatusCode
  if ($status -ne 401) { throw "Unexpected HTTP status: $status" }
  Write-Host 'PASS: unauthorized request rejected with HTTP 401'
}
```

Do not use a real invitation or reset link for smoke testing. An authorized live delivery test requires a separate, approved staging plan and a controlled recipient.
