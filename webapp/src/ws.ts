import type { ClientMessage, ServerMessage } from '@shared/protocol';
import { parseServerMessage } from '@shared/protocol';
import type { ConnStatus } from './store';

/** WebSocket client with auto-reconnect (exponential backoff) and keepalive pings. */
export class WsClient {
  onMessage: (m: ServerMessage) => void = () => undefined;
  onStatus: (s: ConnStatus) => void = () => undefined;

  private ws?: WebSocket;
  private backoff = 1000;
  private disposed = false;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private unauthorized = false;

  constructor(
    private serverOrigin: string,
    private token: string,
  ) {}

  connect(): void {
    if (this.disposed) return;
    this.onStatus('connecting');
    const wsUrl =
      this.serverOrigin.replace(/^http/, 'ws').replace(/\/$/, '') +
      `/ws?token=${encodeURIComponent(this.token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
    };
    ws.onmessage = (ev) => {
      const msg = parseServerMessage(String(ev.data));
      if (!msg) return;
      if (msg.type === 'auth.result') {
        if (msg.ok) {
          this.unauthorized = false;
          this.onStatus('online');
        } else {
          this.unauthorized = true;
          this.onStatus('unauthorized');
        }
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      if (!this.disposed && !this.unauthorized) {
        this.onStatus('disconnected');
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
      ws.close();
    };

    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25_000);
    }
  }

  /** Reconnect immediately (e.g. when the app returns to the foreground). */
  wake(): void {
    if (this.disposed || this.unauthorized) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.backoff = 1000;
    this.connect();
  }

  send(m: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 1.7, 10_000);
  }
}
