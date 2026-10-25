import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UserNotFoundException,
  UsernameExistsException,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { UserInfo } from '@sendless/shared';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { conflict } from '../http.js';
import type { SystemConfig } from '../model.js';
import type { Authenticator, Directory, Principal } from '../ports.js';

export const ADMIN_GROUP = 'admins';

type Verifier = ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; clientId: string; tokenUse: 'id' }>>;

/** Verifies Cognito ID tokens (signature, issuer, audience, expiry) against the pool's JWKS. */
export class CognitoAuthenticator implements Authenticator {
  private verifier: Verifier | null = null;

  constructor(private readonly system: () => Promise<SystemConfig>) {}

  async authenticate(token: string): Promise<Principal | null> {
    const { userPoolId, clientId } = await this.system();
    this.verifier ??= CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    try {
      const claims = await this.verifier.verify(token);
      const groups = (claims['cognito:groups'] as string[] | undefined) ?? [];
      const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
      if (!email) return null;
      return {
        sub: claims.sub,
        username: String(claims['cognito:username'] ?? claims.sub),
        email,
        isAdmin: groups.includes(ADMIN_GROUP),
      };
    } catch {
      return null;
    }
  }
}

function attribute(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((a) => a.Name === name)?.Value;
}

export class CognitoDirectory implements Directory {
  constructor(
    private readonly cognito: CognitoIdentityProviderClient,
    private readonly system: () => Promise<SystemConfig>,
  ) {}

  private async pool() {
    return (await this.system()).userPoolId;
  }

  async listUsers(): Promise<UserInfo[]> {
    const UserPoolId = await this.pool();
    const users: UserType[] = [];
    let token: string | undefined;
    do {
      const page = await this.cognito.send(new ListUsersCommand({ UserPoolId, Limit: 60, PaginationToken: token }));
      users.push(...(page.Users ?? []));
      token = page.PaginationToken;
    } while (token);

    const admins = new Set<string>();
    let next: string | undefined;
    do {
      const page = await this.cognito.send(
        new ListUsersInGroupCommand({ UserPoolId, GroupName: ADMIN_GROUP, Limit: 60, NextToken: next }),
      );
      for (const u of page.Users ?? []) if (u.Username) admins.add(u.Username);
      next = page.NextToken;
    } while (next);

    return users.map((u) => ({
      username: u.Username ?? '',
      email: attribute(u, 'email') ?? u.Username ?? '',
      enabled: u.Enabled ?? false,
      status: u.UserStatus ?? 'UNKNOWN',
      isAdmin: admins.has(u.Username ?? ''),
      createdAt: u.UserCreateDate?.toISOString() ?? null,
    }));
  }

  async inviteUser(email: string, admin: boolean): Promise<UserInfo> {
    const UserPoolId = await this.pool();
    try {
      const result = await this.cognito.send(
        new AdminCreateUserCommand({
          UserPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      const user = result.User!;
      if (admin) await this.setAdmin(user.Username!, true);
      return {
        username: user.Username!,
        email,
        enabled: user.Enabled ?? true,
        status: user.UserStatus ?? 'FORCE_CHANGE_PASSWORD',
        isAdmin: admin,
        createdAt: user.UserCreateDate?.toISOString() ?? null,
      };
    } catch (error) {
      if (error instanceof UsernameExistsException) throw conflict('A user with this email already exists', 'user_exists');
      throw error;
    }
  }

  async setEnabled(username: string, enabled: boolean) {
    const UserPoolId = await this.pool();
    if (enabled) {
      await this.cognito.send(new AdminEnableUserCommand({ UserPoolId, Username: username }));
    } else {
      await this.cognito.send(new AdminDisableUserCommand({ UserPoolId, Username: username }));
      await this.cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username: username }));
    }
  }

  async setAdmin(username: string, admin: boolean) {
    const UserPoolId = await this.pool();
    const input = { UserPoolId, Username: username, GroupName: ADMIN_GROUP };
    await this.cognito.send(admin ? new AdminAddUserToGroupCommand(input) : new AdminRemoveUserFromGroupCommand(input));
  }

  async deleteUser(username: string) {
    await this.cognito.send(new AdminDeleteUserCommand({ UserPoolId: await this.pool(), Username: username }));
  }

  async findSub(username: string) {
    try {
      const user = await this.cognito.send(new AdminGetUserCommand({ UserPoolId: await this.pool(), Username: username }));
      return user.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
    } catch (error) {
      if (error instanceof UserNotFoundException) return null;
      throw error;
    }
  }
}
