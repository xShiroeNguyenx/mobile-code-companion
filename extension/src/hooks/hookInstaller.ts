import * as fs from 'fs';
import * as path from 'path';

/**
 * Installs/removes our hook entries in <workspace>/.claude/settings.local.json
 * (user-local, normally not committed). Entries are recognized as ours by the
 * loopback /hook URL, so install is idempotent and uninstall is surgical.
 */

export function hookUrl(port: number): string {
  return `http://127.0.0.1:${port}/hook`;
}

function isOurHook(h: unknown): boolean {
  const hook = h as Record<string, unknown> | null;
  return (
    !!hook &&
    hook.type === 'http' &&
    typeof hook.url === 'string' &&
    /^http:\/\/127\.0\.0\.1:\d+\/hook$/.test(hook.url)
  );
}

export function buildHooksConfig(port: number): Record<string, unknown[]> {
  const url = hookUrl(port);
  return {
    PermissionRequest: [{ matcher: '*', hooks: [{ type: 'http', url, timeout: 600 }] }],
    Notification: [{ hooks: [{ type: 'http', url, timeout: 10 }] }],
    Stop: [{ hooks: [{ type: 'http', url, timeout: 10 }] }],
  };
}

type HooksSection = Record<string, unknown>;

function stripOurHooks(hooks: HooksSection): HooksSection {
  const out: HooksSection = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      out[event] = entries;
      continue;
    }
    const kept = entries
      .map((entry) => {
        const e = entry as Record<string, unknown>;
        if (!Array.isArray(e?.hooks)) return entry;
        return { ...e, hooks: e.hooks.filter((h) => !isOurHook(h)) };
      })
      .filter((entry) => {
        const e = entry as Record<string, unknown>;
        return !Array.isArray(e?.hooks) || e.hooks.length > 0;
      });
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

export function mergeHooks(existing: HooksSection, port: number): HooksSection {
  const cleaned = stripOurHooks(existing);
  const ours = buildHooksConfig(port);
  const out: HooksSection = { ...cleaned };
  for (const [event, entries] of Object.entries(ours)) {
    const current = Array.isArray(out[event]) ? (out[event] as unknown[]) : [];
    out[event] = [...current, ...entries];
  }
  return out;
}

function settingsFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.claude', 'settings.local.json');
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function installHooks(workspaceRoot: string, port: number): string {
  const file = settingsFile(workspaceRoot);
  const settings = readJson(file) ?? {};
  settings.hooks = mergeHooks((settings.hooks as HooksSection) ?? {}, port);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return file;
}

export function uninstallHooks(workspaceRoot: string): string | undefined {
  const file = settingsFile(workspaceRoot);
  const settings = readJson(file);
  if (!settings || typeof settings.hooks !== 'object' || !settings.hooks) return undefined;
  const stripped = stripOurHooks(settings.hooks as HooksSection);
  if (Object.keys(stripped).length > 0) settings.hooks = stripped;
  else delete settings.hooks;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return file;
}
