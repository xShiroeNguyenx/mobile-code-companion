import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildHooksConfig, installHooks, mergeHooks, uninstallHooks } from './hookInstaller';

describe('mergeHooks', () => {
  it('appends our hooks and keeps foreign entries', () => {
    const existing = {
      PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my.sh' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'other.sh' }] }],
    };
    const merged = mergeHooks(existing, 7777);
    expect(merged.PreToolUse).toEqual(existing.PreToolUse);
    const pr = merged.PermissionRequest as any[];
    expect(pr).toHaveLength(2);
    expect(pr[0].hooks[0].command).toBe('my.sh');
    expect(pr[1].hooks[0].url).toBe('http://127.0.0.1:7777/hook');
  });

  it('is idempotent across port changes (replaces our old entries)', () => {
    const once = mergeHooks({}, 7777);
    const twice = mergeHooks(once, 8888);
    const pr = twice.PermissionRequest as any[];
    expect(pr).toHaveLength(1);
    expect(pr[0].hooks[0].url).toBe('http://127.0.0.1:8888/hook');
  });
});

describe('install/uninstall on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-hooks-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes settings.local.json and removes cleanly', () => {
    const file = installHooks(dir, 7777);
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(settings.hooks)).toEqual(expect.arrayContaining(['PermissionRequest', 'Notification', 'Stop']));

    const removedFile = uninstallHooks(dir);
    expect(removedFile).toBe(file);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.hooks).toBeUndefined();
  });

  it('preserves unrelated settings keys', () => {
    const file = path.join(dir, '.claude', 'settings.local.json');
    fs.writeFileSync(file, JSON.stringify({ env: { FOO: 'bar' } }));
    installHooks(dir, 7777);
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(settings.env).toEqual({ FOO: 'bar' });
    expect(settings.hooks.PermissionRequest).toBeDefined();
  });
});

describe('buildHooksConfig', () => {
  it('uses a long timeout only for PermissionRequest', () => {
    const cfg = buildHooksConfig(7777) as any;
    expect(cfg.PermissionRequest[0].hooks[0].timeout).toBe(600);
    expect(cfg.Stop[0].hooks[0].timeout).toBe(10);
  });
});
