import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('Mobile Code Companion');
  return channel;
}

export function log(message: string): void {
  getChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function showLog(): void {
  getChannel().show(true);
}

export function disposeLog(): void {
  channel?.dispose();
  channel = undefined;
}
