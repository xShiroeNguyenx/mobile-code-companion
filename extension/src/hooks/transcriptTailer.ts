import * as fs from 'fs';
import type { ChatMessage } from '@shared/protocol';
import type { Broadcaster } from '../broadcaster';
import { findTranscriptFile, parseTranscriptLine, readBacklog } from '../session/transcript';

export interface TailerDeps {
  broadcaster: Broadcaster;
  cwd: () => string;
  log: (msg: string) => void;
}

interface WatchedFile {
  file: string;
  offset: number;
  remainder: string;
  timer: ReturnType<typeof setInterval>;
}

/**
 * Read-only mirror of external Claude Code sessions (official panel / CLI):
 * polls the session's transcript .jsonl for appended lines and broadcasts
 * them as chat messages. Polling (not fs.watch) — reliable on Windows.
 */
export class TranscriptTailer {
  private watched = new Map<string, WatchedFile>();

  constructor(private deps: TailerDeps) {}

  backlog(claudeSessionId: string, limit = 100): ChatMessage[] {
    const file = findTranscriptFile(this.deps.cwd(), claudeSessionId);
    if (!file) return [];
    return readBacklog(file, claudeSessionId, limit);
  }

  watch(claudeSessionId: string): boolean {
    if (this.watched.has(claudeSessionId)) return true;
    const file = findTranscriptFile(this.deps.cwd(), claudeSessionId);
    if (!file) return false;
    let offset = 0;
    try {
      offset = fs.statSync(file).size;
    } catch {
      return false;
    }
    const timer = setInterval(() => this.poll(claudeSessionId), 1200);
    this.watched.set(claudeSessionId, { file, offset, remainder: '', timer });
    this.deps.log(`tailing external session ${claudeSessionId}`);
    return true;
  }

  unwatch(claudeSessionId: string): void {
    const w = this.watched.get(claudeSessionId);
    if (!w) return;
    clearInterval(w.timer);
    this.watched.delete(claudeSessionId);
  }

  dispose(): void {
    for (const id of [...this.watched.keys()]) this.unwatch(id);
  }

  private poll(sessionId: string): void {
    const w = this.watched.get(sessionId);
    if (!w) return;
    let size = 0;
    try {
      size = fs.statSync(w.file).size;
    } catch {
      return;
    }
    if (size <= w.offset) return;

    let fd: number;
    try {
      fd = fs.openSync(w.file, 'r');
    } catch {
      return;
    }
    try {
      const buf = Buffer.alloc(size - w.offset);
      fs.readSync(fd, buf, 0, buf.length, w.offset);
      w.offset = size;
      const text = w.remainder + buf.toString('utf8');
      const lines = text.split(/\r?\n/);
      w.remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = parseTranscriptLine(line, sessionId);
        if (msg) this.deps.broadcaster.broadcast({ type: 'chat.message', message: msg });
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}
