import * as fs     from 'fs';
import * as path   from 'path';
import * as vscode from 'vscode';
import { ConfigScanner }         from '../capture/ConfigScanner';
import { TutorialSelector }      from './TutorialSelector';
import { MemoryPalace }          from '../memory/MemoryPalace';

export interface ContextSection {
  label:    string;
  content:  string;
  priority: number;
}

export interface StatusLine {
  icon:   string;
  label:  string;
  detail: string;
}

export interface CodeBriefing {
  text:          string;
  tokenEstimate: number;
  status:        StatusLine[];
}

export interface BuildOptions {
  task?:     string;
  sections?: ContextSection[];
}

const TOKEN_BUDGET = 6000;
const CHARS_PER_TOKEN = 3.5;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export class LlmContextOptimizer {
  constructor(
    private readonly scanner:  ConfigScanner,
    private readonly selector: TutorialSelector,
    private readonly palace?:  MemoryPalace,
  ) {}

  build(opts: BuildOptions): CodeBriefing {
    const wsRoot   = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const task     = opts.task ?? '';
    const sections: ContextSection[] = [];
    const status:   StatusLine[]     = [];

    // 1. Arquivo ativo (priority 100)
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      let content = editor.document.getText();
      const maxChars = Math.floor(2000 * CHARS_PER_TOKEN);
      if (content.length > maxChars) { content = content.slice(0, maxChars) + '\n[... truncado]'; }
      const rel = wsRoot ? path.relative(wsRoot, editor.document.uri.fsPath) : editor.document.uri.fsPath;
      sections.push({ label: 'Arquivo ativo', content: `### Arquivo ativo: ${rel}\n\n${content}`, priority: 100 });
    }

    // 2. Tutoriais relevantes (priority 80)
    if (wsRoot) {
      const tutPaths = this.selector.select(wsRoot, task);
      if (tutPaths.length) {
        const parts = tutPaths.map(p => {
          try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
        }).filter(Boolean);
        if (parts.length) {
          let content = parts.join('\n---\n');
          const maxChars = Math.floor(1500 * CHARS_PER_TOKEN);
          if (content.length > maxChars) { content = content.slice(0, maxChars) + '\n[... truncado]'; }
          sections.push({ label: 'Tutoriais', content: `### Tutoriais do projeto\n\n${content}`, priority: 80 });
        }
      }
    }

    // 3. Memória recente (priority 70)
    if (this.palace) {
      const entries = this.palace.list().slice(0, 5);
      if (entries.length) {
        const lines = entries.map(e => `[${e.type}] ${e.title}\n  ${e.content.slice(0, 200)}`);
        let content = lines.join('\n\n');
        const maxChars = Math.floor(800 * CHARS_PER_TOKEN);
        if (content.length > maxChars) { content = content.slice(0, maxChars) + '\n[... truncado]'; }
        sections.push({ label: 'Memória', content: `### Memória do projeto\n\n${content}`, priority: 70 });
      }
    }

    // 4. Config do projeto (priority 50)
    if (wsRoot) {
      try {
        const info = this.scanner.scan(wsRoot);
        const lines = [`**Linguagem:** ${info.mainLanguage}`];
        if (info.frameworks.length) { lines.push(`**Frameworks:** ${info.frameworks.join(', ')}`); }
        lines.push(`**Package manager:** ${info.packageManager}`);
        if (info.configFiles.length) { lines.push(`**Config files:** ${info.configFiles.join(', ')}`); }
        sections.push({ label: 'Config', content: `### Configuração do projeto\n\n${lines.join('\n')}`, priority: 50 });
      } catch { /* ok */ }
    }

    // 5. Seções adicionais (priority 40)
    if (opts.sections?.length) {
      for (const s of opts.sections) {
        sections.push({ ...s, priority: s.priority ?? 40 });
      }
    }

    // Ordena por prioridade decrescente e aplica budget
    sections.sort((a, b) => b.priority - a.priority);

    const included: string[] = [];
    let usedTokens = 0;

    for (const sec of sections) {
      const tokens = estimateTokens(sec.content);
      if (usedTokens + tokens <= TOKEN_BUDGET) {
        included.push(sec.content);
        usedTokens += tokens;
        status.push({ icon: '✓', label: sec.label, detail: `~${tokens} tokens` });
      } else {
        const remaining = TOKEN_BUDGET - usedTokens;
        if (remaining > 200) {
          const truncated = sec.content.slice(0, Math.floor(remaining * CHARS_PER_TOKEN));
          included.push(truncated + '\n[... truncado por budget]');
          usedTokens += remaining;
          status.push({ icon: '~', label: sec.label, detail: `truncado (${remaining} tokens restantes)` });
        } else {
          status.push({ icon: '✗', label: sec.label, detail: 'cortado (budget esgotado)' });
        }
      }
    }

    const text = included.join('\n\n');
    return { text, tokenEstimate: usedTokens, status };
  }
}
