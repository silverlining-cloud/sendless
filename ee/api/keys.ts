/**
 * Public keys that verify S3ndless Pro license keys, by key ID (`kid` in the license header).
 *
 * The matching private keys never live in this repository. To create a signing key pair run
 * `npm run license:keygen`: it writes the private key to ~/.s3ndless/ and prints the entry to
 * paste here. Keep old keys in this list while licenses signed with them are still valid.
 */
export const LICENSE_PUBLIC_KEYS: Readonly<Record<string, string>> = {};
