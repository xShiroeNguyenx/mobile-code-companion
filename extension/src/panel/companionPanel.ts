import * as vscode from 'vscode';
import * as QRCode from 'qrcode';
import { summarizeToolInput } from '@shared/protocol';
import type { CompanionCore } from '../core';

/**
 * Desktop webview: pairing QR + server status, plus a minimal mirror of pending
 * approvals/questions so someone at the desk can answer too (first answer wins).
 */
export class CompanionPanel {
  static current: CompanionPanel | undefined;

  static createOrShow(core: CompanionCore): void {
    if (CompanionPanel.current) {
      CompanionPanel.current.panel.reveal();
      void CompanionPanel.current.refresh();
      return;
    }
    CompanionPanel.current = new CompanionPanel(core);
  }

  private panel: vscode.WebviewPanel;
  private removeSink: () => void;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  private constructor(private core: CompanionCore) {
    this.panel = vscode.window.createWebviewPanel(
      'mobileCompanion.panel',
      'Mobile Companion',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.html();
    this.removeSink = core.broadcaster.addSink((msg) => {
      const interesting = [
        'approval.request',
        'approval.resolved',
        'question.request',
        'question.resolved',
        'notification',
        'session.state',
      ];
      if (interesting.includes(msg.type)) this.scheduleRefresh();
    });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m as Record<string, unknown>));
    this.panel.onDidDispose(() => {
      this.removeSink();
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      CompanionPanel.current = undefined;
    });
    void this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 150);
  }

  async refresh(): Promise<void> {
    const link = this.core.pairingLink();
    let qr = '';
    if (link) {
      try {
        qr = await QRCode.toDataURL(link, { margin: 1, width: 280 });
      } catch {
        /* QR generation failure is non-fatal */
      }
    }
    void this.panel.webview.postMessage({
      type: 'state',
      state: {
        running: this.core.isRunning,
        urls: this.core.pairingUrls(),
        link,
        qr,
        clients: this.core.clientCount,
        approvals: this.core.approvals
          .list()
          .map((a) => ({ ...a, summary: summarizeToolInput(a.tool, a.input) })),
        questions: this.core.questions.list(),
        notifications: this.core.recentNotifications,
      },
    });
  }

  private onMessage(m: Record<string, unknown>): void {
    switch (m.cmd) {
      case 'approve':
        this.core.approvals.respond(String(m.id), m.behavior === 'allow' ? 'allow' : 'deny', 'desktop');
        break;
      case 'answer':
        this.core.questions.respond(String(m.id), (m.answers as string[][]) ?? [], 'desktop');
        break;
      case 'copy':
        void vscode.env.clipboard.writeText(String(m.text ?? ''));
        void vscode.window.showInformationMessage('Đã copy link pairing (link chứa token — chỉ gửi cho thiết bị của bạn).');
        break;
      case 'startServer':
        void vscode.commands.executeCommand('mobileCompanion.start');
        break;
      case 'regenToken':
        void vscode.commands.executeCommand('mobileCompanion.regenerateToken');
        break;
    }
  }

  private html(): string {
    // Static shell; all data arrives via postMessage and is rendered client-side.
    return /* html */ `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; max-width: 560px; }
  h2 { margin: 0 0 12px; font-size: 16px; }
  h3 { margin: 18px 0 8px; font-size: 13px; text-transform: uppercase; opacity: .7; letter-spacing: .5px; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border, transparent); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
  .qr { text-align: center; }
  .qr img { border-radius: 8px; background: #fff; padding: 8px; }
  .muted { opacity: .7; font-size: 12px; }
  .url { font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-all; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; margin-right: 6px; margin-top: 6px; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.deny { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: #fff; }
  .tool { font-weight: 600; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  label { display: block; margin: 4px 0; cursor: pointer; }
</style>
</head>
<body>
  <h2>📱 Mobile Code Companion</h2>
  <div id="status" class="card"></div>
  <div id="pairing"></div>
  <div id="approvals"></div>
  <div id="questions"></div>
  <div id="notifications"></div>

<script>
  const vscode = acquireVsCodeApi();
  let state = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'state') { state = e.data.state; render(); }
  });

  function render() {
    if (!state) return;
    document.getElementById('status').innerHTML = state.running
      ? '<span class="pill">ĐANG CHẠY</span> &nbsp;' + state.clients + ' thiết bị đang kết nối'
      : '<span class="pill">TẮT</span> &nbsp;Server chưa chạy. <button onclick="send({cmd:\\'startServer\\'})">Bật server</button>';

    document.getElementById('pairing').innerHTML = state.running ? \`
      <h3>Ghép nối điện thoại</h3>
      <div class="card qr">
        \${state.qr ? '<img src="' + state.qr + '" alt="QR">' : ''}
        <div class="muted" style="margin-top:8px">Quét QR bằng camera điện thoại (cùng Wi-Fi)</div>
        \${state.urls.map(u => '<div class="url">' + esc(u) + '</div>').join('')}
        <button class="secondary" onclick="send({cmd:'copy', text: '\${state.link ?? ''}'})">Copy link pairing</button>
        <button class="secondary" onclick="send({cmd:'regenToken'})">Đổi token</button>
      </div>\` : '';

    const ap = state.approvals || [];
    document.getElementById('approvals').innerHTML = ap.length ? '<h3>Đang chờ duyệt quyền</h3>' + ap.map(a => \`
      <div class="card">
        <div><span class="tool">\${esc(a.tool)}</span> <span class="muted">(\${esc(a.origin === 'hook' ? 'panel/CLI bên ngoài' : 'session hosted')})</span></div>
        <pre>\${esc(a.summary)}</pre>
        <button onclick="send({cmd:'approve', id:'\${a.id}', behavior:'allow'})">✓ Allow</button>
        <button class="deny" onclick="send({cmd:'approve', id:'\${a.id}', behavior:'deny'})">✗ Deny</button>
      </div>\`).join('') : '';

    const qs = state.questions || [];
    document.getElementById('questions').innerHTML = qs.length ? '<h3>Claude đang hỏi</h3>' + qs.map(q => \`
      <div class="card" id="q-\${q.id}">
        \${q.questions.map((qq, qi) => \`
          <div style="margin-bottom:8px">
            <div class="tool">\${esc(qq.question)}</div>
            \${qq.options.map(o => \`<label><input type="\${qq.multiSelect ? 'checkbox' : 'radio'}" name="q-\${q.id}-\${qi}" value="\${esc(o.label)}"> \${esc(o.label)}\${o.description ? ' <span class=muted>— ' + esc(o.description) + '</span>' : ''}</label>\`).join('')}
          </div>\`).join('')}
        <button onclick="answer('\${q.id}', \${q.questions.length})">Gửi câu trả lời</button>
      </div>\`).join('') : '';

    const nt = state.notifications || [];
    document.getElementById('notifications').innerHTML = nt.length ? '<h3>Thông báo gần đây</h3>' + nt.slice().reverse().map(n => \`
      <div class="card"><div class="tool">\${esc(n.title)}</div><div class="muted">\${esc(n.body)}</div></div>\`).join('') : '';
  }

  function answer(id, count) {
    const answers = [];
    for (let qi = 0; qi < count; qi++) {
      const checked = [...document.querySelectorAll('input[name="q-' + id + '-' + qi + '"]:checked')].map(i => i.value);
      answers.push(checked);
    }
    send({ cmd: 'answer', id, answers });
  }

  function send(msg) { vscode.postMessage(msg); }
</script>
</body>
</html>`;
  }
}
