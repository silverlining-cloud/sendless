# Deploying Sendless

Sendless is one CloudFormation template. It creates everything it needs and removes everything when you delete the stack.

## Requirements

- An AWS account and permission to create IAM roles. The template needs the `CAPABILITY_IAM` acknowledgement.
- Any commercial AWS Region that offers Lambda function URLs, Cognito and GuardDuty Malware Protection for S3 (GuardDuty only if you enable scanning).

## Parameters

| Parameter | Default | Notes |
|---|---|---|
| `AdminEmail` | – | First administrator; receives a temporary password by email. |
| `MaxRetentionDays` | 30 | Hard upper limit for keeping files. Enforced by the app and by an S3 lifecycle rule (plus 2 days for uploads in progress). |
| `SenderEmail` | empty | An address or domain **verified in Amazon SES in the same Region**. Enables emailing links and notifications. While SES is in sandbox mode it can only send to verified addresses; [request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) for real use. |
| `SelfSignUpDomains` | empty | Comma-separated email domains whose users may register themselves. Empty means invite-only. |
| `CustomDomainName` / `CertificateArn` | empty | E.g. `files.example.com` with an ACM certificate **in us-east-1**, which CloudFront requires. Afterwards, create a CNAME to the `CloudFrontDomain` output. |
| `EnableMalwareScanning` | false | Pro. Creates a GuardDuty Malware Protection plan for the files bucket. GuardDuty bills per GB scanned. |
| `CloudFrontPriceClass` | PriceClass_100 | Edge locations used: North America and Europe by default. |
| `LogRetentionDays` | 30 | CloudWatch Logs retention for all functions. |
| `ArtifactBaseUrl` | release URL | Where `backend.zip` and `web.zip` are downloaded from. The template pins their SHA-256, so a mirror (e.g. your own bucket) must serve identical files. |

## What gets created

- **S3**: a files bucket (private, SSE-S3, TLS-only, lifecycle-limited), a web bucket (private, read by CloudFront through OAC) and an artifacts bucket.
- **CloudFront**: one distribution with a SPA routing function and a response-headers policy (CSP, HSTS, …).
- **Lambda**: API (function URL, `AWS_IAM` auth, callable only by this distribution), sweeper, setup and bootstrap custom resources, and optionally a pre-sign-up trigger and the GuardDuty scan-result handler. All arm64, Node.js 22, except the small inline Python bootstrap.
- **DynamoDB**: one on-demand table with point-in-time recovery and TTL.
- **Cognito**: user pool with managed login, an `admins` group and the first admin user.
- **EventBridge**: the 15-minute sweeper schedule (and the scan-result rule with malware scanning).
- **IAM**: one least-privilege role per function.

## After deployment

1. Open the `AppUrl` output and sign in with the admin email and the temporary password from the invitation email.
2. Under **Admin → Settings**, set your name and the privacy/imprint links.
3. Invite users under **Admin → Users**.
4. Pro: paste your license key under **Admin → License**, then set your logo, colors and texts under **Admin → Branding** and configure SSO and policies.

## Upgrading

Update the stack with the template of the new version. The bootstrap function fetches the new artifacts, verifies their checksums and the functions switch over. The setup function republishes the web app and re-applies SSO providers to the app client.

## Uninstalling

Delete the stack. The setup function empties the web and files buckets and the bootstrap function empties the artifacts bucket before CloudFormation removes them. DynamoDB data, logs and the user pool are deleted as well.

## Publishing your own release

```bash
npm ci
npm run release -- --base-url https://<bucket>.s3.amazonaws.com/sendless/v1.0.0
scripts/publish.sh <bucket> sendless/v1.0.0     # requires AWS credentials
```

The bucket must allow anonymous `s3:GetObject` on that prefix: CloudFormation reads the template from it, and the bootstrap function downloads the zips from it. `publish.sh` prints the quick-create link:

```
https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate?templateURL=<url-encoded template URL>&stackName=sendless
```

The artifacts can also live elsewhere, e.g. as GitHub release assets, as long as the URL is HTTPS. The template itself must be in S3 for a quick-create link.

Releases are reproducible: rebuilding the same commit produces byte-identical zips, so customers can verify `SHA256SUMS` themselves.

## Operations

- **Logs**: `/sendless/<stack>/api`, `/sweeper`, `/setup`, … Request bodies, passwords and tokens are never logged.
- **Costs**: pay-per-use only. With no traffic, the main costs are S3 storage of files that are still active and small amounts for DynamoDB and logs.
- **Region**: everything is created in the stack's Region. CloudFront is global, but it serves only the static app and proxies `/api/*`; files are downloaded directly from the regional S3 endpoint.
