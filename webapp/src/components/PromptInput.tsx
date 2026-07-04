import { useRef, useState } from 'react';
import { loadHistory } from '../store';

export default function PromptInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
    setShowHistory(false);
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const toggleMic = () => {
    const w = window as unknown as Record<string, any>;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      alert('Trình duyệt không hỗ trợ nhận dạng giọng nói (cần HTTPS trên đa số trình duyệt).');
      return;
    }
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'vi-VN';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev: any) => {
      const transcript = Array.from(ev.results as ArrayLike<any>)
        .map((r: any) => r[0]?.transcript ?? '')
        .join(' ');
      setText((prev) => (prev ? prev + ' ' : '') + transcript);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };

  const history = loadHistory();

  return (
    <div style={{ position: 'relative' }}>
      {showHistory && history.length > 0 && (
        <div className="history-pop">
          {history.map((h, i) => (
            <div
              key={i}
              className="history-item"
              onClick={() => {
                setText(h);
                setShowHistory(false);
                taRef.current?.focus();
              }}
            >
              {h}
            </div>
          ))}
        </div>
      )}
      <div className="prompt-row">
        {history.length > 0 && (
          <button className="btn btn-ghost btn-icon" onClick={() => setShowHistory(!showHistory)} aria-label="Lịch sử">
            🕘
          </button>
        )}
        <textarea
          ref={taRef}
          className="prompt-input"
          rows={1}
          placeholder={disabled ? 'Mất kết nối…' : 'Ra lệnh cho Claude…'}
          value={text}
          onChange={onInput}
          disabled={disabled}
        />
        <button
          className={`btn btn-ghost btn-icon ${recording ? 'mic-on' : ''}`}
          onClick={toggleMic}
          aria-label="Nói"
        >
          🎤
        </button>
        <button
          className="btn btn-primary btn-icon"
          onClick={submit}
          disabled={disabled || !text.trim()}
          aria-label="Gửi"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
