import { useEffect, useRef } from 'react';
import type { PermissionMode } from '@shared/protocol';
import type { Ctx } from '../App';
import { ApprovalCard, QuestionCard } from '../components/Cards';
import { MessageList } from '../components/Messages';
import PromptInput from '../components/PromptInput';
import { STATUS_LABEL } from '../format';
import { pushHistory } from '../store';

const MODES: Array<{ v: PermissionMode; label: string }> = [
  { v: 'default', label: 'Hỏi quyền (default)' },
  { v: 'acceptEdits', label: 'Tự duyệt sửa file' },
  { v: 'plan', label: 'Plan mode' },
  { v: 'bypassPermissions', label: '⚠ Bỏ qua hỏi quyền' },
];

export default function Chat({
  ctx,
  setViewSession,
}: {
  ctx: Ctx;
  setViewSession: (id: string | null) => void;
}) {
  const { state, send, navigate } = ctx;
  const view = state.sessions.find((s) => s.id === state.viewSessionId) ?? null;
  const viewId = state.viewSessionId ?? '';
  const messages = state.messages[viewId] ?? [];
  const delta = state.delta[viewId] ?? { text: '', thinking: '' };
  const listRef = useRef<HTMLDivElement>(null);

  // Follow the newest content.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, delta.text, delta.thinking]);

  const sendPrompt = (text: string) => {
    send({ type: 'prompt.send', sessionId: view?.source === 'hosted' ? view.id : null, text });
    pushHistory(text);
  };

  const busy = view?.status === 'thinking' || view?.status === 'streaming';
  const approval = state.approvals[0] ?? null;
  const question = state.questions[0] ?? null;

  const connLabel =
    state.conn === 'online' ? 'online' : state.conn === 'connecting' ? 'đang nối…' : 'mất kết nối';

  return (
    <>
      <div className="header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('sessions')} aria-label="Sessions">
          ☰
        </button>
        <div className="title">{view?.title || state.workspaceName || 'Claude Code'}</div>
        {view && <span className={`pill ${view.status}`}>{STATUS_LABEL[view.status] ?? view.status}</span>}
        <span className={`pill ${state.conn}`}>{connLabel}</span>
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('settings')} aria-label="Cài đặt">
          ⚙
        </button>
      </div>

      {view?.source === 'hosted' && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '7px 12px',
            background: 'var(--panel)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <select
            className="input"
            style={{ flex: 1, padding: '7px 10px', fontSize: 13 }}
            value={view.permissionMode ?? 'default'}
            onChange={(e) =>
              send({ type: 'session.setMode', sessionId: view.id, mode: e.target.value as PermissionMode })
            }
          >
            {MODES.map((m) => (
              <option key={m.v} value={m.v}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-deny"
            style={{ padding: '7px 14px', fontSize: 13 }}
            disabled={!busy}
            onClick={() => send({ type: 'session.interrupt', sessionId: view.id })}
          >
            ⏹ Dừng
          </button>
        </div>
      )}

      <div className="content" ref={listRef}>
        {messages.length === 0 && !delta.text && !delta.thinking && (
          <div className="empty">
            {view
              ? 'Chưa có tin nhắn nào trong session này.'
              : 'Gửi prompt đầu tiên để tạo session Claude Code mới trên máy tính của bạn. 🚀'}
          </div>
        )}
        <MessageList messages={messages} />
        {delta.thinking && <div className="thinking-block">{delta.thinking}</div>}
        {delta.text && (
          <div className="msg-list">
            <div className="bubble assistant delta">{delta.text}</div>
          </div>
        )}
      </div>

      <div className="footer">
        {view?.source === 'external' ? (
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <div className="muted" style={{ flex: 1.2 }}>
              Session panel/CLI — chỉ xem
            </div>
            <button
              className="btn btn-ghost"
              onClick={() =>
                send({ type: 'vscode.request', id: String(Date.now()), action: 'claude.openPanel' })
              }
            >
              Mở panel PC
            </button>
            <button
              className="btn btn-primary"
              onClick={() => send({ type: 'session.resume', sessionId: view.claudeSessionId ?? view.id })}
            >
              Resume
            </button>
          </div>
        ) : (
          <PromptInput onSend={sendPrompt} disabled={state.conn !== 'online'} />
        )}
      </div>

      {approval && <ApprovalCard key={approval.id} approval={approval} send={send} />}
      {!approval && question && <QuestionCard key={question.id} question={question} send={send} />}
    </>
  );
}
