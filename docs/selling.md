# Selling Sendless Pro

How the open core, the license key and AWS Marketplace fit together.

## The model

- **Community** (Apache-2.0) is the whole product for small teams. It is the trust and discovery engine: GitHub, the one-click template, reproducible releases.
- **Pro** (Enterprise License, `ee/`) adds what compliance buyers pay for: SSO, malware scanning, an exportable audit log and policies. It also adds branding (logo, colors, texts), which will later include branded emails and a branded sign-in page.
- Both run from **the same template and artifacts**. Pro is unlocked at runtime by pasting a license key into **Admin → License**. There is no separate build and no phone-home.

## License keys

A license key is a compact JWS signed with Ed25519:

```
base64url({"alg":"EdDSA","typ":"SENDLESS-LICENSE","kid":"sendless-2026-1"})
. base64url({"iss":"sendless","lid":"…","licensee":"Acme GmbH","edition":"pro","features":["sso",…],"iat":…,"exp":…})
. base64url(signature)
```

- The app verifies it offline against the public keys in `ee/api/keys.ts`.
- After `exp` there is a 14-day grace period with a warning. After that, Pro features switch off, but nothing is deleted, and SSO providers that are already configured keep working in Cognito.
- Issue keys with `npm run license:issue`, or from the registration service described below. Never commit the private key.

## AWS Marketplace (SaaS contract listing)

AWS Marketplace has no delivery type for "customer deploys a CloudFormation template without an AMI", which is why the listing uses the SaaS contract model. The fulfilment flow:

1. A buyer subscribes, and AWS redirects them to your **registration URL** with an `x-amzn-marketplace-token`.
2. Your registration service (a small separate serverless stack in *your* account) calls `ResolveCustomer` and `GetEntitlements`, issues a license key with the entitled features and term, and shows it with the one-click launch link.
3. On renewals and cancellations (SNS notifications from Marketplace), issue a new key or let the old one expire.

The registration service is intentionally **not** part of this repository: it holds your signing key and handles Marketplace credentials.

## Pricing guidance

Price flat per deployment, not per user; that is the advantage over per-seat SaaS. Keep Community free, and sell Pro through public pricing plus private offers, including channel partner private offers. With the "Deployed on AWS" badge, buyers can pay from their AWS commitment.
