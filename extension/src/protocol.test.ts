import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage, summarizeToolInput } from '@shared/protocol';

describe('protocol parsing', () => {
  it('accepts objects with a string type', () => {
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseServerMessage('{"type":"pong"}')).toEqual({ type: 'pong' });
  });

  it('rejects malformed frames', () => {
    expect(parseClientMessage('nope')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('{"noType":true}')).toBeNull();
  });
});

describe('summarizeToolInput', () => {
  it('summarizes common tools', () => {
    expect(summarizeToolInput('Bash', { command: 'npm test' })).toBe('npm test');
    expect(summarizeToolInput('Edit', { file_path: 'src/a.ts', old_string: 'x' })).toBe('src/a.ts');
    expect(summarizeToolInput('WebFetch', { url: 'https://x.vn' })).toBe('https://x.vn');
  });

  it('truncates unknown tool inputs', () => {
    const long = { data: 'y'.repeat(500) };
    expect(summarizeToolInput('Mystery', long).length).toBeLessThanOrEqual(160);
  });
});
