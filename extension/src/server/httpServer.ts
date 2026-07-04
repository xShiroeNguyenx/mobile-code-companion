import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export interface HttpDeps {
  webRoot: string;
  version: string;
  handleHook: (body: unknown) => Promise<unknown>;
  log: (msg: string) => void;
}

export function createHttpServer(deps: HttpDeps): http.Server {
  return http.createServer((req, res) => {
    void route(req, res, deps).catch((err) => {
      deps.log(`http error: ${err}`);
      if (!res.headersSent) res.writeHead(500);
      res.end('internal error');
    });
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, deps: HttpDeps): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');

  if (req.method === 'POST' && url.pathname === '/hook') {
    // Hooks are POSTed by the Claude Code CLI on this machine — never from the LAN.
    if (!isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('hooks are accepted from localhost only');
      return;
    }
    const body = await readBody(req, 1024 * 1024);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      /* keep {} */
    }
    const out = await deps.handleHook(parsed);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out ?? {}));
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: 'mobile-code-companion', version: deps.version }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }

  serveStatic(url.pathname, res, deps);
}

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(pathname: string, res: http.ServerResponse, deps: HttpDeps): void {
  if (!fs.existsSync(deps.webRoot)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Web app not built yet. Run "npm run build" at the repo root (webapp-dist missing).');
    return;
  }
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = path.normalize(deps.webRoot + path.sep);
  const file = path.normalize(path.join(deps.webRoot, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  // SPA fallback: unknown paths serve index.html (hash routing needs it rarely, but be safe).
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(deps.webRoot, 'index.html');
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
}
