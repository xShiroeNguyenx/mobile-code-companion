import * as vscode from 'vscode';
import { getConfig } from './config';
import { CompanionCore } from './core';
import { installHooks, uninstallHooks } from './hooks/hookInstaller';
import { disposeLog, log, showLog } from './log';
import { CompanionPanel } from './panel/companionPanel';

let core: CompanionCore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  core = new CompanionCore(context);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'mobileCompanion.showPanel';
  const updateStatusBar = () => {
    if (!core) return;
    statusBar.text = core.isRunning
      ? `$(device-mobile) Mobile: ${getConfig().port} · ${core.clientCount}`
      : '$(device-mobile) Mobile: off';
    statusBar.tooltip = 'Mobile Code Companion — bấm để mở panel ghép nối';
    statusBar.show();
  };
  core.onStateChanged = updateStatusBar;
  updateStatusBar();

  const cmd = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  cmd('mobileCompanion.start', async () => {
    try {
      await core!.start();
      CompanionPanel.createOrShow(core!);
      updateStatusBar();
    } catch (err) {
      void vscode.window.showErrorMessage(`Mobile Companion: không khởi động được server — ${err}`);
      showLog();
    }
  });

  cmd('mobileCompanion.stop', () => {
    core!.stop();
    updateStatusBar();
    void CompanionPanel.current?.refresh();
  });

  cmd('mobileCompanion.showPanel', () => CompanionPanel.createOrShow(core!));

  cmd('mobileCompanion.copyUrl', async () => {
    const link = core!.pairingLink();
    if (!link) {
      void vscode.window.showWarningMessage('Mobile Companion: server chưa chạy. Chạy lệnh "Mobile Companion: Start Server" trước.');
      return;
    }
    await vscode.env.clipboard.writeText(link);
    void vscode.window.showInformationMessage('Đã copy link pairing (link chứa token — chỉ gửi cho thiết bị của bạn).');
  });

  cmd('mobileCompanion.regenerateToken', () => {
    core!.auth.regenerate();
    void vscode.window.showInformationMessage('Đã tạo token mới — mọi thiết bị đã ghép nối trước đó sẽ bị ngắt.');
    void CompanionPanel.current?.refresh();
  });

  cmd('mobileCompanion.newSession', async () => {
    try {
      await core!.newSessionCommand();
      void vscode.window.showInformationMessage('Đã tạo hosted session mới. Gửi prompt từ điện thoại để bắt đầu.');
    } catch (err) {
      void vscode.window.showErrorMessage(`Không tạo được session: ${err}`);
    }
  });

  cmd('mobileCompanion.installHooks', async () => {
    const root = core!.workspaceRoot();
    const pick = await vscode.window.showWarningMessage(
      'Ghi hooks của Mobile Companion vào .claude/settings.local.json của workspace này?\n\n' +
        'Các session Claude Code chạy trong panel chính thức / terminal sẽ gửi yêu cầu duyệt quyền và thông báo tới điện thoại (khi server đang bật). ' +
        'Nếu server tắt hoặc bạn không trả lời kịp, hộp thoại trên desktop vẫn hiện như bình thường.',
      { modal: true },
      'Cài hooks',
    );
    if (pick !== 'Cài hooks') return;
    try {
      const file = installHooks(root, getConfig().port);
      void vscode.window.showInformationMessage(
        `Đã cài hooks vào ${file}. Khởi động lại session Claude Code đang chạy để hooks có hiệu lực.`,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Cài hooks thất bại: ${err}`);
    }
  });

  cmd('mobileCompanion.uninstallHooks', () => {
    try {
      const file = uninstallHooks(core!.workspaceRoot());
      void vscode.window.showInformationMessage(
        file ? `Đã gỡ hooks của Mobile Companion khỏi ${file}.` : 'Không tìm thấy hooks của Mobile Companion trong workspace này.',
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Gỡ hooks thất bại: ${err}`);
    }
  });

  context.subscriptions.push(statusBar, { dispose: () => core?.dispose() });

  if (getConfig().autoStart) {
    try {
      await core.start();
      updateStatusBar();
    } catch (err) {
      log(`autoStart failed: ${err}`);
    }
  }
}

export function deactivate(): void {
  core?.dispose();
  core = undefined;
  disposeLog();
}
