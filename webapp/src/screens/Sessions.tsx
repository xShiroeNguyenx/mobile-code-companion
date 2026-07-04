import { useEffect } from 'react';
import type { SessionInfo } from '@shared/protocol';
import type { Ctx } from '../App';
import { STATUS_LABEL, timeAgo } from '../format';

export default function Sessions({
  ctx,
  setViewSession,
}: {
  ctx: Ctx;
  setViewSession: (id: string | null) => void;
}) {
  const { state, send, navigate } = ctx;

  useEffect(() => {
    send({ type: 'sessions.refresh' });
  }, [send]);

  const open = (s: SessionInfo) => {
    setViewSession(s.id);
    send({ type: 'session.select', sessionId: s.id });
    navigate('chat');
  };

  const resume = (s: SessionInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    send({ type: 'session.resume', sessionId: s.claudeSessionId ?? s.id });
    navigate('chat');
  };

  const newSession = () => {
    send({ type: 'session.new' });
    setViewSession(null);
    navigate('chat');
  };

  const hosted = state.sessions.filter((s) => s.source === 'hosted');
  const external = state.sessions.filter((s) => s.source === 'external');

  const row = (s: SessionInfo) => (
    <div key={s.id} className="session-row" onClick={() => open(s)}>
      <div className="info">
        <div className="t">{s.title || '(chưa có tiêu đề)'}</div>
        <div className="muted">
          {STATUS_LABEL[s.status] ?? s.status} · {timeAgo(s.lastActiveAt)}
        </div>
      </div>
      <span className={`badge ${s.source}`}>{s.source === 'hosted' ? 'hosted' : 'panel/CLI'}</span>
      {s.source === 'external' && (
        <button className="btn btn-ghost" onClick={(e) => resume(s, e)}>
          Resume
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('chat')}>
          ‹
        </button>
        <div className="title">Sessions — {state.workspaceName || 'workspace'}</div>
        <button className="btn btn-ghost btn-icon" onClick={() => send({ type: 'sessions.refresh' })}>
          ↻
        </button>
      </div>
      <div className="content">
        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }} onClick={newSession}>
          ＋ Session mới
        </button>

        {hosted.length > 0 && <div className="section-title">Hosted (điều khiển đầy đủ)</div>}
        {hosted.map(row)}

        {external.length > 0 && (
          <div className="section-title">Panel chính thức / CLI (xem — Resume để điều khiển)</div>
        )}
        {external.map(row)}

        {state.sessions.length === 0 && (
          <div className="empty">Chưa có session nào. Bấm "Session mới" và gửi prompt đầu tiên.</div>
        )}
      </div>
    </>
  );
}
