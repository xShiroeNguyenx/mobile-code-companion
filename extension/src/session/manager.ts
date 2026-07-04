import type { SessionInfo } from '@shared/protocol';
import { HostedSession, HostedSessionDeps } from './hostedSession';
import { listExternalSessions } from './transcript';

export interface SessionManagerDeps extends HostedSessionDeps {
  defaultCwd: () => string;
}

export class SessionManager {
  private sessions = new Map<string, HostedSession>();
  activeId: string | null = null;

  constructor(private deps: SessionManagerDeps) {}

  get(id: string): HostedSession | undefined {
    return this.sessions.get(id);
  }

  getActive(): HostedSession | undefined {
    return this.activeId ? this.sessions.get(this.activeId) : undefined;
  }

  async createSession(cwd?: string, resumeClaudeSessionId?: string): Promise<HostedSession> {
    const session = new HostedSession(cwd ?? this.deps.defaultCwd(), this.deps, resumeClaudeSessionId);
    this.sessions.set(session.localId, session);
    this.activeId = session.localId;
    await session.start();
    return session;
  }

  async ensureActive(): Promise<HostedSession> {
    const active = this.getActive();
    if (active && active.status !== 'closed' && active.status !== 'error') return active;
    return this.createSession();
  }

  listHosted(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info());
  }

  /** Hosted sessions plus recent external (official panel / CLI) transcripts, newest first. */
  listAll(): SessionInfo[] {
    const hosted = this.listHosted();
    const hostedClaudeIds = new Set(hosted.map((h) => h.claudeSessionId).filter(Boolean));
    const cwd = this.deps.defaultCwd();
    const external: SessionInfo[] = listExternalSessions(cwd)
      .filter((e) => !hostedClaudeIds.has(e.id))
      .map((e) => ({
        id: e.id,
        claudeSessionId: e.id,
        cwd,
        source: 'external' as const,
        status: 'idle' as const,
        title: e.title,
        lastActiveAt: new Date(e.mtimeMs).toISOString(),
      }));
    return [...hosted, ...external].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.activeId = null;
  }
}
