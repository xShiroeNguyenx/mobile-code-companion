/**
 * Standalone smoke test (no VS Code needed): stands up the real HTTP+WS server,
 * then exercises the core remote-approval loop:
 *   CLI --(POST /hook PermissionRequest)--> server --(ws)--> "phone" --allow--> hook response.
 *
 * Run: node esbuild.smoke.js && node dist-smoke/smoke.cjs
 */
import WebSocket from 'ws';
import { summarizeToolInput } from '@shared/protocol';
import { Broadcaster } from './broadcaster';
import { HookBridge } from './hooks/hookBridge';
import { AuthManager } from './server/auth';
import { createHttpServer } from './server/httpServer';
import { WsGateway } from './server/wsServer';
import { ApprovalQueue } from './session/queues';

const store = new Map<string, unknown>();
const fakeMemento = {
  get: (k: string) => store.get(k),
  update: (k: string, v: unknown) => {
    store.set(k, v);
    return Promise.resolve();
  },
  keys: () => [...store.keys()],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const PORT = 7799;

async function main(): Promise<void> {
  const auth = new AuthManager(fakeMemento);
  const broadcaster = new Broadcaster(() => 200);
  const approvals = new ApprovalQueue({
    onRequest: (req) => broadcaster.broadcast({ type: 'approval.request', approval: req }),
    onResolved: (id, behavior, by) => broadcaster.broadcast({ type: 'approval.resolved', id, behavior, by }),
  });
  const hookBridge = new HookBridge({
    approvals,
    broadcaster,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getConfig: () => ({ hookApprovalTimeoutMs: 10_000 }) as any,
    ntfy: () => undefined,
    log: (m) => console.log('[log]', m),
  });
  const server = createHttpServer({
    webRoot: `${__dirname}/../webapp-dist`,
    version: 'smoke',
    handleHook: (b) => hookBridge.handle(b),
    log: (m) => console.log('[http]', m),
  });
  const gateway = new WsGateway(server, {
    auth,
    log: (m) => console.log('[ws]', m),
    addSink: (s) => broadcaster.addSink(s),
    onAuthed: (reply) =>
      reply({ type: 'hello', serverVersion: 'smoke', protocolVersion: 1, workspaceName: 'smoke' }),
    onClientMessage: (msg) => {
      if (msg.type === 'approval.respond') approvals.respond(msg.id, msg.behavior, 'phone', msg.message);
    },
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
  const token = auth.getToken();
  let failures = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) failures++;
  };

  // 1. health endpoint
  const health = (await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json())) as {
    ok?: boolean;
  };
  check('GET /api/health', health.ok === true);

  // 2. static web app served
  const index = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  check('GET / serves web app', index.includes('Mobile Code Companion'));

  // 3. wrong token is rejected with 4001
  const badCode = await new Promise<number>((resolve) => {
    const bad = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=wrong`);
    bad.on('close', (code) => resolve(code));
    bad.on('error', () => undefined);
  });
  check('wrong token rejected (4001)', badCode === 4001);

  // 4. remote approval round-trip through the hook endpoint
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
  ws.on('message', (data) => {
    const m = JSON.parse(String(data)) as { type: string; approval?: { id: string; tool: string; input: Record<string, unknown> } };
    if (m.type === 'approval.request' && m.approval) {
      console.log('   phone saw request:', m.approval.tool, '→', summarizeToolInput(m.approval.tool, m.approval.input));
      ws.send(JSON.stringify({ type: 'approval.respond', id: m.approval.id, behavior: 'allow' }));
    }
  });
  await new Promise((r) => ws.on('open', r));
  await new Promise((r) => setTimeout(r, 150));

  const hookResponse = (await fetch(`http://127.0.0.1:${PORT}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: 'external-1',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    }),
  }).then((r) => r.json())) as {
    hookSpecificOutput?: { hookEventName?: string; decision?: { behavior?: string } };
  };
  console.log('   hook response:', JSON.stringify(hookResponse));
  check(
    'hook PermissionRequest → phone allow → decision returned',
    hookResponse.hookSpecificOutput?.decision?.behavior === 'allow' &&
      hookResponse.hookSpecificOutput?.hookEventName === 'PermissionRequest',
  );

  // 5. Notification hook fans out to the phone
  const gotNotification = new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 2000);
    ws.on('message', (data) => {
      const m = JSON.parse(String(data)) as { type: string };
      if (m.type === 'notification') {
        clearTimeout(t);
        resolve(true);
      }
    });
  });
  await fetch(`http://127.0.0.1:${PORT}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hook_event_name: 'Notification', message: 'cần chú ý', session_id: 'external-1' }),
  });
  check('hook Notification fans out to phone', await gotNotification);

  ws.close();
  gateway.dispose();
  server.close();
  console.log(failures === 0 ? '\nSMOKE PASS' : `\nSMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
