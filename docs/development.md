# Development

## Setup

Node.js 22 or newer.

```bash
npm install
npm run dev
```

`npm run dev` starts two processes:

- **API dev server** on port 8787 (`packages/api/src/dev/server.ts`). It runs the real router and services against in-memory adapters: `MemoryStore`, a local file store that emulates S3 presigned URLs, a seeded user directory and a console mailer. Data persists in `.dev-data/`; delete it to start over. Like CloudFront OAC, it rejects writes without a correct `x-amz-content-sha256` header, so client bugs show up locally.
- **Vite** on port 5173, proxying `/api` and `/__dev` to the API.

Sign in as `admin@example.com` (admin) or `user@example.com`. Dev mode needs no password.

`npm run dev:pro` additionally creates a throwaway signing key **in the dev server process** and installs a matching Pro license, so Pro screens can be developed without a real key. Production builds never trust that key.

## Tests

```bash
npm test                                                   # everything except the DynamoDB contract run
docker run --rm -p 8000:8000 amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory
DYNAMODB_ENDPOINT=http://localhost:8000 npm test           # also runs the store contract against DynamoDB Local
npm run typecheck
pip install cfn-lint && npm run lint:template
```

- `packages/api/src/services/*.test.ts`: end-to-end flows through the HTTP router (create → upload → unlock → download, limits, lockout, expiry, file requests).
- `packages/api/src/adapters/store.contract.test.ts`: the same contract for `MemoryStore` and `DynamoStore`. It caught a real DynamoDB-only bug, so run it when you touch the store.
- `ee/api/*.test.ts`: license verification and the Pro features, with a test signing key.

### End-to-end against a deployed stack

```bash
npm run e2e -- --stack s3ndless-test --region eu-central-1 [--keep]
```

`scripts/e2e.mjs` uses your AWS credentials to:
- create a temporary admin user and sign in with Cognito SRP
- check the edge setup: security headers, SPA routing, that the function URL is locked, that writes without a body hash are rejected
- upload real files to S3 (multipart), unlock and download them, and verify checksums
- wait for GuardDuty results if malware scanning is enabled, using the EICAR test string
- run a file request, trigger the sweeper, revoke a transfer, and exercise the admin endpoints

The test user is deleted at the end. With `--keep`, it leaves the user, one transfer and one file request for manual testing. Run it against every release before publishing.

## Code map

```
packages/shared/src     constants, zod schemas (request validation), API types
packages/api/src
  app.ts                routes and auth guards
  services/             transfers, requests, admin, config, sweeper, audit, notify, limits
  adapters/             dynamo-store, s3-blobs, cognito, mailers (AWS) · memory-store, local-blobs, dev (local)
  handlers/             Lambda entry points: api, sweeper, setup, pre-signup, scan-result
  runtime.ts            builds AWS dependencies from environment variables
  dev/server.ts         local dev server
packages/web/src
  api/client.ts         fetch wrapper (body hash, token header)
  auth/                 Cognito managed login via oidc-client-ts, or dev sign-in
  upload/engine.ts      multipart upload engine (parallel parts, retries, URL refresh)
  pages/                send, transfers, requests, public download/upload, admin
ee/api                  license, policies, malware, SSO, Pro routes
ee/web                  audit, policies and SSO admin screens
template/s3ndless.yaml  CloudFormation
```

## Conventions

- Validate every request body with the zod schema from `@s3ndless/shared`, and keep limits in one place (`services/limits.ts`).
- Never log request bodies, passwords, tokens or upload tokens. The logger redacts sensitive-looking keys as a safety net.
- Errors that reach users are `HttpError`s with a stable `code` the web app can react to.
- New UI strings go into `i18n/en.ts` **and** `i18n/de.ts`; the type checker enforces that German has every key.
- Code under `ee/` is Pro and under the Enterprise License. Core code may call into it, but `ee/` must only import leaf modules of the core (`@s3ndless/api/http`, `/ports`, `/model`, `/settings`, `/audit`, `@s3ndless/web/*`).

## License keys (vendor)

```bash
npm run license:keygen                      # once: writes ~/.s3ndless/<kid>.private.pem, prints the public key
#   → add the printed entry to ee/api/keys.ts and release
npm run license:issue -- --kid s3ndless-2026-1 --licensee "Acme GmbH" --days 365
```

Keep the private key out of the repository (it is git-ignored) and back it up.
