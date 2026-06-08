import * as path   from 'path';
import * as vscode from 'vscode';

export interface PendingEdit {
  path:     string;
  original: string;
  modified: string;
}

export class ApprovalService {
  async requestEditApproval(edit: PendingEdit): Promise<boolean> {
    const mode = vscode.workspace.getConfiguration('unplugged').get<string>('approvalMode') ?? 'always';
    if (mode === 'destructive-only') { return true; }

    const originalLines = edit.original.split('\n');
    const modifiedLines = edit.modified.split('\n');
    const added   = modifiedLines.filter(l => !originalLines.includes(l)).length;
    const removed = originalLines.filter(l => !modifiedLines.includes(l)).length;

    const choice = await vscode.window.showInformationMessage(
      `Unplugged: Aplicar edição em ${path.basename(edit.path)}? (+${added} / -${removed} linhas)`,
      'Aplicar',
      'Rejeitar',
    );
    return choice === 'Aplicar';
  }

  async requestCommandApproval(command: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Unplugged: Executar comando?\n${command.slice(0, 100)}`,
      'Executar',
      'Cancelar',
    );
    return choice === 'Executar';
  }
}
