import * as fs   from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { ApprovalService }        from './safety/ApprovalService';
import { ConfigScanner }          from './capture/ConfigScanner';
import { WakeUpContextGenerator } from './context/WakeUpContextGenerator';
import { TutorialSelector }       from './context/TutorialSelector';
import { MemoryPalace }           from './memory/MemoryPalace';
import { ENTRY_TYPE_LABELS }      from './memory/MemoryEntry';
import { LlmContextOptimizer }    from './context/LlmContextOptimizer';
import { LlamaEngine, LlamaEngineOptions } from './llm/LlamaEngine';
import { MessageHistory }         from './agent/MessageHistory';
import { AgentLoop }              from './agent/AgentLoop';
import { ToolExecutor }           from './tools/ToolExecutor';
import { ChatPanel }              from './ui/ChatPanel';
import { ModelManagerPanel }      from './ui/ModelManagerPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

function _createStatusBar(): vscode.StatusBarItem {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.text    = '$(zap) Unplugged';
  bar.command = 'unplugged.modelManager';
  bar.tooltip = 'Unplugged — clique para gerenciar modelos';
  bar.show();
  return bar;
}

async function _loadModel(
  engine:    LlamaEngine,
  chatPanel: ChatPanel,
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  const cfg       = vscode.workspace.getConfiguration('unplugged');
  const modelPath = cfg.get<string>('modelPath') ?? '';

  if (!modelPath) {
    chatPanel.setStatus('Sem modelo configurado', 'idle');
    statusBar.text = '$(zap) Unplugged';
    return;
  }

  const modelName = path.basename(modelPath, '.gguf');
  chatPanel.setStatus(`carregando ${modelName}...`, 'busy');
  statusBar.text = `$(loading~spin) ${modelName}`;

  try {
    await engine.load({
      modelPath,
      gpu:         cfg.get<string>('gpu') as LlamaEngineOptions['gpu'] ?? 'auto',
      contextSize: cfg.get<number>('contextSize') ?? 8192,
      maxTokens:   cfg.get<number>('maxTokens')   ?? 1024,
      temperature: cfg.get<number>('temperature') ?? 0.2,
    });
    chatPanel.setStatus(`pronto · ${modelName}`, 'ready');
    statusBar.text = `$(zap) ${modelName}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    chatPanel.setStatus(`Erro ao carregar modelo: ${msg}`, 'error');
    statusBar.text = '$(zap) Unplugged (erro)';
    vscode.window.showErrorMessage(`Unplugged: ${msg}`);
  }
}

function _instructionsTemplate(): string {
  return `# Instruções do Projeto

<!-- Edite este arquivo para personalizar o comportamento do Unplugged neste projeto. -->
<!-- O agente lê este arquivo em cada conversa. -->

## Convenções de Código

- (descreva suas convenções aqui)

## Arquitetura

- (descreva a arquitetura do projeto)

## O que NÃO fazer

- (liste comportamentos a evitar)
`;
}

function _devProfileTemplate(): string {
  return `# Perfil do Desenvolvedor

<!-- Descreva quem você é e como prefere trabalhar. O agente usa isso para personalizar respostas. -->

## Experiência

- (ex: 5 anos de TypeScript, novo em Rust)

## Preferências

- (ex: prefiro funções pequenas, sem comentários óbvios)

## Contexto atual

- (ex: trabalhando em refactor do módulo de autenticação)
`;
}

// ── Activation ────────────────────────────────────────────────────────────────

interface Services {
  engine:    LlamaEngine;
  agent:     AgentLoop;
  history:   MessageHistory;
  chatPanel: ChatPanel;
  statusBar: vscode.StatusBarItem;
  palace?:   MemoryPalace;
  optimizer: LlmContextOptimizer;
  scanner:   ConfigScanner;
  ctxGen:    WakeUpContextGenerator;
  executor:  ToolExecutor;
  extRoot:   string;
}

function _registerCommands(
  context:  vscode.ExtensionContext,
  wsRoot:   string | undefined,
  svc:      Services,
): void {
  const { engine, agent, history, chatPanel, statusBar, palace, optimizer, executor, extRoot } = svc;

  context.subscriptions.push(

    vscode.commands.registerCommand('unplugged.openChat', () =>
      vscode.commands.executeCommand('workbench.view.extension.unplugged')
    ),

    vscode.commands.registerCommand('unplugged.abort', () => agent.abort()),

    vscode.commands.registerCommand('unplugged.indexWorkspace', async () => {
      if (!wsRoot) { vscode.window.showErrorMessage('Nenhum workspace aberto.'); return; }

      const unpluggedDir  = path.join(wsRoot, '.unplugged');
      const tutorialsDir  = path.join(unpluggedDir, 'tutorials');
      const instrPath     = path.join(unpluggedDir, 'instructions.md');
      const profilePath   = path.join(unpluggedDir, 'dev-profile.md');

      fs.mkdirSync(tutorialsDir, { recursive: true });
      if (!fs.existsSync(instrPath))  { fs.writeFileSync(instrPath,   _instructionsTemplate(), 'utf8'); }
      if (!fs.existsSync(profilePath)){ fs.writeFileSync(profilePath, _devProfileTemplate(),   'utf8'); }

      svc.ctxGen.invalidateCache();
      svc.scanner.invalidateCache();

      chatPanel.addMessage('tool', 'Workspace indexado. Edite .unplugged/instructions.md para personalizar o comportamento do agente.');
      vscode.window.showInformationMessage('Unplugged: workspace preparado.');
    }),

    vscode.commands.registerCommand('unplugged.showBriefing', async () => {
      const task    = await vscode.window.showInputBox({ prompt: 'Tarefa (opcional)' }) ?? '';
      const briefing = optimizer.build({ task });
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content:  `# Code Briefing\n\n**Tokens:** ~${briefing.tokenEstimate}\n\n---\n\n${briefing.text}`,
      });
      vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    }),

    vscode.commands.registerCommand('unplugged.saveMemory', async () => {
      if (!palace) { vscode.window.showWarningMessage('Unplugged: abra um workspace para usar memória.'); return; }

      const typeLabels = Object.entries(ENTRY_TYPE_LABELS).map(([k, v]) => ({ label: v, id: k }));
      const typePick   = await vscode.window.showQuickPick(typeLabels, { title: 'Tipo de memória' });
      if (!typePick) { return; }

      const title = await vscode.window.showInputBox({ prompt: 'Título', validateInput: v => v ? null : 'Obrigatório' });
      if (!title) { return; }

      const content = await vscode.window.showInputBox({ prompt: 'Conteúdo', validateInput: v => v ? null : 'Obrigatório' });
      if (!content) { return; }

      const type  = typePick.id as import('./memory/MemoryEntry').EntryType;
      const id    = palace.nextId(type);
      const date  = new Date().toISOString().slice(0, 10);
      palace.save({ id, type, title, content, tags: [], related: [], date });
      vscode.window.showInformationMessage(`Unplugged: memória "${title}" salva.`);
    }),

    vscode.commands.registerCommand('unplugged.loadModel', async () => {
      const uris = await vscode.window.showOpenDialog({
        filters:       { 'Modelo GGUF': ['gguf'] },
        canSelectMany: false,
        title:         'Selecionar modelo .gguf',
      });
      if (!uris?.length) { return; }
      await vscode.workspace.getConfiguration('unplugged').update(
        'modelPath', uris[0].fsPath, vscode.ConfigurationTarget.Global,
      );
      // onDidChangeConfiguration dispara _loadModel automaticamente
    }),

    vscode.commands.registerCommand('unplugged.clearHistory', () => {
      history.clear();
      chatPanel.clear();
      chatPanel.setStatus('histórico limpo', 'idle');
    }),

    vscode.commands.registerCommand('unplugged.modelManager', () => {
      ModelManagerPanel.open(engine, context.extensionUri);
    }),

    vscode.commands.registerCommand('unplugged.openInstructions', async () => {
      if (!wsRoot) { return; }
      const p = path.join(wsRoot, '.unplugged', 'instructions.md');
      if (!fs.existsSync(p)) { fs.writeFileSync(p, _instructionsTemplate(), 'utf8'); }
      vscode.window.showTextDocument(await vscode.workspace.openTextDocument(p), { preview: false });
    }),

    vscode.commands.registerCommand('unplugged.openDevProfile', async () => {
      if (!wsRoot) { return; }
      const p = path.join(wsRoot, '.unplugged', 'dev-profile.md');
      if (!fs.existsSync(p)) { fs.writeFileSync(p, _devProfileTemplate(), 'utf8'); }
      vscode.window.showTextDocument(await vscode.workspace.openTextDocument(p), { preview: false });
    }),

    vscode.commands.registerCommand('unplugged._testTool', async () => {
      const tools = [
        'get_active_file', 'list_directory_tree', 'git_status',
        'get_diagnostics', 'search_codebase', 'get_selection',
      ];
      const pick = await vscode.window.showQuickPick(tools.map(t => ({ label: t })));
      if (!pick) { return; }
      const result = await executor.execute({ id: 'test', toolName: pick.label, args: {} });
      chatPanel.addMessage('tool', `[${pick.label}]\n${result.content}`);
      vscode.commands.executeCommand('workbench.view.extension.unplugged');
    }),

  );
}

export function activate(context: vscode.ExtensionContext): void {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const storagePath = wsRoot
    ? path.join(wsRoot, '.unplugged')
    : context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  // Instanciar serviços
  const approval   = new ApprovalService();
  const scanner    = new ConfigScanner();
  const ctxGen     = new WakeUpContextGenerator();
  const extRoot    = context.extensionUri.fsPath;
  const selector   = new TutorialSelector(extRoot);
  const palace     = wsRoot ? new MemoryPalace(wsRoot) : undefined;
  const optimizer  = new LlmContextOptimizer(scanner, selector, palace);
  const engine     = new LlamaEngine();
  const history    = new MessageHistory();
  const chatPanel  = new ChatPanel(context.extensionUri);
  const statusBar  = _createStatusBar();

  const executor = new ToolExecutor({
    onPendingEdit:        edit    => approval.requestEditApproval(edit),
    onDestructiveCommand: command => approval.requestCommandApproval(command),
    memoryPalace:         palace,
  });

  const agent = new AgentLoop(engine, executor, optimizer, chatPanel, history, extRoot, palace);

  // Carregar modelo se configurado
  const cfg       = vscode.workspace.getConfiguration('unplugged');
  const modelPath = cfg.get<string>('modelPath') ?? '';

  if (modelPath) {
    _loadModel(engine, chatPanel, statusBar).catch(err => {
      console.error('[Unplugged] Falha ao carregar modelo:', err);
    });
  } else {
    chatPanel.setStatus('Configure um modelo — use Gerenciador de Modelos', 'idle');
  }

  // Observar mudança de configuração relevante
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('unplugged.modelPath') ||
          e.affectsConfiguration('unplugged.gpu')       ||
          e.affectsConfiguration('unplugged.contextSize')) {
        _loadModel(engine, chatPanel, statusBar).catch(() => {});
      }
    })
  );

  // Registrar ChatPanel como webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.VIEW_ID, chatPanel, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Handler do botão "Ler projeto"
  chatPanel.onReadProject(async () => {
    chatPanel.setStatus('lendo estrutura do projeto...', 'busy');
    try {
      const result = await executor.execute({ id: 'readProject', toolName: 'list_directory_tree', args: {} });
      const msg = `[Estrutura do projeto carregada]\n${result.content}`;
      history.add({ role: 'tool', content: msg });
      chatPanel.addMessage('tool', result.content);
      chatPanel.setStatus('projeto lido — pode perguntar sobre os arquivos', 'ready');
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      chatPanel.addMessage('system', `Erro ao ler projeto: ${m}`);
      chatPanel.setStatus('erro', 'error');
    }
    chatPanel.readProjectDone();
  });

  // Handler de mensagem do usuário
  chatPanel.onUserMessage(text => {
    if (!engine.isLoaded) {
      chatPanel.addMessage(
        'system',
        'Nenhum modelo carregado. Use "Unplugged: Gerenciador de Modelos" para configurar um modelo .gguf.',
      );
      return;
    }
    agent.run(text).catch(err => {
      chatPanel.addMessage('system', 'Erro no agente: ' + (err instanceof Error ? err.message : String(err)));
      chatPanel.setStatus('erro', 'error');
    });
  });

  // Registrar todos os comandos
  const svc: Services = { engine, agent, history, chatPanel, statusBar, palace, optimizer, scanner, ctxGen, executor, extRoot };
  _registerCommands(context, wsRoot, svc);

  // Invalidar caches ao salvar arquivo
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      ctxGen.invalidateCache();
      scanner.invalidateCache();
    })
  );

  // Limpar recursos ao desativar
  context.subscriptions.push(statusBar, chatPanel, {
    dispose: () => engine.dispose().catch(() => {}),
  });
}

export function deactivate(): void {
  // limpo via subscriptions
}
