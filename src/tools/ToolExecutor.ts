import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import * as cp     from 'child_process';
import { ParsedToolCall, ToolResult } from './ToolRegistry';
import { PendingEdit }                from '../safety/ApprovalService';
import { MemoryPalace }               from '../memory/MemoryPalace';
import { EntryType }                  from '../memory/MemoryEntry';

export interface ToolExecutorOptions {
  onPendingEdit:        (edit: PendingEdit) => Promise<boolean>;
  onDestructiveCommand: (command: string)   => Promise<boolean>;
  memoryPalace?:        MemoryPalace;
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.unplugged']);

export class ToolExecutor {
  constructor(private readonly opts: ToolExecutorOptions) {}

  async execute(call: ParsedToolCall): Promise<ToolResult> {
    try {
      switch (call.toolName) {
        case 'get_active_file':     return this._getActiveFile();
        case 'read_file':           return this._readFile(call.args);
        case 'apply_edit':          return await this._applyEdit(call.args);
        case 'create_file':         return await this._createFile(call.args);
        case 'delete_file':         return await this._deleteFile(call.args);
        case 'run_terminal':        return await this._runTerminal(call.args);
        case 'get_diagnostics':     return this._getDiagnostics(call.args);
        case 'find_symbol':         return await this._findSymbol(call.args);
        case 'list_files':          return await this._listFiles(call.args);
        case 'list_directory_tree': return this._listDirectoryTree(call.args);
        case 'search_codebase':     return await this._searchCodebase(call.args);
        case 'get_selection':       return this._getSelection();
        case 'git_status':          return this._gitStatus();
        case 'git_diff':            return this._gitDiff(call.args);
        case 'get_hover':           return await this._getHover(call.args);
        case 'find_definition':     return await this._findDefinition(call.args);
        case 'find_references':     return await this._findReferences(call.args);
        case 'save_memory':         return this._saveMemory(call.args);
        case 'get_memory':          return this._getMemory(call.args);
        case 'get_graph':           return await this._getGraph();
        default: return { content: `Tool desconhecida: ${call.toolName}` };
      }
    } catch (err) {
      return { content: `Erro ao executar ${call.toolName}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _wsRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  private _abs(rel: string): string {
    return path.isAbsolute(rel) ? rel : path.resolve(this._wsRoot(), rel);
  }

  private _rel(abs: string): string {
    return path.relative(this._wsRoot(), abs);
  }

  // ── Implementações ─────────────────────────────────────────────────────────

  private _getActiveFile(): ToolResult {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return { content: 'Nenhum arquivo aberto.' }; }
    const filePath = editor.document.uri.fsPath;
    let content    = editor.document.getText();
    if (content.length > 10000) { content = content.slice(0, 10000) + '\n[... truncado em 10000 chars]'; }
    return { content: `Arquivo: ${this._rel(filePath)}\n\n${content}` };
  }

  private _readFile(args: Record<string, unknown>): ToolResult {
    const rel = String(args.path ?? '');
    if (!rel) { return { content: 'Erro: parâmetro path obrigatório.' }; }
    const abs = this._abs(rel);
    if (!fs.existsSync(abs)) { return { content: `Arquivo não encontrado: ${rel}` }; }
    let content = fs.readFileSync(abs, 'utf8');
    if (content.length > 20000) { content = content.slice(0, 20000) + '\n[... truncado em 20000 chars]'; }
    return { content };
  }

  private async _applyEdit(args: Record<string, unknown>): Promise<ToolResult> {
    const rel       = String(args.path ?? '');
    const oldString = String(args.old_string ?? '');
    const newString = String(args.new_string ?? '');
    if (!rel || !oldString)   { return { content: 'Erro: path e old_string são obrigatórios.' }; }
    const abs = this._abs(rel);
    if (!fs.existsSync(abs)) { return { content: `Arquivo não encontrado: ${rel}` }; }
    const original = fs.readFileSync(abs, 'utf8');
    const count = (original.split(oldString).length - 1);
    if (count === 0) { return { content: 'Erro: old_string não encontrado no arquivo.' }; }
    if (count > 1)   { return { content: `Erro: old_string não é único — encontrado ${count} vezes.` }; }
    const modified = original.split(oldString).join(newString);
    const approved = await this.opts.onPendingEdit({ path: abs, original, modified });
    if (!approved) { return { content: 'Edição recusada pelo usuário.' }; }
    const edit = new vscode.WorkspaceEdit();
    const uri  = vscode.Uri.file(abs);
    const doc  = await vscode.workspace.openTextDocument(uri);
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
    edit.replace(uri, full, modified);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    return { content: `Edição aplicada em ${rel}` };
  }

  private async _createFile(args: Record<string, unknown>): Promise<ToolResult> {
    const rel     = String(args.path ?? '');
    const content = String(args.content ?? '');
    if (!rel) { return { content: 'Erro: parâmetro path obrigatório.' }; }
    const abs = this._abs(rel);
    if (fs.existsSync(abs)) { return { content: `Erro: arquivo já existe. Use apply_edit para modificar.` }; }
    const approved = await this.opts.onPendingEdit({ path: abs, original: '', modified: content });
    if (!approved) { return { content: 'Criação recusada pelo usuário.' }; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const edit = new vscode.WorkspaceEdit();
    const uri  = vscode.Uri.file(abs);
    edit.createFile(uri, { overwrite: false });
    await vscode.workspace.applyEdit(edit);
    fs.writeFileSync(abs, content, 'utf8');
    return { content: `Arquivo criado: ${rel}` };
  }

  private async _deleteFile(args: Record<string, unknown>): Promise<ToolResult> {
    const rel = String(args.path ?? '');
    if (!rel) { return { content: 'Erro: parâmetro path obrigatório.' }; }
    const abs = this._abs(rel);
    if (!fs.existsSync(abs)) { return { content: `Arquivo não encontrado: ${rel}` }; }
    const approved = await this.opts.onDestructiveCommand(`delete_file: ${rel}`);
    if (!approved) { return { content: 'Deleção recusada.' }; }
    const edit = new vscode.WorkspaceEdit();
    edit.deleteFile(vscode.Uri.file(abs));
    await vscode.workspace.applyEdit(edit);
    return { content: `Arquivo deletado: ${rel}` };
  }

  private async _runTerminal(args: Record<string, unknown>): Promise<ToolResult> {
    const command = String(args.command ?? '');
    if (!command) { return { content: 'Erro: parâmetro command obrigatório.' }; }
    const approved = await this.opts.onDestructiveCommand(command);
    if (!approved) { return { content: 'Comando recusado.' }; }
    const terminal = vscode.window.createTerminal({ name: 'Unplugged' });
    terminal.show(true);
    terminal.sendText(command);
    return { content: `Comando enviado ao terminal: ${command}\n(veja a saída no terminal integrado)` };
  }

  private _getDiagnostics(args: Record<string, unknown>): ToolResult {
    const rel = args.path ? String(args.path) : undefined;
    let diags: vscode.Diagnostic[] = [];

    if (rel) {
      const abs = this._abs(rel);
      diags = vscode.languages.getDiagnostics(vscode.Uri.file(abs));
    } else {
      const all = vscode.languages.getDiagnostics();
      for (const [, d] of all) { diags.push(...d); }
    }

    diags = diags.filter(d =>
      d.severity === vscode.DiagnosticSeverity.Error ||
      d.severity === vscode.DiagnosticSeverity.Warning
    ).slice(0, 50);

    if (!diags.length) { return { content: 'Nenhum diagnóstico encontrado.' }; }

    const lines = diags.map(d => {
      const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERRO' : 'AVISO';
      return `${sev} [${d.source ?? '?'}] ${d.message} (linha ${d.range.start.line + 1})`;
    });
    return { content: lines.join('\n') };
  }

  private async _findSymbol(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = String(args.symbol ?? '');
    if (!symbol) { return { content: 'Erro: parâmetro symbol obrigatório.' }; }
    const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java}', '**/node_modules/**', 200);
    const results: string[] = [];
    const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    for (const uri of files) {
      if (results.length >= 20) { break; }
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const lines   = content.split('\n');
        lines.forEach((line, i) => {
          if (re.test(line) && results.length < 20) {
            results.push(`${this._rel(uri.fsPath)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
          re.lastIndex = 0;
        });
      } catch { /* ignora */ }
    }
    return { content: results.length ? results.join('\n') : `Símbolo "${symbol}" não encontrado.` };
  }

  private async _listFiles(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = String(args.pattern ?? '**/*');
    const files   = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 500);
    if (!files.length) { return { content: `Nenhum arquivo encontrado para: ${pattern}` }; }
    const lines = files.map(f => this._rel(f.fsPath)).sort();
    return { content: lines.join('\n') };
  }

  private _listDirectoryTree(args: Record<string, unknown>): ToolResult {
    const sub     = args.path ? String(args.path) : undefined;
    const root    = sub ? this._abs(sub) : this._wsRoot();
    const lines:  string[] = [];
    let   count   = 0;

    const walk = (dir: string, indent: string) => {
      if (count >= 200) { return; }
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) { return a.isDirectory() ? -1 : 1; }
        return a.name.localeCompare(b.name);
      });
      for (const e of sorted) {
        if (IGNORE_DIRS.has(e.name)) { continue; }
        if (count >= 200) { lines.push(`${indent}[... truncado]`); return; }
        if (e.isDirectory()) {
          lines.push(`${indent}${e.name}/`);
          count++;
          walk(path.join(dir, e.name), indent + '  ');
        } else {
          lines.push(`${indent}${e.name}`);
          count++;
        }
      }
    };

    walk(root, '');
    return { content: lines.join('\n') || 'Diretório vazio.' };
  }

  private async _searchCodebase(args: Record<string, unknown>): Promise<ToolResult> {
    const query   = String(args.query ?? '');
    const pattern = String(args.pattern ?? '**/*.{ts,js,py,go,rs,java,md}');
    if (!query) { return { content: 'Erro: parâmetro query obrigatório.' }; }

    let re: RegExp;
    try   { re = new RegExp(query, 'gi'); }
    catch { re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }

    const files   = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 300);
    const results: string[] = [];

    for (const uri of files) {
      if (results.length >= 30) { break; }
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const lines   = content.split('\n');
        lines.forEach((line, i) => {
          if (re.test(line) && results.length < 30) {
            results.push(`${this._rel(uri.fsPath)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          }
          re.lastIndex = 0;
        });
      } catch { /* ignora */ }
    }

    return { content: results.length ? results.join('\n') : `Nenhum resultado para: ${query}` };
  }

  private _getSelection(): ToolResult {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) { return { content: 'Nenhum texto selecionado.' }; }
    const text  = editor.document.getText(editor.selection);
    const start = editor.selection.start.line + 1;
    const end   = editor.selection.end.line + 1;
    return { content: `Seleção em ${this._rel(editor.document.uri.fsPath)} (linhas ${start}-${end}):\n\n${text}` };
  }

  private _gitStatus(): ToolResult {
    try {
      const out = cp.execSync('git status --short', { cwd: this._wsRoot(), timeout: 5000, stdio: ['pipe','pipe','pipe'] }).toString().trim();
      return { content: out || 'Sem alterações.' };
    } catch (err) {
      return { content: `git status falhou: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private _gitDiff(args: Record<string, unknown>): ToolResult {
    const rel = args.path ? String(args.path) : undefined;
    const cmd = rel ? `git diff HEAD -- "${rel}"` : 'git diff HEAD';
    try {
      let out = cp.execSync(cmd, { cwd: this._wsRoot(), timeout: 10000, stdio: ['pipe','pipe','pipe'] }).toString();
      if (out.length > 10000) { out = out.slice(0, 10000) + '\n[... truncado]'; }
      return { content: out || 'Sem alterações.' };
    } catch (err) {
      return { content: `git diff falhou: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async _getHover(args: Record<string, unknown>): Promise<ToolResult> {
    const rel  = String(args.path ?? '');
    const line = Number(args.line ?? 1) - 1;
    if (!rel) { return { content: 'Erro: parâmetro path obrigatório.' }; }
    const abs = this._abs(rel);
    if (!fs.existsSync(abs)) { return { content: `Arquivo não encontrado: ${rel}` }; }
    try {
      const uri    = vscode.Uri.file(abs);
      const pos    = new vscode.Position(line, 0);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, pos);
      if (!hovers?.length) { return { content: 'Sem hover disponível.' }; }
      const text = hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n');
      return { content: text || 'Sem hover disponível.' };
    } catch {
      return { content: 'Hover não disponível para este arquivo.' };
    }
  }

  private async _findDefinition(args: Record<string, unknown>): Promise<ToolResult> {
    const rel    = String(args.path ?? '');
    const line   = Number(args.line   ?? 1) - 1;
    const column = Number(args.column ?? 1) - 1;
    if (!rel) { return { content: 'Erro: parâmetro path obrigatório.' }; }
    const abs = this._abs(rel);
    if (!fs.existsSync(abs)) { return { content: `Arquivo não encontrado: ${rel}` }; }
    try {
      const uri   = vscode.Uri.file(abs);
      const pos   = new vscode.Position(line, column);
      const locs  = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', uri, pos);
      if (!locs?.length) { return { content: 'Definição não encontrada.' }; }
      const lines = locs.map(l => `${this._rel(l.uri.fsPath)}:${l.range.start.line + 1}`);
      return { content: lines.join('\n') };
    } catch {
      return { content: 'Definição não disponível.' };
    }
  }

  private async _findReferences(args: Record<string, unknown>): Promise<ToolResult> {
    const rel    = String(args.path ?? '');
    const line   = Number(args.line   ?? 1) - 1;
    const column = Number(args.column ?? 1) - 1;
    if (!rel) { return { content: 'Erro: parâmetro path obrigatório.' }; }
    const abs = this._abs(rel);
    if (!fs.existsSync(abs)) { return { content: `Arquivo não encontrado: ${rel}` }; }
    try {
      const uri  = vscode.Uri.file(abs);
      const pos  = new vscode.Position(line, column);
      const locs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, pos);
      if (!locs?.length) { return { content: 'Nenhuma referência encontrada.' }; }
      const lines = locs.slice(0, 30).map(l => `${this._rel(l.uri.fsPath)}:${l.range.start.line + 1}`);
      return { content: lines.join('\n') };
    } catch {
      return { content: 'Referências não disponíveis.' };
    }
  }

  private _saveMemory(args: Record<string, unknown>): ToolResult {
    if (!this.opts.memoryPalace) { return { content: 'Memória não disponível (workspace não aberto).' }; }
    const type  = String(args.type ?? '');
    const title = String(args.title ?? '');
    const content = String(args.content ?? '');
    const validTypes: EntryType[] = ['decision','pattern','risk','event','problem','workflow'];
    if (!validTypes.includes(type as EntryType)) {
      return { content: `Tipo inválido: ${type}. Use: ${validTypes.join(', ')}` };
    }
    if (!title || !content) { return { content: 'Erro: title e content são obrigatórios.' }; }
    const tags = args.tags ? String(args.tags).split(',').map(t => t.trim()).filter(Boolean) : [];
    const id   = this.opts.memoryPalace.nextId(type as EntryType);
    const date = new Date().toISOString().slice(0, 10);
    this.opts.memoryPalace.save({ id, type: type as EntryType, title, content, tags, related: [], date });
    return { content: `Memória salva: [${type}] ${title}` };
  }

  private _getMemory(args: Record<string, unknown>): ToolResult {
    if (!this.opts.memoryPalace) { return { content: 'Memória não disponível (workspace não aberto).' }; }
    const query = String(args.query ?? '');
    if (!query) { return { content: 'Erro: parâmetro query obrigatório.' }; }
    const entries = this.opts.memoryPalace.search(query, 10);
    if (!entries.length) { return { content: 'Nenhuma entrada encontrada.' }; }
    const lines = entries.map(e => {
      const tags = e.tags.length ? `\n  tags: ${e.tags.join(', ')}` : '';
      return `[${e.type}] ${e.title}\n  ${e.content}${tags}`;
    });
    return { content: lines.join('\n\n') };
  }

  private async _getGraph(): Promise<ToolResult> {
    const files = await vscode.workspace.findFiles('src/**/*.{ts,js}', '**/node_modules/**', 50);
    const re    = /from\s+['"]([^'"]+)['"]/g;
    const lines: string[] = [];
    for (const uri of files) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const deps:   string[] = [];
        let   m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) { deps.push(m[1]); }
        re.lastIndex = 0;
        if (deps.length) {
          lines.push(`${this._rel(uri.fsPath)}: ${deps.join(', ')}`);
        }
      } catch { /* ignora */ }
    }
    return { content: lines.length ? lines.join('\n') : 'Grafo vazio.' };
  }
}
