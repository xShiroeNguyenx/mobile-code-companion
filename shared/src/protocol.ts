/**
 * Shared protocol between the VS Code extension (server) and the mobile web app (client).
 * Transport: WebSocket, one JSON object per frame.
 */

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'awaiting_approval'
  | 'awaiting_answer'
  | 'error'
  | 'closed';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/** hosted = session run by this extension via the Agent SDK; external = official panel / terminal CLI session (mirrored read-only). */
export type SessionSource = 'hosted' | 'external';

export interface SessionInfo {
  /** Protocol-level id. For hosted sessions this is a local id; for external sessions it is the Claude session UUID. */
  id: string;
  /** Real Claude Code session UUID once known (usable for resume / transcript lookup). */
  claudeSessionId?: string;
  cwd: string;
  source: SessionSource;
  status: SessionStatus;
  title?: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** ISO timestamp */
  lastActiveAt: string;
}

export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; toolUseId: string; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; toolUseId: string; isError: boolean; text: string };

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  uuid: string;
  sessionId: string;
  role: ChatRole;
  blocks: ContentBlock[];
  /** ISO timestamp */
  timestamp: string;
}

export type ApprovalOrigin = 'hosted' | 'hook';
export type ApprovalBehavior = 'allow' | 'deny';
export type ResolvedBy = 'phone' | 'desktop' | 'timeout' | 'auto';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  origin: ApprovalOrigin;
  tool: string;
  input: Record<string, unknown>;
  decisionReason?: string;
  createdAt: string;
  expiresAt: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

export interface QuestionRequest {
  id: string;
  sessionId: string;
  questions: Question[];
  createdAt: string;
  expiresAt: string;
}

export type NotificationKind = 'stop' | 'permission' | 'question' | 'error' | 'info';

export interface CompanionNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// VS Code bridge (phase 3)
// ---------------------------------------------------------------------------

export type VscodeAction =
  | 'workspace.info'
  | 'editors.list'
  | 'file.open'
  | 'saveAll'
  | 'git.status'
  | 'tasks.list'
  | 'tasks.run'
  | 'claude.openPanel';

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface SnapshotPayload {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  /** History of the active session (bounded ring buffer). */
  messages: ChatMessage[];
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
}

export type ServerMessage =
  | { type: 'hello'; serverVersion: string; protocolVersion: number; workspaceName: string }
  | { type: 'auth.result'; ok: boolean; reason?: string }
  | { type: 'snapshot'; snapshot: SnapshotPayload }
  | { type: 'sessions.list'; sessions: SessionInfo[] }
  | { type: 'session.state'; session: SessionInfo }
  | { type: 'session.backlog'; sessionId: string; messages: ChatMessage[] }
  | { type: 'chat.message'; message: ChatMessage }
  | { type: 'chat.delta'; sessionId: string; text: string; thinking?: boolean }
  | { type: 'chat.deltaReset'; sessionId: string }
  | { type: 'approval.request'; approval: ApprovalRequest }
  | { type: 'approval.resolved'; id: string; behavior: ApprovalBehavior; by: ResolvedBy }
  | { type: 'question.request'; question: QuestionRequest }
  | { type: 'question.resolved'; id: string; by: ResolvedBy }
  | { type: 'notification'; notification: CompanionNotification }
  | { type: 'vscode.response'; id: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'auth'; token: string; device?: { name: string } }
  | { type: 'ping' }
  | { type: 'prompt.send'; sessionId: string | null; text: string }
  | { type: 'approval.respond'; id: string; behavior: ApprovalBehavior; message?: string }
  | { type: 'question.respond'; id: string; answers: string[][] }
  | { type: 'session.interrupt'; sessionId: string }
  | { type: 'session.setMode'; sessionId: string; mode: PermissionMode }
  | { type: 'session.new'; cwd?: string }
  | { type: 'session.resume'; sessionId: string }
  | { type: 'session.select'; sessionId: string }
  | { type: 'sessions.refresh' }
  | { type: 'vscode.request'; id: string; action: VscodeAction; args?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers (runtime, dependency-free — safe for both Node and browser)
// ---------------------------------------------------------------------------

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') return obj as ClientMessage;
  } catch {
    /* malformed frame */
  }
  return null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') return obj as ServerMessage;
  } catch {
    /* malformed frame */
  }
  return null;
}

/** One-line human summary of a tool call, used by approval cards and chat rows. */
export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  const s = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v == null) return '';
    return JSON.stringify(v);
  };
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return s(input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return s(input.file_path ?? input.notebook_path);
    case 'Glob':
    case 'Grep':
      return s(input.pattern);
    case 'WebFetch':
    case 'WebSearch':
      return s(input.url ?? input.query);
    case 'Agent':
    case 'Task':
      return s(input.description ?? input.prompt).slice(0, 120);
    default: {
      const json = JSON.stringify(input);
      return json.length > 160 ? json.slice(0, 157) + '…' : json;
    }
  }
}
