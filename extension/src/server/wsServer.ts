import type * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMessage, parseClientMessage, ServerMessage } from '@shared/protocol';
import type { AuthManager } from './auth';

export interface WsDeps {
  auth: AuthManager;
  log: (msg: string) => void;
  addSink: (sink: (m: ServerMessage) => void) => () => void;
  /** Called right after successful auth — send hello + snapshot here. */
  onAuthed: (reply: (m: ServerMessage) => void) => void;
  onClientMessage: (msg: ClientMessage, reply: (m: ServerMessage) => void) => void | Promise<void>;
  onClientCountChanged?: (count: number) => void;
}

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

export class WsGateway {
  private wss: WebSocketServer;
  private clients = new Set<TrackedSocket>();
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(server: http.Server, private deps: WsDeps) {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws as TrackedSocket, url));
    });
    this.heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30_000);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  dispose(): void {
    clearInterval(this.heartbeat);
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    this.wss.close();
  }

  private onConnection(ws: TrackedSocket, url: URL): void {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    let authed = false;
    let removeSink: (() => void) | undefined;
    const reply = (m: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };

    const authenticate = (token: string | null): void => {
      if (this.deps.auth.verify(token)) {
        authed = true;
        this.clients.add(ws);
        removeSink = this.deps.addSink(reply);
        reply({ type: 'auth.result', ok: true });
        this.deps.onAuthed(reply);
        this.deps.onClientCountChanged?.(this.clients.size);
      } else {
        reply({ type: 'auth.result', ok: false, reason: 'invalid token' });
        ws.close(4001, 'unauthorized');
      }
    };

    // Token may arrive via query string (QR flow) or as a first auth frame.
    const queryToken = url.searchParams.get('token');
    if (queryToken) authenticate(queryToken);

    ws.on('message', (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) return;
      if (msg.type === 'auth') {
        if (!authed) authenticate(msg.token);
        return;
      }
      if (!authed) {
        reply({ type: 'error', message: 'not authenticated' });
        return;
      }
      if (msg.type === 'ping') {
        reply({ type: 'pong' });
        return;
      }
      void this.deps.onClientMessage(msg, reply);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      removeSink?.();
      this.deps.onClientCountChanged?.(this.clients.size);
    });
    ws.on('error', (err) => this.deps.log(`ws error: ${err}`));
  }
}
