import { useState } from 'react';
import type { ChatMessage, ChatRole, ContentBlock } from '@shared/protocol';
import { summarizeToolInput } from '@shared/protocol';
import { clamp, prettyJson, toolIcon } from '../format';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="msg-list">
      {messages.map((m) => (
        <Message key={m.uuid} m={m} />
      ))}
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  return (
    <>
      {m.blocks.map((b, i) => (
        <Block key={`${m.uuid}-${i}`} b={b} role={m.role} />
      ))}
    </>
  );
}

function Block({ b, role }: { b: ContentBlock; role: ChatRole }) {
  switch (b.kind) {
    case 'text':
      return <div className={`bubble ${role === 'user' ? 'user' : 'assistant'}`}>{b.text}</div>;
    case 'thinking':
      return <ThinkingBlock text={b.text} />;
    case 'tool_use':
      return <ToolCallView tool={b.tool} input={b.input} />;
    case 'tool_result':
      return <ToolResultView text={b.text} isError={b.isError} />;
    default:
      return null;
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block" onClick={() => setOpen(!open)}>
      💭 {open ? text : clamp(text.replace(/\s+/g, ' '), 90)}
    </div>
  );
}

export function ToolDetail({ tool, input }: { tool: string; input: Record<string, unknown> }) {
  if (tool === 'Edit') {
    return (
      <div className="mono">
        <div className="muted">{String(input.file_path ?? '')}</div>
        <pre className="diff-old">- {clamp(String(input.old_string ?? ''), 1200)}</pre>
        <pre className="diff-new">+ {clamp(String(input.new_string ?? ''), 1200)}</pre>
      </div>
    );
  }
  if (tool === 'Write') {
    return (
      <div className="mono">
        <div className="muted">{String(input.file_path ?? '')}</div>
        <pre className="diff-new">{clamp(String(input.content ?? ''), 2000)}</pre>
      </div>
    );
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    return (
      <div className="mono">
        <pre style={{ margin: 0 }}>{String(input.command ?? '')}</pre>
        {typeof input.description === 'string' && <div className="muted">{input.description}</div>}
      </div>
    );
  }
  return <pre className="mono" style={{ margin: 0 }}>{clamp(prettyJson(input), 2000)}</pre>;
}

function ToolCallView({ tool, input }: { tool: string; input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-card">
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span>{toolIcon(tool)}</span>
        <span className="tool-name">{tool}</span>
        <span className="tool-summary">{summarizeToolInput(tool, input)}</span>
        <span className="muted">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="tool-body">
          <ToolDetail tool={tool} input={input} />
        </div>
      )}
    </div>
  );
}

function ToolResultView({ text, isError }: { text: string; isError: boolean }) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  if (!trimmed) return null;
  const preview = trimmed.split('\n').slice(0, 3).join('\n');
  const hasMore = trimmed.length > preview.length;
  return (
    <div className="tool-card">
      <div className={`tool-result ${isError ? 'error' : ''}`} onClick={() => setOpen(!open)}>
        <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {open ? clamp(trimmed, 6000) : clamp(preview, 400)}
        </pre>
        {hasMore && <div className="muted">{open ? 'thu gọn ▴' : 'xem thêm ▾'}</div>}
      </div>
    </div>
  );
}
