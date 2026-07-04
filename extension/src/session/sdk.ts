/**
 * Thin, defensive layer over @anthropic-ai/claude-agent-sdk.
 *
 * Types are declared locally (structurally) so that an SDK type-surface change
 * cannot break compilation; the shapes below follow the documented API:
 * https://code.claude.com/docs/en/agent-sdk/typescript
 */

export interface SdkUserMessage {
  type: 'user';
  message: { role: 'user'; content: string | Array<Record<string, unknown>> };
  parent_tool_use_id: string | null;
  session_id: string;
}

export type SdkPermissionResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal; decisionReason?: unknown; suggestions?: unknown },
) => Promise<SdkPermissionResult>;

export interface SdkQuery extends AsyncIterable<Record<string, unknown>> {
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
}

export interface SdkModule {
  query(args: {
    prompt: AsyncIterable<SdkUserMessage> | string;
    options: Record<string, unknown>;
  }): SdkQuery;
}

// esbuild (cjs output) rewrites import() into require(), which breaks ESM-only
// packages — this indirection keeps a true dynamic import at runtime.
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;

let cached: SdkModule | undefined;

export async function loadSdk(): Promise<SdkModule> {
  if (cached) return cached;
  const mod = (await dynamicImport('@anthropic-ai/claude-agent-sdk')) as Record<string, unknown>;
  const query = (mod.query ??
    (mod.default as Record<string, unknown> | undefined)?.query) as SdkModule['query'] | undefined;
  if (typeof query !== 'function') {
    throw new Error('query() not found in @anthropic-ai/claude-agent-sdk — incompatible SDK version?');
  }
  cached = { query: query.bind(mod) as SdkModule['query'] };
  return cached;
}
