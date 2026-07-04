export function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'vừa xong';
  if (secs < 3600) return `${Math.floor(secs / 60)} phút trước`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} giờ trước`;
  return `${Math.floor(secs / 86400)} ngày trước`;
}

export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export const STATUS_LABEL: Record<string, string> = {
  idle: 'Sẵn sàng',
  thinking: 'Đang suy nghĩ…',
  streaming: 'Đang trả lời…',
  awaiting_approval: 'Chờ duyệt quyền',
  awaiting_answer: 'Chờ bạn trả lời',
  error: 'Lỗi',
  closed: 'Đã đóng',
};

export const TOOL_ICON: Record<string, string> = {
  Bash: '💻',
  PowerShell: '💻',
  Read: '📖',
  Write: '📝',
  Edit: '✏️',
  Glob: '🔍',
  Grep: '🔍',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Agent: '🤖',
  Task: '🤖',
  TodoWrite: '📋',
  AskUserQuestion: '❓',
};

export function toolIcon(tool: string): string {
  return TOOL_ICON[tool] ?? '🔧';
}
