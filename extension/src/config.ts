import * as vscode from 'vscode';
import type { PermissionMode } from '@shared/protocol';

export interface CompanionConfig {
  port: number;
  bindHost: string;
  autoStart: boolean;
  approvalTimeoutMs: number;
  approvalTimeoutAction: 'deny' | 'allow';
  hookApprovalTimeoutMs: number;
  askUserQuestionStrategy: 'denyWithAnswer' | 'updatedInput';
  defaultPermissionMode: PermissionMode;
  model: string;
  historyLimit: number;
  ntfyUrl: string;
}

export function getConfig(): CompanionConfig {
  const c = vscode.workspace.getConfiguration('mobileCompanion');
  return {
    port: c.get<number>('port', 7777),
    bindHost: c.get<string>('bindHost', '0.0.0.0'),
    autoStart: c.get<boolean>('autoStart', false),
    approvalTimeoutMs: Math.max(10, c.get<number>('approvalTimeoutSeconds', 300)) * 1000,
    approvalTimeoutAction: c.get<'deny' | 'allow'>('approvalTimeoutAction', 'deny'),
    hookApprovalTimeoutMs: Math.max(5, c.get<number>('hookApprovalTimeoutSeconds', 120)) * 1000,
    askUserQuestionStrategy: c.get<'denyWithAnswer' | 'updatedInput'>('askUserQuestionStrategy', 'updatedInput'),
    defaultPermissionMode: c.get<PermissionMode>('defaultPermissionMode', 'default'),
    model: c.get<string>('model', ''),
    historyLimit: Math.max(20, c.get<number>('historyLimit', 200)),
    ntfyUrl: c.get<string>('ntfyUrl', ''),
  };
}
