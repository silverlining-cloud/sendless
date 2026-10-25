import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoIdentityProviders } from '@s3ndless/ee/api';
import { CognitoAuthenticator, CognitoDirectory } from './adapters/cognito.js';
import { DynamoStore } from './adapters/dynamo-store.js';
import { disabledMailer, SesMailer } from './adapters/mailers.js';
import { S3BlobStore } from './adapters/s3-blobs.js';
import { createDeps } from './deps.js';
import { createLogger } from './log.js';
import type { Deps, Env } from './ports.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

let cached: Deps | undefined;

/** Dependencies for the Lambda functions, built once per container from environment variables. */
export function awsDeps(): Deps {
  if (cached) return cached;
  const region = required('AWS_REGION');
  const env: Env = {
    version: process.env.APP_VERSION ?? 'unknown',
    region,
    maxRetentionDays: Number(process.env.MAX_RETENTION_DAYS ?? '30'),
    malwareScanning: process.env.MALWARE_SCANNING === 'true',
    devMode: false,
  };
  const store = new DynamoStore(required('TABLE_NAME'));
  const cognito = new CognitoIdentityProviderClient({ region });
  const sender = process.env.SENDER_EMAIL;
  const system = () => deps.system();
  const deps: Deps = createDeps({
    env,
    store,
    blobs: new S3BlobStore(required('FILES_BUCKET'), region),
    directory: new CognitoDirectory(cognito, system),
    idp: new CognitoIdentityProviders(cognito, system),
    mailer: sender ? new SesMailer(sender, region) : disabledMailer,
    auth: new CognitoAuthenticator(system),
    log: createLogger({ version: env.version }),
  });
  cached = deps;
  return deps;
}
