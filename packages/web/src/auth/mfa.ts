/**
 * Two-factor authentication with an authenticator app (TOTP). Users manage it themselves through
 * Cognito's self-service API, with their access token (scope aws.cognito.signin.user.admin); Cognito's
 * sign-in page then asks for the code. In local development a stand-in checks real codes in the browser.
 */
export interface MfaClient {
  /** Whether sign-in asks for a code. */
  enabled(): Promise<boolean>;
  /** Starts the setup and returns the shared key (base32) for the authenticator app. */
  begin(): Promise<string>;
  /** Checks a code from the app and turns two-factor authentication on. */
  confirm(code: string): Promise<void>;
  disable(): Promise<void>;
}

export class MfaError extends Error {
  constructor(
    message: string,
    readonly code: 'wrong_code' | 'sign_in_again' | 'failed',
  ) {
    super(message);
  }
}

export function cognitoMfa(region: string, accessToken: () => Promise<string | null>): MfaClient {
  async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    const token = await accessToken();
    if (!token) throw new MfaError('Not signed in', 'sign_in_again');
    const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify({ AccessToken: token, ...body }),
    });
    const json = (await res.json().catch(() => ({}))) as { __type?: string; message?: string };
    if (!res.ok) {
      const type = (json.__type ?? '').split('#').pop() ?? '';
      const message = json.message ?? type;
      if (type === 'CodeMismatchException' || type === 'EnableSoftwareTokenMFAException') throw new MfaError(message, 'wrong_code');
      // Also what sessions from before this feature get: their token lacks the self-service scope.
      if (type === 'NotAuthorizedException') throw new MfaError(message, 'sign_in_again');
      throw new MfaError(message, 'failed');
    }
    return json as T;
  }

  return {
    async enabled() {
      const user = await call<{ UserMFASettingList?: string[] }>('GetUser');
      return (user.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA');
    },
    async begin() {
      return (await call<{ SecretCode: string }>('AssociateSoftwareToken')).SecretCode;
    },
    async confirm(code) {
      const result = await call<{ Status?: string }>('VerifySoftwareToken', { UserCode: code, FriendlyDeviceName: 'Sendless' });
      if (result.Status !== 'SUCCESS') throw new MfaError('Code mismatch', 'wrong_code');
      await call('SetUserMFAPreference', { SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
    },
    async disable() {
      await call('SetUserMFAPreference', { SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } });
    },
  };
}

// ---------- local development ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** RFC 6238 code for a 30-second step. */
export async function totp(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new DataView(new ArrayBuffer(8));
  counter.setUint32(4, step);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter.buffer));
  const offset = mac[19]! & 0x0f;
  const number = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(number % 1_000_000).padStart(6, '0');
}

export function devMfa(email: string): MfaClient {
  const key = `sendless.devMfa.${email}`;
  let pending: string | null = null;
  return {
    async enabled() {
      return sessionStorage.getItem(key) !== null;
    },
    async begin() {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      pending = Array.from(bytes, (b) => BASE32[b % 32]).join('');
      return pending;
    },
    async confirm(code) {
      const step = Math.floor(Date.now() / 30_000);
      const valid = pending && (await Promise.all([step - 1, step, step + 1].map((s) => totp(pending!, s)))).includes(code);
      if (!valid) throw new MfaError('Code mismatch', 'wrong_code');
      sessionStorage.setItem(key, pending!);
      pending = null;
    },
    async disable() {
      sessionStorage.removeItem(key);
    },
  };
}
