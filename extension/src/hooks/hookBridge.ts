import { summarizeToolInput } from '@shared/protocol';
import type { Broadcaster } from '../broadcaster';
import type { CompanionConfig } from '../config';
import type { NtfyPusher } from '../ntfy';
import type { ApprovalQueue } from '../session/queues';
import { truncate } from '../util';

export interface HookBridgeDeps {
  approvals: ApprovalQueue;
  broadcaster: Broadcaster;
  getConfig: () => CompanionConfig;
  ntfy: NtfyPusher;
  log: (msg: string) => void;
}

/**
 * Mode B ("Companion") — receives Claude Code hook events POSTed to /hook by
 * sessions running in the official panel or a terminal CLI:
 *
 *  - PermissionRequest: forwarded to the phone; the HTTP response carries the
 *    allow/deny decision back into Claude Code. On timeout we return {} so the
 *    normal desktop dialog takes over.
 *  - Notification / Stop: pushed to the phone (and ntfy) as notifications.
 */
export class HookBridge {
  constructor(private deps: HookBridgeDeps) {}

  async handle(body: unknown): Promise<Record<string, unknown>> {
    const b = (body ?? {}) as Record<string, any>;
    const event = String(b.hook_event_name ?? '');
    switch (event) {
      case 'PermissionRequest':
        return this.onPermissionRequest(b);
      case 'Notification': {
        const text = String(b.message ?? b.notification?.message ?? 'Claude Code cần chú ý');
        this.notify('permission', 'Claude Code', text, b.session_id);
        return {};
      }
      case 'Stop': {
        this.notify('stop', 'Claude đã xong (session ngoài)', 'Session bên panel/CLI đã dừng hoặc đang chờ lệnh tiếp.', b.session_id);
        return {};
      }
      default:
        this.deps.log(`hook: ignored event "${event}"`);
        return {};
    }
  }

  private async onPermissionRequest(b: Record<string, any>): Promise<Record<string, unknown>> {
    // Field names tolerate both documented layouts (top-level and nested permission_request).
    const nested = (b.permission_request ?? {}) as Record<string, any>;
    const tool = String(b.tool_name ?? nested.tool_name ?? 'unknown');
    const input = (b.tool_input ?? nested.input ?? nested.tool_input ?? {}) as Record<string, unknown>;
    const sessionId = String(b.session_id ?? 'external');
    const cfg = this.deps.getConfig();

    this.deps.ntfy('Cần duyệt quyền (panel chính thức)', `${tool}: ${truncate(summarizeToolInput(tool, input), 300)}`);

    const res = await this.deps.approvals.request(
      { sessionId, origin: 'hook', tool, input, decisionReason: 'Từ session Claude Code bên ngoài (panel/CLI)' },
      cfg.hookApprovalTimeoutMs,
      'deny',
    );

    // No decision → Claude Code falls back to its normal permission dialog.
    if (res.by === 'timeout') {
      this.deps.log(`hook approval for ${tool} timed out — falling back to desktop dialog`);
      return {};
    }

    const decision =
      res.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: res.message || 'Denied from Mobile Code Companion.' };

    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision,
      },
    };
  }

  private notify(kind: 'stop' | 'permission', title: string, body: string, sessionId?: unknown): void {
    this.deps.broadcaster.broadcast({
      type: 'notification',
      notification: {
        kind,
        title,
        body,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      },
    });
    this.deps.ntfy(title, body);
  }
}
