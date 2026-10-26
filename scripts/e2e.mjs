// End-to-end test against a deployed Sendless stack.
//
//   node scripts/e2e.mjs --stack sendless-test --region eu-central-1 [--keep]
//
// Needs AWS credentials for the stack's account. Creates a temporary admin user (deleted at the end
// unless --keep), signs in with Cognito SRP, and exercises the API, S3 uploads/downloads, malware
// scanning (if enabled), file requests, the sweeper and admin endpoints. With --keep it leaves one
// password-protected transfer and one file request for manual or browser testing.
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { CloudFormationClient, DescribeStackResourcesCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetFunctionUrlConfigCommand, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import cognito from 'amazon-cognito-identity-js';

const { values: args } = parseArgs({
  options: { stack: { type: 'string' }, region: { type: 'string' }, keep: { type: 'boolean', default: false } },
});
if (!args.stack || !args.region) {
  console.error('Usage: node scripts/e2e.mjs --stack <name> --region <region> [--keep]');
  process.exit(2);
}
const region = args.region;
const cfn = new CloudFormationClient({ region });
const idp = new CognitoIdentityProviderClient({ region });
const lambda = new LambdaClient({ region });
const s3 = new S3Client({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// ---------- helpers ----------
const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: args.stack }));
const outputs = Object.fromEntries(Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]));
const { StackResources } = await cfn.send(new DescribeStackResourcesCommand({ StackName: args.stack }));
const physical = Object.fromEntries(StackResources.map((r) => [r.LogicalResourceId, r.PhysicalResourceId]));
const appUrl = outputs.AppUrl;
const malwareScanning = Boolean(physical.MalwareProtectionPlan);
console.log(`Sendless e2e — ${appUrl} (version ${outputs.Version}, ${region}, malware scanning ${malwareScanning ? 'on' : 'off'})\n`);

let token = null;
async function call(method, path, body, { auth = true, raw = false } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = { 'content-type': 'application/json' };
  if (method !== 'GET') headers['x-amz-content-sha256'] = sha256(payload ?? '');
  if (auth && token) headers['x-sendless-token'] = token;
  const res = await fetch(`${appUrl}${path}`, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Does what the browser upload engine does: presign parts, PUT them, complete, finalize. */
async function upload(plan, contents) {
  for (const [i, file] of plan.files.entries()) {
    const numbers = Array.from({ length: file.partCount }, (_, n) => n + 1);
    const presigned = await call('POST', `/api/public/uploads/${plan.transferId}/files/${file.id}/parts`, { uploadToken: plan.uploadToken, partNumbers: numbers }, { auth: false });
    assert(presigned.status === 200, `presign failed: ${presigned.status}`);
    const parts = [];
    for (const p of presigned.json.parts) {
      const start = (p.partNumber - 1) * file.partSize;
      const res = await fetch(p.url, { method: 'PUT', body: contents[i].subarray(start, start + file.partSize) });
      assert(res.ok, `S3 PUT part ${p.partNumber} failed: ${res.status} ${await res.text()}`);
      parts.push({ partNumber: p.partNumber, etag: res.headers.get('etag') });
    }
    const done = await call('POST', `/api/public/uploads/${plan.transferId}/files/${file.id}/complete`, { uploadToken: plan.uploadToken, parts }, { auth: false });
    assert(done.status === 204, `complete failed: ${done.status} ${JSON.stringify(done.json)}`);
  }
  const final = await call('POST', `/api/public/uploads/${plan.transferId}/finalize`, { uploadToken: plan.uploadToken }, { auth: false });
  assert(final.status === 200, `finalize failed: ${final.status} ${JSON.stringify(final.json)}`);
  return final.json;
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: physical.FilesBucket, Key: key }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

// ---------- test users ----------
const newPassword = () => `E2e-${randomBytes(12).toString('base64url')}-a1A`;

async function createUser(address, pass, admin) {
  await idp.send(
    new AdminCreateUserCommand({
      UserPoolId: physical.UserPool,
      Username: address,
      MessageAction: 'SUPPRESS',
      TemporaryPassword: pass,
      UserAttributes: [
        { Name: 'email', Value: address },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  await idp.send(new AdminSetUserPasswordCommand({ UserPoolId: physical.UserPool, Username: address, Password: pass, Permanent: true }));
  if (admin) await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: physical.UserPool, Username: address, GroupName: 'admins' }));
}

function signIn(address = email, pass = password) {
  const pool = new cognito.CognitoUserPool({ UserPoolId: physical.UserPool, ClientId: physical.UserPoolClient });
  const user = new cognito.CognitoUser({ Username: address, Pool: pool });
  return new Promise((resolve, reject) =>
    user.authenticateUser(new cognito.AuthenticationDetails({ Username: address, Password: pass }), {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: reject,
    }),
  );
}

const email = `e2e-${randomBytes(4).toString('hex')}@example.com`;
const password = newPassword();
await createUser(email, password, true);

// EICAR anti-virus test string, assembled at runtime so this file itself never looks like malware.
const eicar = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''));

const kept = {};
try {
  console.log('Web and edge');
  await check('web app served with security headers', async () => {
    const res = await fetch(`${appUrl}/`);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert(res.status === 200 && (await res.text()).includes('<div id="root">'), `status ${res.status}`);
    assert(csp.includes(`https://${physical.FilesBucket}.s3.${region}.amazonaws.com`), 'CSP lacks the files bucket');
    assert(res.headers.get('strict-transport-security'), 'no HSTS');
    assert(res.headers.get('x-frame-options') === 'DENY', 'no X-Frame-Options');
    return `CSP ${csp.length} chars`;
  });
  await check('client-side routes fall back to index.html', async () => {
    const res = await fetch(`${appUrl}/transfers/some-id`);
    assert(res.status === 200 && res.headers.get('content-type')?.includes('text/html'), `status ${res.status}`);
  });
  await check('public config comes from the setup custom resource', async () => {
    const res = await call('GET', '/api/public/config', undefined, { auth: false });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json.auth.userPoolId === physical.UserPool, 'wrong user pool');
    assert(res.json.version === outputs.Version, 'wrong version');
    return `edition ${res.json.edition}, domain ${res.json.auth.domain}`;
  });
  await check('the Lambda function URL is not reachable directly', async () => {
    const { FunctionUrl } = await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: physical.ApiFunction }));
    const res = await fetch(`${FunctionUrl}api/public/config`);
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });
  await check('writes without a body hash are rejected by CloudFront/Lambda', async () => {
    const res = await fetch(`${appUrl}/api/public/transfers/x/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert(res.status === 403, `expected 403, got ${res.status}`);
  });
  await check('private routes require sign-in', async () => {
    const res = await call('GET', '/api/transfers', undefined, { auth: false });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  console.log('\nSign-in');
  await check('Cognito SRP sign-in and token verification', async () => {
    token = await signIn();
    const me = await call('GET', '/api/me');
    assert(me.status === 200 && me.json.isAdmin && me.json.email === email, JSON.stringify(me.json));
    return email;
  });

  console.log('\nTransfers');
  const big = randomBytes(20 * 1024 * 1024 + 12345);
  const small = Buffer.from('Hello from the Sendless end-to-end test.\n'.repeat(100));
  let transfer;
  await check('create transfer and upload 3 files directly to S3 (multipart)', async () => {
    const files = [
      { name: 'Präsentation "Q4".bin', size: big.length, contentType: 'application/octet-stream' },
      { name: 'notes.txt', size: small.length, contentType: 'text/plain' },
      { name: 'eicar.com', size: eicar.length, contentType: 'application/octet-stream' },
    ];
    const created = await call('POST', '/api/transfers', { title: 'E2E transfer', files, expiresInHours: 24, maxOpens: 3, password: 'e2e-secret-1' });
    assert(created.status === 201, `create failed: ${created.status} ${JSON.stringify(created.json)}`);
    const finalized = await upload(created.json.upload, [big, small, eicar]);
    transfer = { id: created.json.upload.transferId, files: created.json.upload.files, url: finalized.url };
    return `${created.json.upload.files[0].partCount} parts for the large file`;
  });
  await check('recipient: wrong password is refused', async () => {
    const res = await call('POST', `/api/public/transfers/${transfer.id}/unlock`, { password: 'nope' }, { auth: false });
    assert(res.status === 401 && res.json.error.code === 'wrong_password', `got ${res.status}`);
  });
  let session;
  await check('recipient: unlock with password counts one open', async () => {
    const res = await call('POST', `/api/public/transfers/${transfer.id}/unlock`, { password: 'e2e-secret-1' }, { auth: false });
    assert(res.status === 200 && res.json.files.length === 3, `got ${res.status}`);
    session = res.json.sessionId;
    const meta = await call('GET', `/api/public/transfers/${transfer.id}`, undefined, { auth: false });
    assert(meta.json.opensLeft === 2, `opensLeft ${meta.json.opensLeft}`);
  });
  await check('recipient: download from S3 is byte-identical with the right filename', async () => {
    const dl = await call('POST', `/api/public/transfers/${transfer.id}/files/${transfer.files[0].id}/download`, { sessionId: session }, { auth: false });
    assert(dl.status === 200, `presign failed: ${dl.status} ${JSON.stringify(dl.json)}`);
    const res = await fetch(dl.json.url);
    const body = Buffer.from(await res.arrayBuffer());
    assert(sha256(body) === sha256(big), 'content differs');
    const disposition = res.headers.get('content-disposition');
    assert(disposition.includes(`filename*=UTF-8''Pr%C3%A4sentation%20%22Q4%22.bin`), disposition);
    return `${(body.length / 1048576).toFixed(1)} MiB`;
  });

  if (malwareScanning) {
    await check('GuardDuty scans uploads: clean files marked clean, EICAR deleted', async () => {
      const deadline = Date.now() + 5 * 60_000;
      let files;
      while (Date.now() < deadline) {
        files = (await call('GET', `/api/transfers/${transfer.id}`)).json.files;
        if (files.every((f) => f.scan && f.scan !== 'pending')) break;
        await sleep(10_000);
      }
      const byName = Object.fromEntries(files.map((f) => [f.name, f.scan]));
      assert(byName['eicar.com'] === 'infected', `eicar: ${byName['eicar.com']}`);
      assert(byName['notes.txt'] === 'clean', `notes: ${byName['notes.txt']}`);
      const eicarFile = transfer.files[2];
      assert(!(await objectExists(`files/${transfer.id}/${eicarFile.id}`)), 'infected object still in S3');
      return JSON.stringify(byName);
    });
  }

  console.log('\nFile requests');
  let request;
  await check('create a file request and receive a submission from an outsider', async () => {
    const created = await call('POST', '/api/requests', {
      title: 'E2E request',
      expiresInHours: 24,
      maxSubmissions: 5,
      maxBytesPerSubmission: 10_000_000,
      retentionHours: 24,
      notifyOnSubmission: false,
    });
    assert(created.status === 201, `create failed ${created.status} ${JSON.stringify(created.json)}`);
    request = created.json;
    const pub = await call('GET', `/api/public/requests/${request.id}`, undefined, { auth: false });
    assert(pub.status === 200 && pub.json.title === 'E2E request', `public get ${pub.status}`);
    const sub = await call('POST', `/api/public/requests/${request.id}/submissions`, { name: 'E2E Outsider', files: [{ name: 'receipt.txt', size: small.length }] }, { auth: false });
    assert(sub.status === 201, `submit ${sub.status} ${JSON.stringify(sub.json)}`);
    await upload(sub.json.upload, [small]);
    const detail = await call('GET', `/api/requests/${request.id}`);
    assert(detail.json.transfers.length === 1 && detail.json.submissions === 1, JSON.stringify(detail.json));
    const inbound = detail.json.transfers[0];
    const fileId = (await call('GET', `/api/transfers/${inbound.id}`)).json.files[0].id;
    // Without a Pro license, scan results are recorded but downloads are not held back.
    const dl = await call('POST', `/api/transfers/${inbound.id}/files/${fileId}/download`);
    assert(dl.status === 200, `owner download ${dl.status} ${JSON.stringify(dl.json)}`);
    assert(sha256(Buffer.from(await (await fetch(dl.json.url)).arrayBuffer())) === sha256(small), 'content differs');
  });

  console.log('\nLifecycle');
  await check('sweeper deletes expired transfers', async () => {
    const created = await call('POST', '/api/transfers', { files: [{ name: 'short-lived.txt', size: small.length }], expiresInHours: 1, maxOpens: null });
    await upload(created.json.upload, [small]);
    const id = created.json.upload.transferId;
    const key = `files/${id}/${created.json.upload.files[0].id}`;
    assert(await objectExists(key), 'object missing before sweep');
    // Pretend the hour is over.
    await ddb.send(
      new UpdateCommand({
        TableName: physical.Table,
        Key: { PK: `TRANSFER#${id}`, SK: 'META' },
        UpdateExpression: 'SET deleteAfter = :t, expiresAt = :t, GSI3SK = :g',
        ExpressionAttributeValues: { ':t': Date.now() - 1000, ':g': `${String(Date.now() - 1000).padStart(15, '0')}#T#${id}` },
      }),
    );
    const res = await lambda.send(new InvokeCommand({ FunctionName: physical.SweeperFunction }));
    const payload = JSON.parse(Buffer.from(res.Payload).toString());
    assert(!res.FunctionError, `sweeper error: ${JSON.stringify(payload)}`);
    assert(payload.transfers >= 1 && payload.errors === 0, JSON.stringify(payload));
    assert(!(await objectExists(key)), 'object still exists after sweep');
    const detail = await call('GET', `/api/transfers/${id}`);
    assert(detail.json.status === 'expired', detail.json.status);
    return JSON.stringify(payload);
  });
  await check('revoking a transfer deletes its files immediately', async () => {
    const res = await call('DELETE', `/api/transfers/${transfer.id}`);
    assert(res.status === 204, `status ${res.status}`);
    assert(!(await objectExists(`files/${transfer.id}/${transfer.files[0].id}`)), 'object still exists');
    const pub = await call('GET', `/api/public/transfers/${transfer.id}`, undefined, { auth: false });
    assert(pub.status === 410, `public status ${pub.status}`);
  });

  console.log('\nAdmin');
  await check('settings round-trip and show up in the public config', async () => {
    const current = (await call('GET', '/api/admin/settings')).json;
    assert(current.system.region === region, current.system.region);
    const privacyUrl = 'https://example.com/sendless-e2e-privacy';
    const updated = await call('PUT', '/api/admin/settings', { ...current.settings, branding: { ...current.settings.branding, privacyUrl } });
    assert(updated.status === 200, `put ${updated.status} ${JSON.stringify(updated.json)}`);
    await sleep(11_000); // settings are cached for 10 s per Lambda container
    const config = await call('GET', '/api/public/config', undefined, { auth: false });
    assert(config.json.branding.privacyUrl === privacyUrl, config.json.branding.privacyUrl);
    await call('PUT', '/api/admin/settings', current.settings);
  });
  await check('user directory lists Cognito users', async () => {
    const res = await call('GET', '/api/admin/users');
    assert(res.status === 200 && res.json.items.some((u) => u.email === email && u.isAdmin), JSON.stringify(res.json).slice(0, 200));
    return `${res.json.items.length} users`;
  });
  await check('deleting a user closes their links and deletes their files', async () => {
    const memberEmail = `e2e-member-${randomBytes(4).toString('hex')}@example.com`;
    const memberPassword = newPassword();
    await createUser(memberEmail, memberPassword, false);
    const adminToken = token;
    token = await signIn(memberEmail, memberPassword);
    const created = await call('POST', '/api/transfers', { files: [{ name: 'member.txt', size: small.length }], expiresInHours: 24, maxOpens: null });
    const { url } = await upload(created.json.upload, [small]);
    const transferId = created.json.upload.transferId;
    const key = `files/${transferId}/${created.json.upload.files[0].id}`;
    const request = await call('POST', '/api/requests', {
      title: 'Member request',
      expiresInHours: 24,
      maxSubmissions: null,
      maxBytesPerSubmission: null,
      retentionHours: 24,
      notifyOnSubmission: false,
    });
    assert(url && request.status === 201 && (await objectExists(key)), 'setup failed');
    token = adminToken;

    const member = (await call('GET', '/api/admin/users')).json.items.find((u) => u.email === memberEmail);
    const deleted = await call('DELETE', `/api/admin/users/${encodeURIComponent(member.username)}`);
    assert(deleted.status === 204, `delete ${deleted.status} ${JSON.stringify(deleted.json)}`);
    assert((await call('GET', `/api/public/transfers/${transferId}`, undefined, { auth: false })).status === 410, 'transfer still open');
    assert((await call('GET', `/api/public/requests/${request.json.id}`, undefined, { auth: false })).status === 410, 'request still open');
    assert(!(await objectExists(key)), 'member file still in S3');
  });
  await check('Pro endpoints are gated without a license', async () => {
    const res = await call('GET', '/api/admin/audit');
    assert(res.status === 403 && res.json.error.code === 'pro_required', `status ${res.status}`);
  });

  if (args.keep) {
    const created = await call('POST', '/api/transfers', { title: 'Browser test', files: [{ name: 'hello.txt', size: small.length }], expiresInHours: 24, maxOpens: 5 });
    kept.transfer = (await upload(created.json.upload, [small])).url;
    kept.request = request.url;
  }
} finally {
  if (!args.keep) await idp.send(new AdminDeleteUserCommand({ UserPoolId: physical.UserPool, Username: email })).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (args.keep) console.log(`Kept for manual testing: transfer ${kept.transfer}, request ${kept.request}, user ${email}`);
process.exit(failed.length ? 1 : 0);
