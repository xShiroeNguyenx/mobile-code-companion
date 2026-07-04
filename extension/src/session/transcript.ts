import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChatMessage, ContentBlock } from '@shared/protocol';
import { truncate, uuid } from '../util';

/**
 * Claude Code stores transcripts at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * where <encoded-cwd> is the working directory with every non-alphanumeric
 * character replaced by '-'.
 */
export function encodeCwdForClaude(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function transcriptDirCandidates(cwd: string, home = os.homedir()): string[] {
  const base = path.join(home, '.claude', 'projects');
  const variants = new Set<string>([cwd]);
  // Windows drive letters appear in either case depending on how VS Code was launched.
  if (/^[a-zA-Z]:/.test(cwd)) {
    variants.add(cwd[0].toLowerCase() + cwd.slice(1));
    variants.add(cwd[0].toUpperCase() + cwd.slice(1));
  }
  return [...variants].map((v) => path.join(base, encodeCwdForClaude(v)));
}

export function findTranscriptDir(cwd: string): string | undefined {
  return transcriptDirCandidates(cwd).find((d) => fs.existsSync(d));
}

export function findTranscriptFile(cwd: string, sessionId: string): string | undefined {
  for (const dir of transcriptDirCandidates(cwd)) {
    const file = path.join(dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

/** Map Anthropic-API-style message content (string | block array) to protocol blocks. */
export function mapApiContent(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ kind: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const b of content as Array<Record<string, unknown>>) {
    if (!b || typeof b !== 'object') continue;
    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string' && b.text.trim()) blocks.push({ kind: 'text', text: b.text });
        break;
      case 'thinking':
        if (typeof b.thinking === 'string' && b.thinking.trim()) {
          blocks.push({ kind: 'thinking', text: b.thinking });
        }
        break;
      case 'tool_use':
        blocks.push({
          kind: 'tool_use',
          toolUseId: String(b.id ?? ''),
          tool: String(b.name ?? 'tool'),
          input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
        });
        break;
      case 'tool_result': {
        let text = '';
        if (typeof b.content === 'string') text = b.content;
        else if (Array.isArray(b.content)) {
          text = (b.content as Array<Record<string, unknown>>)
            .map((c) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : ''))
            .filter(Boolean)
            .join('\n');
        }
        blocks.push({
          kind: 'tool_result',
          toolUseId: String(b.tool_use_id ?? ''),
          isError: Boolean(b.is_error),
          text: truncate(text, 4000),
        });
        break;
      }
    }
  }
  return blocks;
}

/** Parse one transcript JSONL line into a protocol chat message (or null for meta lines). */
export function parseTranscriptLine(line: string, sessionId: string): ChatMessage | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || (obj.type !== 'user' && obj.type !== 'assistant')) return null;
  const message = obj.message as Record<string, unknown> | undefined;
  const blocks = mapApiContent(message?.content);
  if (blocks.length === 0) return null;
  return {
    uuid: typeof obj.uuid === 'string' ? obj.uuid : uuid(),
    sessionId,
    role: obj.type === 'assistant' ? 'assistant' : 'user',
    blocks,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
  };
}

/** Last `limit` renderable messages of a transcript file, in chronological order. */
export function readBacklog(file: string, sessionId: string, limit: number): ChatMessage[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: ChatMessage[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const m = parseTranscriptLine(lines[i], sessionId);
    if (m) out.unshift(m);
  }
  return out;
}

export interface ExternalSessionListing {
  id: string;
  file: string;
  mtimeMs: number;
  title?: string;
}

/** Recent external (official panel / CLI) sessions for a workspace, newest first. */
export function listExternalSessions(cwd: string, limit = 15): ExternalSessionListing[] {
  const dir = findTranscriptDir(cwd);
  if (!dir) return [];
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const items: ExternalSessionListing[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      items.push({ id: f.slice(0, -'.jsonl'.length), file: full, mtimeMs: fs.statSync(full).mtimeMs });
    } catch {
      /* file vanished between readdir and stat */
    }
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = items.slice(0, limit);
  for (const item of top) item.title = firstUserText(item.file);
  return top;
}

/** First real user prompt in a transcript, used as a session title. */
function firstUserText(file: string): string | undefined {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return undefined;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.toString('utf8', 0, n).split(/\r?\n/);
    for (const line of lines) {
      const m = parseTranscriptLine(line, 'probe');
      if (!m || m.role !== 'user') continue;
      const textBlock = m.blocks.find((b) => b.kind === 'text');
      if (!textBlock || textBlock.kind !== 'text') continue;
      const text = textBlock.text.trim();
      // Skip harness-injected wrappers (slash command metadata etc.)
      if (text.startsWith('<')) continue;
      return truncate(text.replace(/\s+/g, ' '), 80);
    }
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}
