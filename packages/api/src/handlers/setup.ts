import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { reconcileSsoProviders } from '@sendless/ee/api';
import { unzipSync } from 'fflate';
import { awsDeps } from '../runtime.js';

/**
 * CloudFormation custom resource that runs after all other resources exist:
 *  - Create/Update: publishes the web app to the web bucket, stores the deploy-time
 *    configuration (user pool, app URL, …) in DynamoDB, and re-applies Pro SSO providers
 *    to the app client in case the template update reset them.
 *  - Delete: empties the web and files buckets so the stack can be removed cleanly.
 * The physical ID is stable, so updates never trigger a Delete of the "old" resource.
 */

interface SetupProperties {
  ArtifactsBucket: string;
  WebArtifactKey: string;
  WebBucket: string;
  FilesBucket: string;
  AppUrl: string;
  UserPoolId: string;
  ClientId: string;
  CognitoDomain: string;
  SelfSignUp: string;
}

interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: SetupProperties & { ServiceToken: string };
}

const PHYSICAL_ID = 'sendless-setup';

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json',
};

function cacheControl(path: string): string {
  if (path === 'index.html') return 'no-cache';
  if (path.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=300';
}

async function deployWebApp(s3: S3Client, props: SetupProperties): Promise<number> {
  const archive = await s3.send(new GetObjectCommand({ Bucket: props.ArtifactsBucket, Key: props.WebArtifactKey }));
  const files = unzipSync(await archive.Body!.transformToByteArray());
  const entries = Object.entries(files).filter(([name]) => !name.endsWith('/'));
  // index.html last, so it never references assets that are not uploaded yet.
  entries.sort(([a], [b]) => Number(a === 'index.html') - Number(b === 'index.html'));
  for (const [name, body] of entries) {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    await s3.send(
      new PutObjectCommand({
        Bucket: props.WebBucket,
        Key: name,
        Body: body,
        ContentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
        CacheControl: cacheControl(name),
      }),
    );
  }
  return entries.length;
}

async function emptyBucket(s3: S3Client, bucket: string): Promise<void> {
  let uploads;
  do {
    uploads = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
    for (const u of uploads.Uploads ?? []) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key!, UploadId: u.UploadId! }));
    }
  } while (uploads.IsTruncated);

  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
    token = page.NextContinuationToken;
  } while (token);
}

async function respond(event: CustomResourceEvent, status: 'SUCCESS' | 'FAILED', reason?: string) {
  const body = JSON.stringify({
    Status: status,
    Reason: reason?.slice(0, 500) ?? 'See CloudWatch Logs for details',
    PhysicalResourceId: event.PhysicalResourceId ?? PHYSICAL_ID,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  });
  const response = await fetch(event.ResponseURL, { method: 'PUT', headers: { 'content-type': '' }, body });
  if (!response.ok) throw new Error(`CloudFormation response failed: ${response.status}`);
}

export async function handler(event: CustomResourceEvent) {
  const deps = awsDeps();
  const props = event.ResourceProperties;
  const s3 = new S3Client({ region: deps.env.region });
  try {
    if (event.RequestType === 'Delete') {
      await emptyBucket(s3, props.WebBucket);
      await emptyBucket(s3, props.FilesBucket);
      deps.log.info('buckets emptied');
    } else {
      const config = {
        appUrl: props.AppUrl.replace(/\/$/, ''),
        userPoolId: props.UserPoolId,
        clientId: props.ClientId,
        cognitoDomain: props.CognitoDomain,
        selfSignUp: props.SelfSignUp === 'true',
      };
      await deps.store.putSystemConfig(config);
      const count = await deployWebApp(s3, props);
      deps.log.info('web app deployed', { files: count, appUrl: config.appUrl });
      await reconcileSsoProviders(deps).catch((error) => deps.log.error('SSO reconcile failed', { error }));
    }
    await respond(event, 'SUCCESS');
  } catch (error) {
    deps.log.error('setup failed', { requestType: event.RequestType, error });
    // A failed cleanup must not wedge stack deletion; CloudFormation will report the non-empty bucket instead.
    await respond(event, event.RequestType === 'Delete' ? 'SUCCESS' : 'FAILED', (error as Error).message);
  }
}
