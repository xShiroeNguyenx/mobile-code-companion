import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodeCwdForClaude, mapApiContent, parseTranscriptLine, readBacklog } from './transcript';

describe('encodeCwdForClaude', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(encodeCwdForClaude('d:\\NGUYENKHANH\\GLOBAL_WORKSPACE\\mobile-code-companion')).toBe(
      'd--NGUYENKHANH-GLOBAL-WORKSPACE-mobile-code-companion',
    );
    expect(encodeCwdForClaude('/home/user/my project')).toBe('-home-user-my-project');
  });
});

describe('mapApiContent', () => {
  it('maps plain string content to a text block', () => {
    expect(mapApiContent('hello')).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(mapApiContent('   ')).toEqual([]);
  });

  it('maps block arrays', () => {
    const blocks = mapApiContent([
      { type: 'text', text: 'hi' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_use_id: 't1', is_error: false, content: [{ type: 'text', text: 'ok' }] },
      { type: 'unknown-block' },
    ]);
    expect(blocks).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'thinking', text: 'hmm' },
      { kind: 'tool_use', toolUseId: 't1', tool: 'Bash', input: { command: 'ls' } },
      { kind: 'tool_result', toolUseId: 't1', isError: false, text: 'ok' },
    ]);
  });
});

describe('parseTranscriptLine', () => {
  it('parses user/assistant lines and skips meta lines', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      timestamp: '2026-07-03T00:00:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'xin chào' }] },
    });
    const msg = parseTranscriptLine(line, 'sess');
    expect(msg).toMatchObject({ uuid: 'u1', sessionId: 'sess', role: 'assistant' });
    expect(parseTranscriptLine('{"type":"summary"}', 'sess')).toBeNull();
    expect(parseTranscriptLine('not json', 'sess')).toBeNull();
  });
});

describe('readBacklog', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-test-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns the last N messages in chronological order', () => {
    const file = path.join(dir, 'session.jsonl');
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(
        JSON.stringify({
          type: 'user',
          uuid: `u${i}`,
          timestamp: `2026-07-03T00:0${i}:00Z`,
          message: { role: 'user', content: `msg ${i}` },
        }),
      );
    }
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const backlog = readBacklog(file, 'sess', 3);
    expect(backlog.map((m) => m.uuid)).toEqual(['u2', 'u3', 'u4']);
  });
});
