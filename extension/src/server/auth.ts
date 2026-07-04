import * as crypto from 'crypto';
import type * as vscode from 'vscode';

const TOKEN_KEY = 'mobileCompanion.pairToken';

export class AuthManager {
  constructor(private state: vscode.Memento) {}

  getToken(): string {
    let token = this.state.get<string>(TOKEN_KEY);
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url');
      void this.state.update(TOKEN_KEY, token);
    }
    return token;
  }

  /** Invalidates every paired device. */
  regenerate(): string {
    const token = crypto.randomBytes(24).toString('base64url');
    void this.state.update(TOKEN_KEY, token);
    return token;
  }

  verify(token: string | null | undefined): boolean {
    if (!token) return false;
    const a = Buffer.from(String(token));
    const b = Buffer.from(this.getToken());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
