import * as path from 'path';
import * as vscode from 'vscode';
import type * as http from 'http';
import {
  ClientMessage,
  CompanionNotification,
  PROTOCOL_VERSION,
  ServerMessage,
  SnapshotPayload,
  summarizeToolInput,
} from '@shared/protocol';
import { Broadcaster } from './broadcaster';
import { getConfig } from './config';
import { HookBridge } from './hooks/hookBridge';
import { TranscriptTailer } from './hooks/transcriptTailer';
import { log } from './log';
import { makeNtfyPusher, NtfyPusher } from './ntfy';
import { AuthManager } from './server/auth';
import { createHttpServer } from './server/httpServer';
import { WsGateway } from './server/wsServer';
import { SessionManager } from './session/manager';
import { ApprovalQueue, QuestionQueue } from './session/queues';
import { lanAddresses, truncate } from './util';
import { handleVscodeAction } from './vscodeBridge';

/** Composition root: owns the server, session manager, queues and hook bridge. */
export class CompanionCore implements vscode.Disposable {
  readonly auth: AuthManager;
  readonly broadcaster: Broadcaster;
  readonly approvals: ApprovalQueue;
  readonly questions: QuestionQueue;
  readonly sessions: SessionManager;
  readonly tailer: TranscriptTailer;
  readonly hookBridge: HookBridge;
  readonly ntfy: NtfyPusher;
  readonly version: string;

  /** Last few notifications, displayed in the desktop panel. */
  recentNotifications: CompanionNotification[] = [];
  /** Status-bar refresh hook. */
  onStateChanged?: () => void;

  private httpServer?: http.Server;
  private gateway?: WsGateway;

  constructor(private context: vscode.ExtensionContext) {
    this.version = String((context.extension.packageJSON as Record<string, unknown>)?.version ?? '0.0.0');
    this.auth = new AuthManager(context.globalState);
    this.broadcaster = new Broadcaster(() => getConfig().historyLimit);
    this.ntfy = makeNtfyPusher(getConfig, log);

    this.approvals = new ApprovalQueue({
      onRequest: (req) => {
        this.broadcaster.broadcast({ type: 'approval.request', approval: req });
        this.broadcaster.broadcast({
          type: 'notification',
          notification: {
            kind: 'permission',
            title: `Xin quyền: ${req.tool}`,
            body: truncate(summarizeToolInput(req.tool, req.input), 200),
            sessionId: req.sessionId,
          },
        });
        // Hook-origin requests are pushed to ntfy by HookBridge before queuing.
        if (req.origin === 'hosted') {
          this.ntfy(`Cần duyệt quyền: ${req.tool}`, truncate(summarizeToolInput(req.tool, req.input), 300));
        }
      },
      onResolved: (id, behavior, by) =>
        this.broadcaster.broadcast({ type: 'approval.resolved', id, behavior, by }),
    });

    this.questions = new QuestionQueue({
      onRequest: (req) => {
        this.broadcaster.broadcast({ type: 'question.request', question: req });
        const first = req.questions[0]?.question ?? '';
        this.broadcaster.broadcast({
          type: 'notification',
          notification: { kind: 'question', title: 'Claude đang hỏi bạn', body: truncate(first, 200), sessionId: req.sessionId },
        });
        this.ntfy('Claude đang hỏi bạn', truncate(first, 300));
      },
      onResolved: (id, by) => this.broadcaster.broadcast({ type: 'question.resolved', id, by }),
    });

    this.sessions = new SessionManager({
      broadcaster: this.broadcaster,
      approvals: this.approvals,
      questions: this.questions,
      getConfig,
      log,
      defaultCwd: () => this.workspaceRoot(),
    });

    this.tailer = new TranscriptTailer({ broadcaster: this.broadcaster, cwd: () => this.workspaceRoot(), log });
    this.hookBridge = new HookBridge({
      approvals: this.approvals,
      broadcaster: this.broadcaster,
      getConfig,
      ntfy: this.ntfy,
      log,
    });

    // Keep a small notification ring for the desktop panel.
    this.broadcaster.addSink((msg) => {
      if (msg.type === 'notification') {
        this.recentNotifications.push(msg.notification);
        if (this.recentNotifications.length > 5) this.recentNotifications.shift();
      }
      this.onStateChanged?.();
    });
  }

  // ---------------------------------------------------------------------------
  // Server lifecycle
  // ---------------------------------------------------------------------------

  get isRunning(): boolean {
    return !!this.httpServer;
  }

  get clientCount(): number {
    return this.gateway?.clientCount ?? 0;
  }

  workspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  async start(): Promise<void> {
    if (this.httpServer) return;
    const cfg = getConfig();
    const webRoot = path.join(this.context.extensionPath, 'webapp-dist');
    const server = createHttpServer({
      webRoot,
      version: this.version,
      handleHook: (body) => this.hookBridge.handle(body),
      log,
    });
    this.gateway = new WsGateway(server, {
      auth: this.auth,
      log,
      addSink: (sink) => this.broadcaster.addSink(sink),
      onAuthed: (reply) => {
        reply({
          type: 'hello',
          serverVersion: this.version,
          protocolVersion: PROTOCOL_VERSION,
          workspaceName: vscode.workspace.name ?? path.basename(this.workspaceRoot()),
        });
        reply({ type: 'snapshot', snapshot: this.buildSnapshot() });
      },
      onClientMessage: (msg, reply) => this.handleClientMessage(msg, reply),
      onClientCountChanged: () => this.onStateChanged?.(),
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(cfg.port, cfg.bindHost, () => {
        server.off('error', onError);
        resolve();
      });
    });
    this.httpServer = server;
    server.on('error', (err) => log(`http server error: ${err}`));
    log(`server listening on http://${cfg.bindHost}:${cfg.port}`);
    this.onStateChanged?.();
  }

  stop(): void {
    this.gateway?.dispose();
    this.gateway = undefined;
    this.httpServer?.close();
    this.httpServer = undefined;
    log('server stopped');
    this.onStateChanged?.();
  }

  dispose(): void {
    this.stop();
    this.sessions.disposeAll();
    this.tailer.dispose();
  }

  // ---------------------------------------------------------------------------
  // Pairing
  // ---------------------------------------------------------------------------

  pairingUrls(): string[] {
    if (!this.isRunning) return [];
    const cfg = getConfig();
    const hosts = cfg.bindHost === '127.0.0.1' || cfg.bindHost === 'localhost' ? ['127.0.0.1'] : lanAddresses();
    return (hosts.length ? hosts : ['127.0.0.1']).map((h) => `http://${h}:${cfg.port}/`);
  }

  /** Full pairing link (URL + token) encoded into the QR code. */
  pairingLink(): string | undefined {
    const [primary] = this.pairingUrls();
    if (!primary) return undefined;
    return `${primary}#/pair?token=${encodeURIComponent(this.auth.getToken())}`;
  }

  // ---------------------------------------------------------------------------
  // Client message handling
  // ---------------------------------------------------------------------------

  buildSnapshot(): SnapshotPayload {
    const active = this.sessions.getActive();
    return {
      sessions: this.sessions.listAll(),
      activeSessionId: active?.localId ?? null,
      messages: active ? this.broadcaster.getHistory(active.localId) : [],
      approvals: this.approvals.list(),
      questions: this.questions.list(),
    };
  }

  broadcastSessions(): void {
    this.broadcaster.broadcast({ type: 'sessions.list', sessions: this.sessions.listAll() });
  }

  async newSessionCommand(): Promise<void> {
    await this.sessions.createSession();
    this.broadcastSessions();
  }

  async handleClientMessage(msg: ClientMessage, reply: (m: ServerMessage) => void): Promise<void> {
    try {
      switch (msg.type) {
        case 'prompt.send': {
          let session = msg.sessionId ? this.sessions.get(msg.sessionId) : this.sessions.getActive();
          if (!session || session.status === 'closed' || session.status === 'error') {
            session = await this.sessions.createSession();
          }
          this.sessions.activeId = session.localId;
          session.sendPrompt(msg.text);
          this.broadcastSessions();
          break;
        }

        case 'approval.respond': {
          if (!this.approvals.respond(msg.id, msg.behavior, 'phone', msg.message)) {
            reply({ type: 'error', message: 'Yêu cầu duyệt quyền đã hết hạn hoặc đã được xử lý.' });
          }
          break;
        }

        case 'question.respond': {
          if (!this.questions.respond(msg.id, msg.answers, 'phone')) {
            reply({ type: 'error', message: 'Câu hỏi đã hết hạn hoặc đã được trả lời.' });
          }
          break;
        }

        case 'session.interrupt':
          await this.sessions.get(msg.sessionId)?.interrupt();
          break;

        case 'session.setMode':
          await this.sessions.get(msg.sessionId)?.setPermissionMode(msg.mode);
          break;

        case 'session.new':
          await this.sessions.createSession(msg.cwd);
          this.broadcastSessions();
          break;

        case 'session.resume': {
          // msg.sessionId is a Claude session UUID (external transcript).
          const session = await this.sessions.createSession(undefined, msg.sessionId);
          const backlog = this.tailer
            .backlog(msg.sessionId, 100)
            .map((m) => ({ ...m, sessionId: session.localId }));
          reply({ type: 'session.backlog', sessionId: session.localId, messages: backlog });
          this.broadcastSessions();
          break;
        }

        case 'session.select': {
          const hosted = this.sessions.get(msg.sessionId);
          if (hosted) {
            this.sessions.activeId = hosted.localId;
            reply({
              type: 'session.backlog',
              sessionId: hosted.localId,
              messages: this.broadcaster.getHistory(hosted.localId),
            });
          } else {
            // External session: read-only mirror via transcript tailing.
            this.tailer.watch(msg.sessionId);
            reply({
              type: 'session.backlog',
              sessionId: msg.sessionId,
              messages: this.tailer.backlog(msg.sessionId, 100),
            });
          }
          break;
        }

        case 'sessions.refresh':
          reply({ type: 'sessions.list', sessions: this.sessions.listAll() });
          break;

        case 'vscode.request': {
          try {
            const data = await handleVscodeAction(msg.action, msg.args ?? {});
            reply({ type: 'vscode.response', id: msg.id, ok: true, data });
          } catch (err) {
            reply({ type: 'vscode.response', id: msg.id, ok: false, error: String(err) });
          }
          break;
        }

        default:
          reply({ type: 'error', message: `Loại message không hỗ trợ: ${(msg as { type: string }).type}` });
      }
    } catch (err) {
      log(`handleClientMessage(${msg.type}) failed: ${err instanceof Error ? err.stack : err}`);
      reply({ type: 'error', message: String(err) });
    }
  }
}
