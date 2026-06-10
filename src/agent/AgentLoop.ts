import * as fs     from 'fs';
import * as path   from 'path';
import * as vscode from 'vscode';
import { LlamaEngine }                          from '../llm/LlamaEngine';
import { ToolCallParser }                       from '../llm/ToolCallParser';
import { ToolExecutor }                         from '../tools/ToolExecutor';
import { TOOL_SCHEMAS, ParsedToolCall }         from '../tools/ToolRegistry';
import { LlmContextOptimizer, ContextSection }  from '../context/LlmContextOptimizer';
import { ChatPanel }                            from '../ui/ChatPanel';
import { MessageHistory }                       from './MessageHistory';
import { MemoryPalace }                         from '../memory/MemoryPalace';

const MAX_TOOL_ROUNDS = 10;

function ms(n: number): string { return `${n}ms`; }

export class AgentLoop {
  private _parser  = new ToolCallParser();
  private _running = false;
  private _abort?: AbortController;

  constructor(
    private readonly engine:    LlamaEngine,
    private readonly executor:  ToolExecutor,
    private readonly optimizer: LlmContextOptimizer,
    private readonly chat:      ChatPanel,
    private readonly history:   MessageHistory,
    private readonly extRoot:   string,
    private readonly palace?:   MemoryPalace,
  ) {}

  get isRunning(): boolean { return this._running; }

  abort(): void { this._abort?.abort(); }

  async run(userMessage: string, sections?: ContextSection[]): Promise<void> {
    if (this._running) {
      this.chat.addMessage('system', 'Aguarde a resposta atual terminar.');
      return;
    }
    this._running = true;
    this._abort   = new AbortController();
    // Note: user message is added to history INSIDE _loop, after getting the response,
    // so it is never duplicated as both history entry AND session.prompt() argument.

    try {
      await this._loop(userMessage, sections);
    } finally {
      this._running = false;
      this._abort   = undefined;
    }
  }

  private async _loop(userMessage: string, sections?: ContextSection[]): Promise<void> {
    const tTotal = Date.now();

    this.chat.setStatus('preparando contexto...', 'busy');
    const tCtx = Date.now();
    const { systemPrompt, briefing } = this._buildSystemPrompt(userMessage, sections);
    const ctxMs = Date.now() - tCtx;

    const statusLines = briefing.status
      .map(s => `  ${s.icon} ${s.label.padEnd(12)} ${s.detail}`)
      .join('\n');
    this.chat.addMessage('system', `⚙ Contexto: ~${briefing.tokenEstimate} tokens · ${ms(ctxMs)}\n${statusLines}`);

    let rounds         = 0;
    let totalToolCalls = 0;
    // currentMsg starts as the user's question; becomes tool results for subsequent rounds.
    // History always ends on an 'assistant' turn, so session.prompt(currentMsg) always
    // adds a single clean 'user' turn — no consecutive user turns that break ChatML.
    let currentMsg     = userMessage;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      let responseText = '';
      this.chat.setStatus('gerando...', 'busy');
      this.chat.startStreaming();
      const tLlm = Date.now();

      try {
        for await (const token of this.engine.chat(
          systemPrompt,
          this.history.getAll(),   // always ends on 'assistant' or is empty
          currentMsg,
          this._abort?.signal,
        )) {
          responseText += token;
          this.chat.appendToken(token);
        }
      } catch (err) {
        this.chat.endStreaming();
        const msg = err instanceof Error ? err.message : String(err);
        this.chat.addMessage('system', `Erro LLM: ${msg}`);
        this.chat.setStatus('erro', 'error');
        return;
      }

      this.chat.endStreaming();
      const llmMs = Date.now() - tLlm;

      // Add this round's exchange AFTER the response, not before.
      // This keeps history ending on 'assistant' for the next call.
      this.history.add({ role: 'user',      content: currentMsg });
      this.history.add({ role: 'assistant', content: responseText });

      const toolCalls = this._parser.fromXml(responseText);

      if (!toolCalls.length) {
        this._autoSaveEvent(userMessage, responseText, rounds);
        const totalMs  = Date.now() - tTotal;
        const toolNote = totalToolCalls > 0
          ? `${totalToolCalls} ferramenta(s) · ${rounds} rodada(s)`
          : '⚠ sem ferramentas — resposta baseada no contexto';
        this.chat.addMessage('system',
          `✓ ${ms(totalMs)} · LLM: ${ms(llmMs)} · ctx: ${ms(ctxMs)} · ${toolNote}`
        );
        this.chat.setStatus('pronto', 'ready');
        return;
      }

      this.chat.setStatus(`executando ferramentas... (rodada ${rounds})`, 'busy');

      // Collect all tool results — they become the 'user' input for the next round,
      // so the model receives: [prev history] → user(tool results) → assistant(continuation).
      const toolResultParts: string[] = [];
      for (const call of toolCalls) {
        totalToolCalls++;
        this.chat.addMessage('tool', `→ ${this._formatToolCall(call)}`);
        const tTool  = Date.now();
        const result = await this.executor.execute(call);
        const toolMs = Date.now() - tTool;
        this.chat.addMessage('tool', `← [${ms(toolMs)}] ${this._formatResult(result.content)}`);
        toolResultParts.push(`[RESULTADO: ${call.toolName}]\n${result.content}`);
      }

      currentMsg = toolResultParts.join('\n\n---\n\n');
    }

    this.chat.addMessage('system', `Limite de ${MAX_TOOL_ROUNDS} rodadas de ferramentas atingido.`);
    this.chat.setStatus('limite atingido', 'error');
  }

  private _buildSystemPrompt(
    task: string,
    sections?: ContextSection[],
  ): { systemPrompt: string; briefing: ReturnType<LlmContextOptimizer['build']> } {
    const parts: string[] = [];
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const userPromptPath   = wsRoot ? path.join(wsRoot, '.unplugged', 'system-prompt.md') : null;
    const bundledPromptPath = path.join(this.extRoot, 'resources', 'system-prompt.md');
    const promptFile = (userPromptPath && fs.existsSync(userPromptPath))
      ? userPromptPath
      : bundledPromptPath;

    try { parts.push(fs.readFileSync(promptFile, 'utf8').trim()); }
    catch { parts.push('Você é Unplugged, um agente de desenvolvimento local.'); }

    if (wsRoot) {
      // Workspace root path — lets the model construct absolute paths for terminal commands
      parts.push('', '---', '', `## Workspace\n\nCaminho raiz: \`${wsRoot}\`\n\nUse caminhos relativos à raiz com \`read_file\` (ex: \`src/extension.ts\`).\nPara navegar com terminal, use caminhos absolutos a partir de \`${wsRoot}\`.`);

      const instrPath = path.join(wsRoot, '.unplugged', 'instructions.md');
      try {
        const instr = fs.readFileSync(instrPath, 'utf8').trim();
        if (instr) { parts.push('', '---', '', '## Instruções do Projeto', '', instr); }
      } catch { /* ok */ }

      const profilePath = path.join(wsRoot, '.unplugged', 'dev-profile.md');
      try {
        const profile = fs.readFileSync(profilePath, 'utf8').trim();
        if (profile) { parts.push('', '---', '', '## Perfil do Desenvolvedor', '', profile); }
      } catch { /* ok */ }
    }

    const briefing = this.optimizer.build({ task, sections });
    if (briefing.text) { parts.push('', '---', '', briefing.text); }

    const toolsPrompt = ToolCallParser.buildXmlToolsPrompt(TOOL_SCHEMAS);
    parts.push('', '---', '', toolsPrompt);

    return { systemPrompt: parts.join('\n'), briefing };
  }

  private _formatToolCall(call: ParsedToolCall): string {
    const s = (k: string) => String(call.args[k] ?? '');
    switch (call.toolName) {
      case 'read_file':           return `read_file: ${s('path')}`;
      case 'apply_edit':          return `apply_edit: ${s('path')}`;
      case 'create_file':         return `create_file: ${s('path')}`;
      case 'delete_file':         return `delete_file: ${s('path')}`;
      case 'run_terminal':        return `run_terminal: ${s('command').slice(0, 60)}`;
      case 'list_files':          return `list_files: ${s('pattern')}`;
      case 'search_codebase':     return `search_codebase: "${s('query')}"`;
      case 'find_symbol':         return `find_symbol: "${s('symbol')}"`;
      case 'save_memory':         return `save_memory: [${s('type')}] ${s('title')}`;
      case 'get_memory':          return `get_memory: "${s('query')}"`;
      case 'git_diff':            return `git_diff${call.args.path ? ': ' + s('path') : ''}`;
      default: {
        const first = Object.values(call.args)[0];
        return `${call.toolName}${first !== undefined ? ': ' + String(first).slice(0, 60) : ''}`;
      }
    }
  }

  private _formatResult(content: string): string {
    const lines     = content.split('\n');
    const firstLine = (lines[0] ?? '').trim().slice(0, 80);
    const suffix    = lines.length > 1 ? ` · +${lines.length - 1} linhas` : '';
    return `${firstLine}${suffix}`;
  }

  private _autoSaveEvent(task: string, _response: string, rounds: number): void {
    if (!this.palace || rounds <= 1) { return; }
    try {
      const id      = this.palace.nextId('event');
      const title   = task.length > 80 ? task.slice(0, 80) + '...' : task;
      const content = `Tarefa executada com ${rounds} rodadas de ferramentas.`;
      const date    = new Date().toISOString().slice(0, 10);
      this.palace.save({ id, type: 'event', title, content, tags: ['auto'], related: [], date });
    } catch { /* não bloqueia */ }
  }
}
