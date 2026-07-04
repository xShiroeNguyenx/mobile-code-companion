import type {
  ApprovalBehavior,
  ApprovalOrigin,
  ApprovalRequest,
  Question,
  QuestionRequest,
  ResolvedBy,
} from '@shared/protocol';

// Local implementations of uuid/nowIso keep this module vscode-free and testable.
import { nowIso, uuid } from '../util';

// ---------------------------------------------------------------------------
// Approvals (permission prompts — hosted sessions and hook-forwarded ones)
// ---------------------------------------------------------------------------

export interface ApprovalResolution {
  behavior: ApprovalBehavior;
  message?: string;
  by: ResolvedBy;
}

export interface ApprovalQueueEvents {
  onRequest: (req: ApprovalRequest) => void;
  onResolved: (id: string, behavior: ApprovalBehavior, by: ResolvedBy) => void;
}

interface PendingApproval {
  req: ApprovalRequest;
  resolve: (r: ApprovalResolution) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();

  constructor(private events: ApprovalQueueEvents) {}

  request(
    info: {
      sessionId: string;
      origin: ApprovalOrigin;
      tool: string;
      input: Record<string, unknown>;
      decisionReason?: string;
    },
    timeoutMs: number,
    timeoutBehavior: ApprovalBehavior,
    signal?: AbortSignal,
  ): Promise<ApprovalResolution> {
    const req: ApprovalRequest = {
      id: uuid(),
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      ...info,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.finish(req.id, { behavior: timeoutBehavior, by: 'timeout', message: 'No response before timeout.' }),
        timeoutMs,
      );
      this.pending.set(req.id, { req, resolve, timer });
      signal?.addEventListener(
        'abort',
        () => this.finish(req.id, { behavior: 'deny', by: 'auto', message: 'Aborted.' }),
        { once: true },
      );
      this.events.onRequest(req);
    });
  }

  respond(id: string, behavior: ApprovalBehavior, by: ResolvedBy, message?: string): boolean {
    return this.finish(id, { behavior, by, message });
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.req);
  }

  private finish(id: string, res: ApprovalResolution): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(res);
    this.events.onResolved(id, res.behavior, res.by);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Questions (AskUserQuestion — multiple choice)
// ---------------------------------------------------------------------------

export interface QuestionResolution {
  /** One string[] of selected option labels per question; null on timeout/abort. */
  answers: string[][] | null;
  by: ResolvedBy;
}

export interface QuestionQueueEvents {
  onRequest: (req: QuestionRequest) => void;
  onResolved: (id: string, by: ResolvedBy) => void;
}

interface PendingQuestion {
  req: QuestionRequest;
  resolve: (r: QuestionResolution) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class QuestionQueue {
  private pending = new Map<string, PendingQuestion>();

  constructor(private events: QuestionQueueEvents) {}

  request(
    info: { sessionId: string; questions: Question[] },
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<QuestionResolution> {
    const req: QuestionRequest = {
      id: uuid(),
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      ...info,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(req.id, { answers: null, by: 'timeout' }), timeoutMs);
      this.pending.set(req.id, { req, resolve, timer });
      signal?.addEventListener('abort', () => this.finish(req.id, { answers: null, by: 'auto' }), { once: true });
      this.events.onRequest(req);
    });
  }

  respond(id: string, answers: string[][], by: ResolvedBy): boolean {
    return this.finish(id, { answers, by });
  }

  list(): QuestionRequest[] {
    return [...this.pending.values()].map((p) => p.req);
  }

  private finish(id: string, res: QuestionResolution): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(res);
    this.events.onResolved(id, res.by);
    return true;
  }
}
