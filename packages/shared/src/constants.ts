/** Header that carries the Cognito ID token. CloudFront OAC replaces `Authorization`. */
export const TOKEN_HEADER = 'x-sendless-token';

/** Header with the SHA-256 (hex) of the request body, required by CloudFront OAC for Lambda URLs. */
export const CONTENT_SHA256_HEADER = 'x-amz-content-sha256';

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;
export const TiB = 1024 * GiB;

/** S3 multipart limits. */
export const MIN_PART_SIZE = 8 * MiB;
export const MAX_PARTS = 10_000;
export const MAX_FILE_SIZE = 5 * TiB;

/** Hard caps that settings cannot exceed. */
export const MAX_FILES_PER_TRANSFER = 500;
export const MAX_PART_URLS_PER_CALL = 100;
export const MAX_RECIPIENTS = 50;

/** Recipient session after unlocking a transfer. */
export const SESSION_TTL_SECONDS = 3600;

/** Password attempts per link within one window, and the window length; further attempts wait for the next window. */
export const MAX_FAILED_UNLOCKS = 10;
export const LOCKOUT_SECONDS = 15 * 60;

/** Core minimum password length (Pro policies can raise it). */
export const MIN_PASSWORD_LENGTH = 4;

export const PRO_FEATURES = ['sso', 'malware-scanning', 'audit', 'policies', 'branding'] as const;
export type ProFeature = (typeof PRO_FEATURES)[number];

/** Product name; while an installation keeps it and has no logo of its own, the built-in logos are shown. */
export const DEFAULT_APP_NAME = 'Sendless';

/** Public home of the open-source code, linked from the Community Edition footer. */
export const SOURCE_URL = 'https://github.com/silverlining-cloud/sendless';
