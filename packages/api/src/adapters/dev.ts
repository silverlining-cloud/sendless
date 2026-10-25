import type { UserInfo } from '@sendless/shared';
import { conflict, notFound } from '../http.js';
import type { Authenticator, Directory, Principal } from '../ports.js';

/**
 * Dev-only authentication. The token is `dev:<email>`; it is accepted only for users
 * that exist in the MemoryDirectory. Never used in AWS deployments.
 */
export class DevAuthenticator implements Authenticator {
  constructor(private readonly directory: MemoryDirectory) {}

  async authenticate(token: string): Promise<Principal | null> {
    if (!token.startsWith('dev:')) return null;
    const user = this.directory.find(token.slice(4).toLowerCase());
    if (!user || !user.enabled) return null;
    return { sub: `dev-${user.username}`, username: user.username, email: user.email, isAdmin: user.isAdmin };
  }
}

export class MemoryDirectory implements Directory {
  private users = new Map<string, UserInfo>();

  constructor(seed: { email: string; admin: boolean }[] = []) {
    for (const s of seed) this.add(s.email, s.admin, 'CONFIRMED');
  }

  find(email: string): UserInfo | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }

  private add(email: string, admin: boolean, status: string): UserInfo {
    const user: UserInfo = {
      username: email.replace(/[^a-z0-9]/gi, '-'),
      email,
      enabled: true,
      status,
      isAdmin: admin,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.username, user);
    return user;
  }

  private get(username: string): UserInfo {
    const user = this.users.get(username);
    if (!user) throw notFound('User not found');
    return user;
  }

  async listUsers() {
    return [...this.users.values()].map((u) => ({ ...u }));
  }

  async inviteUser(email: string, admin: boolean) {
    if (this.find(email)) throw conflict('A user with this email already exists', 'user_exists');
    return { ...this.add(email, admin, 'FORCE_CHANGE_PASSWORD') };
  }

  async setEnabled(username: string, enabled: boolean) {
    this.get(username).enabled = enabled;
  }

  async setAdmin(username: string, admin: boolean) {
    this.get(username).isAdmin = admin;
  }

  async deleteUser(username: string) {
    this.get(username);
    this.users.delete(username);
  }

  /** Matches the `sub` that DevAuthenticator hands out. */
  async findSub(username: string) {
    return this.users.has(username) ? `dev-${username}` : null;
  }
}
