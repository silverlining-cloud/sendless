/**
 * Public keys that verify Sendless Pro license keys, by key ID (`kid` in the license header).
 *
 * The matching private keys never live in this repository. To create a signing key pair run
 * `npm run license:keygen`: it writes the private key to ~/.sendless/ and prints the entry to
 * paste here. Keep old keys in this list while licenses signed with them are still valid.
 */
export const LICENSE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  'sendless-2026-1': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAABANQcjRR20OqxGC+DLI8fU6DCSSSMSP+R9ihBLWZNc=
-----END PUBLIC KEY-----`,
};
