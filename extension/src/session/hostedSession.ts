import type {
  PermissionMode,
  Question,
  SessionInfo,
  SessionStatus,
} from '@shared/protocol';
import type { Broadcaster } from '../broadcaster';
import type { CompanionConfig } from '../config';
import { AsyncPushQueue, nowIso, truncate, uuid } from '../util';
import { ApprovalQueue, QuestionQueue } from './queues';
import { loadSdk, SdkPermissionResult, SdkQuery, SdkUserMessage } from './sdk';
import { mapApiContent } from './transcript';

export interface HostedSessionDeps {
  broadcaster: Broadcaster;
  approvals: ApprovalQueue;
  questions: QuestionQueue;
  getConfig: () => CompanionConfig;
  log: (msg: string) => void;
}

/**
 * One Claude Code session run by this extension through the Agent SDK
 * (Mode A — "Hosted Session" in PLAN.md). The protocol-level session id is
 * `localId`; the real Claude session UUID is learned from the init message.
 */
export class HostedSession {
  readonly localId = uuid();
  claudeSessionId?: string;
  status: SessionStatus = 'idle';
  permissionMode: PermissionMode;
  model?: string;
  title?: string;
  lastActiveAt = nowIso();

  private input = new AsyncPushQueue<SdkUserMessage>();
  private query?: SdkQuery;
  private disposed = false;

  constructor(
    readonly cwd: string,
    private deps: HostedSessionDeps,
    private resumeId?: string,
  ) {
    this.permissionMode = deps.getConfig().defaultPermissionMode;
    if (resumeId) this.claudeSessionId = resumeId;
  }

  info(): SessionInfo {
    return {
      id: this.localId,
      claudeSessionId: this.claudeSessionId,
      cwd: this.cwd,
      source: 'hosted',
      status: this.status,
      title: this.title,
      model: this.model,
      permissionMode: this.permissionMode,
      lastActiveAt: this.lastActiveAt,
    };
  }

  async start(): Promise<void> {
    const sdk = await loadSdk();
    const cfg = this.deps.getConfig();
    const options: Record<string, unknown> = {
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      includePartialMessages: true,
      canUseTool: (tool: string, input: Record<string, unknown>, opts?: Record<string, unknown>) =>
        this.canUseTool(tool, input ?? {}, opts ?? {}),
      stderr: (data: string) => this.deps.log(`[sdk:${this.localId.slice(0, 8)}] ${data}`),
    };
    // Give the user time to answer from their phone: AskUserQuestion dialogs
    // otherwise auto-close after ~60s.
    options.env = { ...process.env, CLAUDE_AFK_TIMEOUT_MS: String(cfg.approvalTimeoutMs) };
    if (cfg.model) options.model = cfg.model;
    if (this.resumeId) options.resume = this.resumeId;

    this.query = sdk.query({ prompt: this.input, options });
    void this.pump();
    this.emitState();
  }

  sendPrompt(text: string): void {
    if (!this.title) this.title = truncate(text.replace(/\s+/g, ' '), 60);
    this.touch();
    this.input.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: this.claudeSessionId ?? '',
    });
    // Echo the prompt to all clients right away (the SDK does not replay it).
    this.deps.broadcaster.broadcast({
      type: 'chat.message',
      message: {
        uuid: uuid(),
        sessionId: this.localId,
        role: 'user',
        blocks: [{ kind: 'text', text }],
        timestamp: nowIso(),
      },
    });
    this.setStatus('thinking');
  }

  async interrupt(): Promise<void> {
    try {
      await this.query?.interrupt();
    } catch (err) {
      this.deps.log(`interrupt failed: ${err}`);
    }
    this.setStatus('idle');
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
    try {
      await this.query?.setPermissionMode(mode);
    } catch (err) {
      this.deps.log(`setPermissionMode failed: ${err}`);
    }
    this.emitState();
  }

  dispose(): void {
    this.disposed = true;
    this.input.close();
    void this.query?.interrupt().catch(() => undefined);
    this.status = 'closed';
  }

  // -------------------------------------------------------------------------

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.query!) {
        this.handle(msg as Record<string, any>);
      }
      if (!this.disposed) this.setStatus('closed');
    } catch (err) {
      if (this.disposed) return;
      this.deps.log(`session ${this.localId} crashed: ${err instanceof Error ? err.stack : err}`);
      this.setStatus('error');
      this.deps.broadcaster.broadcast({
        type: 'notification',
        notification: {
          kind: 'error',
          title: 'Session lỗi',
          body: String(err),
          sessionId: this.localId,
        },
      });
    }
  }

  private handle(msg: Record<string, any>): void {
    this.touch();
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.claudeSessionId = typeof msg.session_id === 'string' ? msg.session_id : this.claudeSessionId;
          this.model = typeof msg.model === 'string' ? msg.model : this.model;
          this.emitState();
        }
        break;

      case 'stream_event':
        this.handleStreamEvent((msg.event ?? {}) as Record<string, any>);
        break;

      case 'assistant': {
        const blocks = mapApiContent(msg.message?.content);
        this.deps.broadcaster.broadcast({ type: 'chat.deltaReset', sessionId: this.localId });
        if (blocks.length) {
          this.deps.broadcaster.broadcast({
            type: 'chat.message',
            message: {
              uuid: typeof msg.uuid === 'string' ? msg.uuid : uuid(),
              sessionId: this.localId,
              role: 'assistant',
              blocks,
              timestamp: nowIso(),
            },
          });
        }
        break;
      }

      case 'user': {
        // SDK-synthesized user messages carry tool results; plain prompts were echoed at send time.
        const blocks = mapApiContent(msg.message?.content).filter((b) => b.kind === 'tool_result');
        if (blocks.length) {
          this.deps.broadcaster.broadcast({
            type: 'chat.message',
            message: {
              uuid: typeof msg.uuid === 'string' ? msg.uuid : uuid(),
              sessionId: this.localId,
              role: 'user',
              blocks,
              timestamp: nowIso(),
            },
          });
        }
        break;
      }

      case 'result': {
        this.setStatus('idle');
        const ok = msg.subtype === 'success';
        this.deps.broadcaster.broadcast({
          type: 'notification',
          notification: {
            kind: ok ? 'stop' : 'error',
            title: ok ? 'Claude đã xong' : `Kết thúc: ${msg.subtype}`,
            body: truncate(String(msg.result ?? ''), 300),
            sessionId: this.localId,
          },
        });
        break;
      }
    }
  }

  private handleStreamEvent(event: Record<string, any>): void {
    if (event.type === 'message_start') {
      this.setStatus('streaming');
      this.deps.broadcaster.broadcast({ type: 'chat.deltaReset', sessionId: this.localId });
      return;
    }
    if (event.type === 'content_block_delta') {
      const delta = (event.delta ?? {}) as Record<string, any>;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        this.deps.broadcaster.broadcast({ type: 'chat.delta', sessionId: this.localId, text: delta.text });
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        this.deps.broadcaster.broadcast({
          type: 'chat.delta',
          sessionId: this.localId,
          text: delta.thinking,
          thinking: true,
        });
      }
    }
  }

  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    opts: Record<string, unknown>,
  ): Promise<SdkPermissionResult> {
    const signal = opts.signal instanceof AbortSignal ? opts.signal : undefined;
    if (toolName === 'AskUserQuestion') return this.handleQuestion(input, signal);

    const cfg = this.deps.getConfig();
    this.setStatus('awaiting_approval');
    try {
      const res = await this.deps.approvals.request(
        {
          sessionId: this.localId,
          origin: 'hosted',
          tool: toolName,
          input,
          decisionReason: opts.decisionReason ? String(opts.decisionReason) : undefined,
        },
        cfg.approvalTimeoutMs,
        cfg.approvalTimeoutAction,
        signal,
      );
      if (res.behavior === 'allow') return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: res.message || 'Denied from Mobile Code Companion.' };
    } finally {
      if (this.status === 'awaiting_approval') this.setStatus('thinking');
    }
  }

  private async handleQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SdkPermissionResult> {
    const cfg = this.deps.getConfig();
    const rawQuestions = Array.isArray((input as any).questions) ? ((input as any).questions as any[]) : [];
    const questions: Question[] = rawQuestions.map((q) => ({
      question: String(q?.question ?? ''),
      header: q?.header ? String(q.header) : undefined,
      multiSelect: Boolean(q?.multiSelect),
      options: Array.isArray(q?.options)
        ? q.options.map((o: any) => ({
            label: String(o?.label ?? ''),
            description: o?.description ? String(o.description) : undefined,
          }))
        : [],
    }));

    this.setStatus('awaiting_answer');
    try {
      const res = await this.deps.questions.request(
        { sessionId: this.localId, questions },
        cfg.approvalTimeoutMs,
        signal,
      );
      if (!res.answers) {
        return {
          behavior: 'deny',
          message: 'The user did not answer in time. Pick the safest reasonable default yourself and continue.',
        };
      }
      if (cfg.askUserQuestionStrategy === 'updatedInput') {
        // Documented shape (agent-sdk/user-input): answers keyed by exact question
        // text; string label for single-select, array of labels for multiSelect.
        const answers: Record<string, string | string[]> = {};
        questions.forEach((q, i) => {
          const selected = res.answers![i] ?? [];
          answers[q.question] = q.multiSelect ? selected : (selected[0] ?? '');
        });
        return {
          behavior: 'allow',
          updatedInput: { questions: rawQuestions, answers },
        };
      }
      // Fallback strategy: reject the tool call but hand the model the answer.
      const answerText = questions
        .map((q, i) => `"${q.question}" → ${(res.answers![i] ?? []).join(', ') || '(no selection)'}`)
        .join('; ');
      return {
        behavior: 'deny',
        message: `The user already answered from their phone: ${answerText}. Treat this as the final answer — do NOT ask again; continue accordingly.`,
      };
    } finally {
      if (this.status === 'awaiting_answer') this.setStatus('thinking');
    }
  }

  private setStatus(s: SessionStatus): void {
    if (this.disposed && s !== 'closed') return;
    this.status = s;
    this.emitState();
  }

  private emitState(): void {
    this.deps.broadcaster.broadcast({ type: 'session.state', session: this.info() });
  }

  private touch(): void {
    this.lastActiveAt = nowIso();
  }
}
