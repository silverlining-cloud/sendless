# Security

## Reporting a vulnerability

Please email **support@silverlining.cloud** with a description and reproduction steps. Do not open a public issue. We aim to respond within 3 business days and to ship fixes for confirmed issues as a new release with a security advisory.

## Security model (summary)

- The API Lambda is reachable only through the stack's CloudFront distribution (function URL with `AWS_IAM` and origin access control, scoped to the distribution ARN).
- Files are stored privately in S3 (SSE-S3, TLS-only bucket policy) and transferred with short-lived presigned URLs: 1 hour for upload parts and 5 minutes for downloads.
- Link IDs carry 128 bits of randomness. Link passwords are hashed with scrypt on the server, and each link accepts at most 10 password attempts per 15 minutes. Attempts are counted atomically before the check, so parallel guessing gets no more tries.
- Opening a link is counted atomically in DynamoDB, so open limits cannot be raced.
- The web app sets a strict Content-Security-Policy and renders all user content as text.
- Expired files are deleted by the sweeper, with an S3 lifecycle rule as a hard upper bound (`MaxRetentionDays`).
- Logs never contain request bodies, passwords or tokens.
- Release artifacts are pinned by SHA-256 in the template and are reproducible from source.

See [docs/architecture.md](docs/architecture.md) for the full threat table.
