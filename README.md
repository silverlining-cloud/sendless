# S3ndless

**Secure, serverless file transfer that runs in your own AWS account.**
Send files with expiring, password-protected links. Collect files from people who have no account.
No servers to run, nothing leaves your account, and one click to deploy.

- **Fully serverless.** CloudFront, Lambda, S3, DynamoDB and Cognito. Nothing to patch or scale, and close to zero cost when idle.
- **One-click deploy.** A single CloudFormation template that works in any commercial AWS Region, with no us-east-1 dependency and no Lambda@Edge.
- **Your data stays put.** Files, metadata and logs stay in the Region you deploy to. There is no phone-home, and the license check runs offline.
- **Recipients need no account.** Senders sign in with Cognito, or with your company login on Pro.

## Features

| | Community (Apache-2.0) | Pro |
|---|:---:|:---:|
| Send files with expiring links (time and/or number of opens) | ✓ | ✓ |
| Password protection with brute-force lockout | ✓ | ✓ |
| Large files: resumable multipart uploads straight to S3, up to 5 TB per file | ✓ | ✓ |
| **File requests**: let anyone upload files to you, without an account | ✓ | ✓ |
| Email the link and get notified on download (Amazon SES) | ✓ | ✓ |
| Activity log per transfer (who opened, which file, IP, country) | ✓ | ✓ |
| Branding: name, logo, colors, texts, privacy and imprint links | ✓ | ✓ |
| User management, invitations, optional self sign-up by email domain, MFA | ✓ | ✓ |
| Guaranteed deletion: sweeper plus an S3 lifecycle hard limit | ✓ | ✓ |
| English and German UI | ✓ | ✓ |
| **Single sign-on** (SAML / OIDC: Entra ID, Okta, Google, …) | | ✓ |
| **Malware scanning** with GuardDuty, downloads blocked until clean | | ✓ |
| **Audit log** for the whole installation with CSV export | | ✓ |
| **Policies**: mandatory passwords, maximum lifetime, blocked file types, allowed recipient domains | | ✓ |

## Deploy

1. Open the **Launch stack** link for the release you want, or create a stack from `s3ndless.yaml` in the CloudFormation console. Choose any Region.
2. Enter the **administrator email**. Everything else is optional: email sending, custom domain, self sign-up, malware scanning.
3. Wait about 5 minutes. The administrator receives a temporary password by email. Open the `AppUrl` from the stack outputs and sign in.

To remove S3ndless, delete the stack. The buckets are emptied first, so nothing is left behind.

See [docs/deployment.md](docs/deployment.md) for parameters, custom domains, email, upgrades and publishing your own release.

## How it works

```
Browser ──HTTPS──▶ CloudFront ─┬─▶ S3 (web app, via OAC)
   │                           └─▶ Lambda function URL (/api/*, via OAC + IAM)
   │                                  ├─ DynamoDB  (transfers, requests, audit)
   │                                  ├─ Cognito   (senders, admins, SSO)
   │                                  └─ SES       (optional email)
   └──presigned PUT/GET──▶ S3 (files, private, encrypted, lifecycle-limited)
EventBridge ──every 15 min──▶ sweeper Lambda (deletes expired files)
```

File bytes never pass through Lambda: browsers upload parts straight to S3 with presigned URLs and download the same way. The API function can only be reached through this CloudFront distribution. The full reasoning is in [docs/architecture.md](docs/architecture.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — runs the real API with in-memory adapters, no AWS account needed
npm run dev:pro    # same, with Pro features unlocked by a throwaway development license
npm test           # unit, service and store contract tests
npm run typecheck
npm run release -- --base-url https://<bucket>.s3.amazonaws.com/s3ndless/v1.0.0
```

Sign in locally as `admin@example.com` or `user@example.com` (no password in dev mode). See [docs/development.md](docs/development.md).

## Repository layout

```
template/s3ndless.yaml   CloudFormation template (the one-click deployable)
packages/shared          API types and validation shared by backend and frontend
packages/api             Lambda handlers, services, AWS and in-memory adapters, dev server
packages/web             React single-page app
ee/                      Pro features, under the S3ndless Enterprise License
scripts/                 dev, build, release, publish
docs/                    architecture, deployment, development, selling
```

## License

Everything outside `ee/` is licensed under the [Apache License 2.0](LICENSE).
The `ee/` directory contains the Pro features and is licensed under the [S3ndless Enterprise License](ee/LICENSE): you may read and modify it, but using Pro features in production requires a valid license key.

Copyright © 2026 SilverLining.Cloud GmbH.
