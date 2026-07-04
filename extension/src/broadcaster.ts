import type { ChatMessage, ServerMessage } from '@shared/protocol';

export type Sink = (msg: ServerMessage) => void;

/**
 * Central fan-out for server events. Every connected phone, the desktop panel,
 * and any other listener registers a sink. Chat messages are also kept in a
 * per-session ring buffer so reconnecting clients can catch up.
 */
export class Broadcaster {
  private sinks = new Set<Sink>();
  private history = new Map<string, ChatMessage[]>();

  constructor(private historyLimit: () => number) {}

  addSink(sink: Sink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  broadcast(msg: ServerMessage): void {
    if (msg.type === 'chat.message') this.remember(msg.message);
    for (const sink of [...this.sinks]) {
      try {
        sink(msg);
      } catch {
        /* dead sink — removed on close elsewhere */
      }
    }
  }

  getHistory(sessionId: string): ChatMessage[] {
    return this.history.get(sessionId) ?? [];
  }

  dropSession(sessionId: string): void {
    this.history.delete(sessionId);
  }

  private remember(m: ChatMessage): void {
    const arr = this.history.get(m.sessionId) ?? [];
    arr.push(m);
    const limit = this.historyLimit();
    if (arr.length > limit) arr.splice(0, arr.length - limit);
    this.history.set(m.sessionId, arr);
  }
}
