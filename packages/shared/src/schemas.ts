import { z } from 'zod';
import {
  MAX_FILE_SIZE,
  MAX_FILES_PER_TRANSFER,
  MAX_PART_URLS_PER_CALL,
  MAX_PARTS,
  MAX_RECIPIENTS,
} from './constants.js';

const HOURS_PER_YEAR = 24 * 366;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #3F7DBF');
const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(2000)
  .nullable();

export const fileInput = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(MAX_FILE_SIZE),
  contentType: z.string().trim().max(255).default('application/octet-stream'),
});
export type FileInput = z.infer<typeof fileInput>;

export const createTransferInput = z.object({
  title: optionalText(200),
  message: optionalText(5000),
  files: z.array(fileInput).min(1).max(MAX_FILES_PER_TRANSFER),
  expiresInHours: z.number().int().min(1).max(HOURS_PER_YEAR),
  maxOpens: z.number().int().min(1).max(100_000).nullable(),
  password: z.string().max(256).optional(),
  recipients: z.array(z.email()).max(MAX_RECIPIENTS).default([]),
  notifyOnOpen: z.boolean().default(false),
});
export type CreateTransferInput = z.infer<typeof createTransferInput>;

export const unlockInput = z.object({
  password: z.string().max(256).optional(),
});

export const downloadInput = z.object({
  sessionId: z.string().min(16).max(100),
});

const uploadToken = z.string().min(16).max(100);

export const partUrlsInput = z.object({
  uploadToken,
  partNumbers: z.array(z.number().int().min(1).max(MAX_PARTS)).min(1).max(MAX_PART_URLS_PER_CALL),
});

export const completeFileInput = z.object({
  uploadToken,
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_PARTS),
        etag: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(MAX_PARTS),
});

export const uploadTokenInput = z.object({ uploadToken });

export const createRequestInput = z.object({
  title: z.string().trim().min(1).max(200),
  message: optionalText(5000),
  expiresInHours: z.number().int().min(1).max(HOURS_PER_YEAR),
  password: z.string().max(256).optional(),
  maxSubmissions: z.number().int().min(1).max(100_000).nullable(),
  maxBytesPerSubmission: z.number().int().min(1).nullable(),
  retentionHours: z.number().int().min(1).max(HOURS_PER_YEAR),
  notifyOnSubmission: z.boolean().default(true),
});
export type CreateRequestInput = z.infer<typeof createRequestInput>;

export const submissionInput = z.object({
  password: z.string().max(256).optional(),
  name: optionalText(200),
  email: z.email().optional(),
  message: optionalText(5000),
  files: z.array(fileInput).min(1).max(MAX_FILES_PER_TRANSFER),
});
export type SubmissionInput = z.infer<typeof submissionInput>;

export const brandingSchema = z.object({
  appName: z.string().trim().min(1).max(60),
  logoUrl: httpsUrl,
  primaryColor: hexColor,
  backgroundColor: hexColor,
  textColor: hexColor,
  welcomeTitle: z.string().trim().max(120).nullable(),
  welcomeText: z.string().trim().max(1000).nullable(),
  footerText: z.string().trim().max(500).nullable(),
  privacyUrl: httpsUrl,
  imprintUrl: httpsUrl,
});
export type Branding = z.infer<typeof brandingSchema>;

export const policiesSchema = z.object({
  requirePassword: z.boolean(),
  minPasswordLength: z.number().int().min(1).max(128),
  maxExpiresInHours: z.number().int().min(1).max(HOURS_PER_YEAR).nullable(),
  requireOpenLimit: z.boolean(),
  maxOpensLimit: z.number().int().min(1).max(100_000).nullable(),
  blockedExtensions: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,20}$/)).max(200),
  allowedRecipientDomains: z
    .array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
    .max(200),
  auditRetentionDays: z.number().int().min(1).max(3650),
  /** Malware scanning: allow downloading files GuardDuty could not scan (e.g. encrypted archives). */
  allowUnscannableFiles: z.boolean(),
});
export type Policies = z.infer<typeof policiesSchema>;

export const settingsSchema = z.object({
  branding: brandingSchema,
  defaults: z.object({
    expiresInHours: z.number().int().min(1).max(HOURS_PER_YEAR),
    maxOpens: z.number().int().min(1).max(100_000).nullable(),
  }),
  limits: z.object({
    maxTransferBytes: z.number().int().min(1).max(MAX_FILE_SIZE),
    maxFilesPerTransfer: z.number().int().min(1).max(MAX_FILES_PER_TRANSFER),
    allowUnlimitedOpens: z.boolean(),
  }),
  showSenderEmail: z.boolean(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const inviteUserInput = z.object({
  email: z.email(),
  admin: z.boolean().default(false),
});

export const updateUserInput = z
  .object({
    enabled: z.boolean().optional(),
    admin: z.boolean().optional(),
  })
  .refine((v) => v.enabled !== undefined || v.admin !== undefined, 'Nothing to update');

export const licenseInput = z.object({
  key: z.string().trim().max(20_000),
});

const emailDomains = z
  .array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/))
  .max(50)
  .default([]);

/** Cognito provider names: no spaces or underscores. Shown on the login button. */
const providerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/, 'Use 2–32 letters, digits or dashes');

export const ssoProviderInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('saml'),
    name: providerName,
    metadataUrl: z.url({ protocol: /^https$/ }),
    /** SAML attribute carrying the email address. Default works for Microsoft Entra ID. */
    emailAttribute: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .default('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'),
    emailDomains,
  }),
  z.object({
    type: z.literal('oidc'),
    name: providerName,
    issuer: z.url({ protocol: /^https$/ }),
    clientId: z.string().trim().min(1).max(500),
    clientSecret: z.string().trim().min(1).max(500),
    scopes: z.string().trim().max(500).default('openid email profile'),
    emailDomains,
  }),
]);
export type SsoProviderInput = z.infer<typeof ssoProviderInput>;
