import { useEffect, useState } from 'react';
import type { ApprovalRequest, QuestionRequest } from '@shared/protocol';
import { summarizeToolInput } from '@shared/protocol';
import type { SendFn } from '../App';
import { toolIcon } from '../format';
import { ToolDetail } from './Messages';

function useCountdown(expiresAt: string): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Bottom sheet: allow/deny a permission request. */
export function ApprovalCard({ approval, send }: { approval: ApprovalRequest; send: SendFn }) {
  const [showDeny, setShowDeny] = useState(false);
  const [reason, setReason] = useState('');
  const secsLeft = useCountdown(approval.expiresAt);

  const respond = (behavior: 'allow' | 'deny') =>
    send({
      type: 'approval.respond',
      id: approval.id,
      behavior,
      message: behavior === 'deny' && reason.trim() ? reason.trim() : undefined,
    });

  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <h3>
          {toolIcon(approval.tool)} Claude xin quyền: {approval.tool}
        </h3>
        <div className="muted">
          {approval.origin === 'hook' ? 'Từ session panel/CLI bên ngoài' : 'Từ session hosted'} · còn{' '}
          <span className="countdown">{fmtCountdown(secsLeft)}</span>
          {approval.origin === 'hook' && ' (hết giờ → hỏi trên desktop)'}
        </div>
        {approval.decisionReason && <div className="muted">{approval.decisionReason}</div>}

        <div className="tool-input-box">
          <ToolDetail tool={approval.tool} input={approval.input} />
        </div>

        {!showDeny ? (
          <div className="btn-row">
            <button className="btn btn-deny" onClick={() => setShowDeny(true)}>
              ✗ Từ chối
            </button>
            <button className="btn btn-allow" onClick={() => respond('allow')}>
              ✓ Cho phép
            </button>
          </div>
        ) : (
          <>
            <input
              className="input"
              style={{ marginBottom: 8 }}
              placeholder="Lý do từ chối (tuỳ chọn — Claude sẽ đọc được)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => setShowDeny(false)}>
                Quay lại
              </button>
              <button className="btn btn-deny" onClick={() => respond('deny')}>
                Xác nhận từ chối
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Bottom sheet: answer an AskUserQuestion (single or multi select per question). */
export function QuestionCard({ question, send }: { question: QuestionRequest; send: SendFn }) {
  const [selections, setSelections] = useState<string[][]>(question.questions.map(() => []));
  const secsLeft = useCountdown(question.expiresAt);

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const next = prev.map((arr) => [...arr]);
      const cur = next[qi];
      if (multi) {
        next[qi] = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
      } else {
        next[qi] = [label];
      }
      return next;
    });
  };

  const ready = selections.every((s) => s.length > 0);

  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <h3>❓ Claude đang hỏi bạn</h3>
        <div className="muted">
          còn <span className="countdown">{fmtCountdown(secsLeft)}</span>
        </div>

        {question.questions.map((q, qi) => (
          <div key={qi} style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{q.question}</div>
            {q.multiSelect && <div className="muted">Chọn được nhiều đáp án</div>}
            {q.options.map((o) => {
              const selected = selections[qi]?.includes(o.label);
              return (
                <div
                  key={o.label}
                  className={`option-row ${selected ? 'selected' : ''}`}
                  onClick={() => toggle(qi, o.label, q.multiSelect)}
                >
                  <div>{selected ? '●' : '○'}</div>
                  <div>
                    <div className="opt-label">{o.label}</div>
                    {o.description && <div className="opt-desc">{o.description}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={!ready}
          onClick={() => send({ type: 'question.respond', id: question.id, answers: selections })}
        >
          Gửi câu trả lời
        </button>
      </div>
    </div>
  );
}

/** Compact approval banner used when we only need a one-line summary (unused for now). */
export function approvalSummary(a: ApprovalRequest): string {
  return `${a.tool}: ${summarizeToolInput(a.tool, a.input)}`;
}
