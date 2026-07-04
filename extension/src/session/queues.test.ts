import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalQueue, QuestionQueue } from './queues';

describe('ApprovalQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const info = { sessionId: 's1', origin: 'hosted' as const, tool: 'Bash', input: { command: 'ls' } };

  it('resolves allow when respond() is called', async () => {
    const events = { onRequest: vi.fn(), onResolved: vi.fn() };
    const q = new ApprovalQueue(events);
    const p = q.request(info, 60_000, 'deny');
    expect(events.onRequest).toHaveBeenCalledOnce();
    const req = events.onRequest.mock.calls[0][0];
    expect(q.respond(req.id, 'allow', 'phone')).toBe(true);
    await expect(p).resolves.toEqual({ behavior: 'allow', by: 'phone', message: undefined });
    expect(events.onResolved).toHaveBeenCalledWith(req.id, 'allow', 'phone');
    expect(q.list()).toHaveLength(0);
  });

  it('falls back to the timeout behavior', async () => {
    const events = { onRequest: vi.fn(), onResolved: vi.fn() };
    const q = new ApprovalQueue(events);
    const p = q.request(info, 5_000, 'deny');
    vi.advanceTimersByTime(5_001);
    const res = await p;
    expect(res.behavior).toBe('deny');
    expect(res.by).toBe('timeout');
  });

  it('ignores double responses', async () => {
    const events = { onRequest: vi.fn(), onResolved: vi.fn() };
    const q = new ApprovalQueue(events);
    const p = q.request(info, 60_000, 'deny');
    const req = events.onRequest.mock.calls[0][0];
    expect(q.respond(req.id, 'deny', 'phone', 'no')).toBe(true);
    expect(q.respond(req.id, 'allow', 'desktop')).toBe(false);
    await expect(p).resolves.toMatchObject({ behavior: 'deny', message: 'no' });
  });

  it('denies when the abort signal fires', async () => {
    const events = { onRequest: vi.fn(), onResolved: vi.fn() };
    const q = new ApprovalQueue(events);
    const ctrl = new AbortController();
    const p = q.request(info, 60_000, 'deny', ctrl.signal);
    ctrl.abort();
    await expect(p).resolves.toMatchObject({ behavior: 'deny', by: 'auto' });
  });
});

describe('QuestionQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const info = {
    sessionId: 's1',
    questions: [{ question: 'A or B?', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }],
  };

  it('returns answers from respond()', async () => {
    const events = { onRequest: vi.fn(), onResolved: vi.fn() };
    const q = new QuestionQueue(events);
    const p = q.request(info, 60_000);
    const req = events.onRequest.mock.calls[0][0];
    q.respond(req.id, [['A']], 'phone');
    await expect(p).resolves.toEqual({ answers: [['A']], by: 'phone' });
  });

  it('returns null answers on timeout', async () => {
    const events = { onRequest: vi.fn(), onResolved: vi.fn() };
    const q = new QuestionQueue(events);
    const p = q.request(info, 5_000);
    vi.advanceTimersByTime(5_001);
    await expect(p).resolves.toEqual({ answers: null, by: 'timeout' });
  });
});
