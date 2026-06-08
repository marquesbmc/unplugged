import { WorkspaceSnapshot } from '../capture/WorkspaceCapture';

export class WakeUpContextGenerator {
  private _lastHash = '';
  private _lastResult = '';

  generate(snapshot: WorkspaceSnapshot): string {
    const hash = JSON.stringify({
      branch:   snapshot.git.branch,
      modified: snapshot.git.modifiedFiles.slice(0, 5),
      lang:     snapshot.config.mainLanguage,
    });

    if (hash === this._lastHash) { return this._lastResult; }

    const lines: string[] = ['## Contexto do Projeto', ''];

    lines.push(`**Linguagem principal:** ${snapshot.config.mainLanguage}`);

    if (snapshot.config.frameworks.length) {
      lines.push(`**Frameworks:** ${snapshot.config.frameworks.join(', ')}`);
    }

    if (snapshot.config.packageManager !== 'unknown') {
      lines.push(`**Package manager:** ${snapshot.config.packageManager}`);
    }

    if (snapshot.git.branch) {
      lines.push(`**Branch atual:** ${snapshot.git.branch}`);
    }

    if (snapshot.git.recentCommits.length) {
      lines.push('**Commits recentes:**');
      for (const c of snapshot.git.recentCommits) {
        lines.push(`- ${c}`);
      }
    }

    if (snapshot.git.modifiedFiles.length) {
      lines.push('**Arquivos modificados:**');
      for (const f of snapshot.git.modifiedFiles.slice(0, 10)) {
        lines.push(`- ${f}`);
      }
    }

    if (snapshot.topFiles.length) {
      lines.push(`**Arquivos principais:** ${snapshot.topFiles.join(', ')}`);
    }

    lines.push(`**Arquivos no workspace:** ~${snapshot.fileCount}`);
    lines.push(`**Ambiente:** ${snapshot.environment.runtimes.join(', ')} · ${snapshot.environment.platform}`);

    const result = lines.join('\n');
    this._lastHash   = hash;
    this._lastResult = result;
    return result;
  }

  invalidateCache(): void {
    this._lastHash   = '';
    this._lastResult = '';
  }
}
