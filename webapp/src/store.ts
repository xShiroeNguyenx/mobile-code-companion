import type {
  ApprovalRequest,
  ChatMessage,
  QuestionRequest,
  ServerMessage,
  SessionInfo,
} from '@shared/protocol';

export type ConnStatus = 'disconnected' | 'connecting' | 'online' | 'unauthorized';

export interface Toast {
  id: number;
  kind: string;
  title: string;
  body: string;
}

export interface AppState {
  conn: ConnStatus;
  workspaceName: string;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  /** Session currently displayed by the Chat screen. */
  viewSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  delta: Record<string, { text: string; thinking: string }>;
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  toasts: Toast[];
}

export const initialState: AppState = {
  conn: 'disconnected',
  workspaceName: '',
  sessions: [],
  activeSessionId: null,
  viewSessionId: null,
  messages: {},
  delta: {},
  approvals: [],
  questions: [],
  toasts: [],
};

export type Action =
  | { type: 'conn'; status: ConnStatus }
  | { type: 'server'; msg: ServerMessage }
  | { type: 'view.session'; sessionId: string | null }
  | { type: 'toast.dismiss'; id: number };

let toastSeq = 1;

function appendMessage(state: AppState, m: ChatMessage): AppState {
  const list = state.messages[m.sessionId] ?? [];
  if (list.some((x) => x.uuid === m.uuid)) return state;
  return {
    ...state,
    messages: { ...state.messages, [m.sessionId]: [...list, m] },
    delta: { ...state.delta, [m.sessionId]: { text: '', thinking: '' } },
  };
}

function upsertSession(sessions: SessionInfo[], s: SessionInfo): SessionInfo[] {
  const i = sessions.findIndex((x) => x.id === s.id);
  if (i === -1) return [s, ...sessions];
  const next = [...sessions];
  next[i] = s;
  return next;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'conn':
      return { ...state, conn: action.status };

    case 'view.session':
      return { ...state, viewSessionId: action.sessionId };

    case 'toast.dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    case 'server':
      return onServer(state, action.msg);
  }
}

function onServer(state: AppState, msg: ServerMessage): AppState {
  switch (msg.type) {
    case 'hello':
      return { ...state, workspaceName: msg.workspaceName };

    case 'snapshot': {
      const s = msg.snapshot;
      const messages = { ...state.messages };
      if (s.activeSessionId) messages[s.activeSessionId] = s.messages;
      return {
        ...state,
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
        viewSessionId: state.viewSessionId ?? s.activeSessionId,
        messages,
        approvals: s.approvals,
        questions: s.questions,
      };
    }

    case 'sessions.list':
      return { ...state, sessions: msg.sessions };

    case 'session.state':
      return { ...state, sessions: upsertSession(state.sessions, msg.session) };

    case 'session.backlog':
      return {
        ...state,
        viewSessionId: msg.sessionId,
        messages: { ...state.messages, [msg.sessionId]: msg.messages },
      };

    case 'chat.message':
      return appendMessage(state, msg.message);

    case 'chat.delta': {
      const cur = state.delta[msg.sessionId] ?? { text: '', thinking: '' };
      const next = msg.thinking
        ? { ...cur, thinking: cur.thinking + msg.text }
        : { ...cur, text: cur.text + msg.text };
      return { ...state, delta: { ...state.delta, [msg.sessionId]: next } };
    }

    case 'chat.deltaReset':
      return { ...state, delta: { ...state.delta, [msg.sessionId]: { text: '', thinking: '' } } };

    case 'approval.request':
      if (state.approvals.some((a) => a.id === msg.approval.id)) return state;
      return { ...state, approvals: [...state.approvals, msg.approval] };

    case 'approval.resolved':
      return { ...state, approvals: state.approvals.filter((a) => a.id !== msg.id) };

    case 'question.request':
      if (state.questions.some((q) => q.id === msg.question.id)) return state;
      return { ...state, questions: [...state.questions, msg.question] };

    case 'question.resolved':
      return { ...state, questions: state.questions.filter((q) => q.id !== msg.id) };

    case 'notification': {
      const toast: Toast = {
        id: toastSeq++,
        kind: msg.notification.kind,
        title: msg.notification.title,
        body: msg.notification.body,
      };
      return { ...state, toasts: [...state.toasts.slice(-3), toast] };
    }

    case 'error': {
      const toast: Toast = { id: toastSeq++, kind: 'error', title: 'Lỗi', body: msg.message };
      return { ...state, toasts: [...state.toasts.slice(-3), toast] };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Pairing persistence
// ---------------------------------------------------------------------------

export interface Pairing {
  server: string;
  token: string;
}

const PAIR_KEY = 'mcc.pairing';
const HISTORY_KEY = 'mcc.promptHistory';

export function loadPairing(): Pairing | null {
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pairing;
    return p.server && p.token ? p : null;
  } catch {
    return null;
  }
}

export function savePairing(p: Pairing): void {
  localStorage.setItem(PAIR_KEY, JSON.stringify(p));
}

export function clearPairing(): void {
  localStorage.removeItem(PAIR_KEY);
}

export function loadHistory(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[]).slice(0, 50);
  } catch {
    return [];
  }
}

export function pushHistory(prompt: string): void {
  const list = [prompt, ...loadHistory().filter((p) => p !== prompt)].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
