"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/smoke.entry.ts
var import_ws2 = __toESM(require("ws"));

// ../shared/src/protocol.ts
function parseClientMessage(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.type === "string") return obj;
  } catch {
  }
  return null;
}
function summarizeToolInput(tool, input) {
  const s = (v) => typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return s(input.command);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return s(input.file_path ?? input.notebook_path);
    case "Glob":
    case "Grep":
      return s(input.pattern);
    case "WebFetch":
    case "WebSearch":
      return s(input.url ?? input.query);
    case "Agent":
    case "Task":
      return s(input.description ?? input.prompt).slice(0, 120);
    default: {
      const json = JSON.stringify(input);
      return json.length > 160 ? json.slice(0, 157) + "\u2026" : json;
    }
  }
}

// src/broadcaster.ts
var Broadcaster = class {
  constructor(historyLimit) {
    this.historyLimit = historyLimit;
  }
  historyLimit;
  sinks = /* @__PURE__ */ new Set();
  history = /* @__PURE__ */ new Map();
  addSink(sink) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
  broadcast(msg) {
    if (msg.type === "chat.message") this.remember(msg.message);
    for (const sink of [...this.sinks]) {
      try {
        sink(msg);
      } catch {
      }
    }
  }
  getHistory(sessionId) {
    return this.history.get(sessionId) ?? [];
  }
  dropSession(sessionId) {
    this.history.delete(sessionId);
  }
  remember(m) {
    const arr = this.history.get(m.sessionId) ?? [];
    arr.push(m);
    const limit = this.historyLimit();
    if (arr.length > limit) arr.splice(0, arr.length - limit);
    this.history.set(m.sessionId, arr);
  }
};

// src/util.ts
var crypto = __toESM(require("crypto"));
function uuid() {
  return crypto.randomUUID();
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function truncate(s, max) {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "\u2026" : s;
}

// src/hooks/hookBridge.ts
var HookBridge = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  async handle(body) {
    const b = body ?? {};
    const event = String(b.hook_event_name ?? "");
    switch (event) {
      case "PermissionRequest":
        return this.onPermissionRequest(b);
      case "Notification": {
        const text = String(b.message ?? b.notification?.message ?? "Claude Code c\u1EA7n ch\xFA \xFD");
        this.notify("permission", "Claude Code", text, b.session_id);
        return {};
      }
      case "Stop": {
        this.notify("stop", "Claude \u0111\xE3 xong (session ngo\xE0i)", "Session b\xEAn panel/CLI \u0111\xE3 d\u1EEBng ho\u1EB7c \u0111ang ch\u1EDD l\u1EC7nh ti\u1EBFp.", b.session_id);
        return {};
      }
      default:
        this.deps.log(`hook: ignored event "${event}"`);
        return {};
    }
  }
  async onPermissionRequest(b) {
    const nested = b.permission_request ?? {};
    const tool = String(b.tool_name ?? nested.tool_name ?? "unknown");
    const input = b.tool_input ?? nested.input ?? nested.tool_input ?? {};
    const sessionId = String(b.session_id ?? "external");
    const cfg = this.deps.getConfig();
    this.deps.ntfy("C\u1EA7n duy\u1EC7t quy\u1EC1n (panel ch\xEDnh th\u1EE9c)", `${tool}: ${truncate(summarizeToolInput(tool, input), 300)}`);
    const res = await this.deps.approvals.request(
      { sessionId, origin: "hook", tool, input, decisionReason: "T\u1EEB session Claude Code b\xEAn ngo\xE0i (panel/CLI)" },
      cfg.hookApprovalTimeoutMs,
      "deny"
    );
    if (res.by === "timeout") {
      this.deps.log(`hook approval for ${tool} timed out \u2014 falling back to desktop dialog`);
      return {};
    }
    const decision = res.behavior === "allow" ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: res.message || "Denied from Mobile Code Companion." };
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision
      }
    };
  }
  notify(kind, title, body, sessionId) {
    this.deps.broadcaster.broadcast({
      type: "notification",
      notification: {
        kind,
        title,
        body,
        sessionId: typeof sessionId === "string" ? sessionId : void 0
      }
    });
    this.deps.ntfy(title, body);
  }
};

// src/server/auth.ts
var crypto2 = __toESM(require("crypto"));
var TOKEN_KEY = "mobileCompanion.pairToken";
var AuthManager = class {
  constructor(state) {
    this.state = state;
  }
  state;
  getToken() {
    let token = this.state.get(TOKEN_KEY);
    if (!token) {
      token = crypto2.randomBytes(24).toString("base64url");
      void this.state.update(TOKEN_KEY, token);
    }
    return token;
  }
  /** Invalidates every paired device. */
  regenerate() {
    const token = crypto2.randomBytes(24).toString("base64url");
    void this.state.update(TOKEN_KEY, token);
    return token;
  }
  verify(token) {
    if (!token) return false;
    const a = Buffer.from(String(token));
    const b = Buffer.from(this.getToken());
    return a.length === b.length && crypto2.timingSafeEqual(a, b);
  }
};

// src/server/httpServer.ts
var fs = __toESM(require("fs"));
var http = __toESM(require("http"));
var path = __toESM(require("path"));
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json"
};
function createHttpServer(deps) {
  return http.createServer((req, res) => {
    void route(req, res, deps).catch((err) => {
      deps.log(`http error: ${err}`);
      if (!res.headersSent) res.writeHead(500);
      res.end("internal error");
    });
  });
}
async function route(req, res, deps) {
  const url = new URL(req.url ?? "/", "http://local");
  if (req.method === "POST" && url.pathname === "/hook") {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("hooks are accepted from localhost only");
      return;
    }
    const body = await readBody(req, 1024 * 1024);
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
    }
    const out = await deps.handleHook(parsed);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out ?? {}));
    return;
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: "mobile-code-companion", version: deps.version }));
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  serveStatic(url.pathname, res, deps);
}
function isLoopback(addr) {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function serveStatic(pathname, res, deps) {
  if (!fs.existsSync(deps.webRoot)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end('Web app not built yet. Run "npm run build" at the repo root (webapp-dist missing).');
    return;
  }
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const root = path.normalize(deps.webRoot + path.sep);
  const file = path.normalize(path.join(deps.webRoot, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(deps.webRoot, "index.html");
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "no-cache"
  });
  fs.createReadStream(target).pipe(res);
}

// src/server/wsServer.ts
var import_ws = require("ws");
var WsGateway = class {
  constructor(server, deps) {
    this.deps = deps;
    this.wss = new import_ws.WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://local");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, url));
    });
    this.heartbeat = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 3e4);
  }
  deps;
  wss;
  clients = /* @__PURE__ */ new Set();
  heartbeat;
  get clientCount() {
    return this.clients.size;
  }
  dispose() {
    clearInterval(this.heartbeat);
    for (const ws of this.clients) ws.terminate();
    this.clients.clear();
    this.wss.close();
  }
  onConnection(ws, url) {
    ws.isAlive = true;
    ws.on("pong", () => ws.isAlive = true);
    let authed = false;
    let removeSink;
    const reply = (m) => {
      if (ws.readyState === import_ws.WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    const authenticate = (token) => {
      if (this.deps.auth.verify(token)) {
        authed = true;
        this.clients.add(ws);
        removeSink = this.deps.addSink(reply);
        reply({ type: "auth.result", ok: true });
        this.deps.onAuthed(reply);
        this.deps.onClientCountChanged?.(this.clients.size);
      } else {
        reply({ type: "auth.result", ok: false, reason: "invalid token" });
        ws.close(4001, "unauthorized");
      }
    };
    const queryToken = url.searchParams.get("token");
    if (queryToken) authenticate(queryToken);
    ws.on("message", (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) return;
      if (msg.type === "auth") {
        if (!authed) authenticate(msg.token);
        return;
      }
      if (!authed) {
        reply({ type: "error", message: "not authenticated" });
        return;
      }
      if (msg.type === "ping") {
        reply({ type: "pong" });
        return;
      }
      void this.deps.onClientMessage(msg, reply);
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      removeSink?.();
      this.deps.onClientCountChanged?.(this.clients.size);
    });
    ws.on("error", (err) => this.deps.log(`ws error: ${err}`));
  }
};

// src/session/queues.ts
var ApprovalQueue = class {
  constructor(events) {
    this.events = events;
  }
  events;
  pending = /* @__PURE__ */ new Map();
  request(info, timeoutMs, timeoutBehavior, signal) {
    const req = {
      id: uuid(),
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      ...info
    };
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.finish(req.id, { behavior: timeoutBehavior, by: "timeout", message: "No response before timeout." }),
        timeoutMs
      );
      this.pending.set(req.id, { req, resolve, timer });
      signal?.addEventListener(
        "abort",
        () => this.finish(req.id, { behavior: "deny", by: "auto", message: "Aborted." }),
        { once: true }
      );
      this.events.onRequest(req);
    });
  }
  respond(id, behavior, by, message) {
    return this.finish(id, { behavior, by, message });
  }
  list() {
    return [...this.pending.values()].map((p) => p.req);
  }
  finish(id, res) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(res);
    this.events.onResolved(id, res.behavior, res.by);
    return true;
  }
};

// src/smoke.entry.ts
var store = /* @__PURE__ */ new Map();
var fakeMemento = {
  get: (k) => store.get(k),
  update: (k, v) => {
    store.set(k, v);
    return Promise.resolve();
  },
  keys: () => [...store.keys()]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
};
var PORT = 7799;
async function main() {
  const auth = new AuthManager(fakeMemento);
  const broadcaster = new Broadcaster(() => 200);
  const approvals = new ApprovalQueue({
    onRequest: (req) => broadcaster.broadcast({ type: "approval.request", approval: req }),
    onResolved: (id, behavior, by) => broadcaster.broadcast({ type: "approval.resolved", id, behavior, by })
  });
  const hookBridge = new HookBridge({
    approvals,
    broadcaster,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getConfig: () => ({ hookApprovalTimeoutMs: 1e4 }),
    ntfy: () => void 0,
    log: (m) => console.log("[log]", m)
  });
  const server = createHttpServer({
    webRoot: `${__dirname}/../webapp-dist`,
    version: "smoke",
    handleHook: (b) => hookBridge.handle(b),
    log: (m) => console.log("[http]", m)
  });
  const gateway = new WsGateway(server, {
    auth,
    log: (m) => console.log("[ws]", m),
    addSink: (s) => broadcaster.addSink(s),
    onAuthed: (reply) => reply({ type: "hello", serverVersion: "smoke", protocolVersion: 1, workspaceName: "smoke" }),
    onClientMessage: (msg) => {
      if (msg.type === "approval.respond") approvals.respond(msg.id, msg.behavior, "phone", msg.message);
    }
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", () => r()));
  const token = auth.getToken();
  let failures = 0;
  const check = (name, ok) => {
    console.log(`${ok ? "\u2705" : "\u274C"} ${name}`);
    if (!ok) failures++;
  };
  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json());
  check("GET /api/health", health.ok === true);
  const index = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  check("GET / serves web app", index.includes("Mobile Code Companion"));
  const badCode = await new Promise((resolve) => {
    const bad = new import_ws2.default(`ws://127.0.0.1:${PORT}/ws?token=wrong`);
    bad.on("close", (code) => resolve(code));
    bad.on("error", () => void 0);
  });
  check("wrong token rejected (4001)", badCode === 4001);
  const ws = new import_ws2.default(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
  ws.on("message", (data) => {
    const m = JSON.parse(String(data));
    if (m.type === "approval.request" && m.approval) {
      console.log("   phone saw request:", m.approval.tool, "\u2192", summarizeToolInput(m.approval.tool, m.approval.input));
      ws.send(JSON.stringify({ type: "approval.respond", id: m.approval.id, behavior: "allow" }));
    }
  });
  await new Promise((r) => ws.on("open", r));
  await new Promise((r) => setTimeout(r, 150));
  const hookResponse = await fetch(`http://127.0.0.1:${PORT}/hook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hook_event_name: "PermissionRequest",
      session_id: "external-1",
      tool_name: "Bash",
      tool_input: { command: "npm test" }
    })
  }).then((r) => r.json());
  console.log("   hook response:", JSON.stringify(hookResponse));
  check(
    "hook PermissionRequest \u2192 phone allow \u2192 decision returned",
    hookResponse.hookSpecificOutput?.decision?.behavior === "allow" && hookResponse.hookSpecificOutput?.hookEventName === "PermissionRequest"
  );
  const gotNotification = new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 2e3);
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (m.type === "notification") {
        clearTimeout(t);
        resolve(true);
      }
    });
  });
  await fetch(`http://127.0.0.1:${PORT}/hook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hook_event_name: "Notification", message: "c\u1EA7n ch\xFA \xFD", session_id: "external-1" })
  });
  check("hook Notification fans out to phone", await gotNotification);
  ws.close();
  gateway.dispose();
  server.close();
  console.log(failures === 0 ? "\nSMOKE PASS" : `
SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
