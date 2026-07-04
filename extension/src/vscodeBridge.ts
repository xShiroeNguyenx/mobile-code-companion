import { execFile } from 'child_process';
import * as vscode from 'vscode';
import type { VscodeAction } from '@shared/protocol';

/**
 * Phase 3 — small remote-control surface over VS Code itself.
 * Deliberately narrow: read-mostly actions plus open/save/run-task.
 */
export async function handleVscodeAction(
  action: VscodeAction,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case 'workspace.info':
      return {
        name: vscode.workspace.name ?? null,
        folders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
        activeFile: vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
      };

    case 'editors.list':
      return vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs.map((tab) => ({ label: tab.label, active: tab.isActive })),
      );

    case 'file.open': {
      const rel = String(args.path ?? '');
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root || !rel) throw new Error('missing path or workspace');
      const uri = vscode.Uri.joinPath(root, rel);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const line = Number(args.line ?? 0);
      if (line > 0) {
        const pos = new vscode.Position(line - 1, 0);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(pos, pos);
      }
      return { opened: uri.fsPath };
    }

    case 'saveAll':
      return { saved: await vscode.workspace.saveAll() };

    case 'git.status': {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) throw new Error('no workspace folder');
      const raw = await new Promise<string>((resolve, reject) =>
        execFile('git', ['status', '--porcelain=v1', '-b'], { cwd }, (err, stdout) =>
          err ? reject(err) : resolve(stdout),
        ),
      );
      return { raw };
    }

    case 'tasks.list':
      return (await vscode.tasks.fetchTasks()).map((t) => t.name);

    case 'claude.openPanel': {
      // Official Claude Code panel URI handler; optional prefilled prompt.
      const prompt = String(args.prompt ?? '');
      const uri = vscode.Uri.parse(
        `vscode://anthropic.claude-code/open${prompt ? `?prompt=${encodeURIComponent(prompt)}` : ''}`,
      );
      await vscode.env.openExternal(uri);
      return { opened: true };
    }

    case 'tasks.run': {
      const name = String(args.name ?? '');
      const task = (await vscode.tasks.fetchTasks()).find((t) => t.name === name);
      if (!task) throw new Error(`task not found: ${name}`);
      await vscode.tasks.executeTask(task);
      return { started: name };
    }

    default:
      throw new Error(`unknown action: ${action satisfies never}`);
  }
}
