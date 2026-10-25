import { emailDomain } from '@sendless/shared';

interface PreSignUpEvent {
  triggerSource: string;
  request: { userAttributes: Record<string, string | undefined> };
}

/** Cognito pre sign-up trigger: self sign-up is only allowed for the configured email domains. */
export async function handler<T extends PreSignUpEvent>(event: T): Promise<T> {
  // Admin invitations and SSO sign-ins are trusted.
  if (event.triggerSource === 'PreSignUp_AdminCreateUser' || event.triggerSource === 'PreSignUp_ExternalProvider') {
    return event;
  }
  const allowed = (process.env.ALLOWED_SIGNUP_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const email = event.request.userAttributes.email ?? '';
  if (!email || !allowed.includes(emailDomain(email))) {
    throw new Error('Sign-up is only available for approved email domains.');
  }
  return event;
}
