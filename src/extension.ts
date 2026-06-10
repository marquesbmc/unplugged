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
import { TOOL_SCHEMAS }           from './tools/ToolRegistry';
import { ChatPanel }              from './ui/ChatPanel';
import { ModelManagerPanel }      from './ui/ModelManagerPanel';
import { SettingsPanel }          from './ui/SettingsPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

function _createStatusBar(): vscode.StatusBarItem {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.text    = '$(plug) Unplugged';
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
    statusBar.text = '$(plug) Unplugged';
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
    const gpuLabel = engine.gpuBackend ? engine.gpuBackend.toUpperCase() : 'CPU';
    chatPanel.setStatus(`pronto · ${modelName} · ${gpuLabel}`, 'ready');
    statusBar.text = `$(plug) ${modelName} [${gpuLabel}]`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    chatPanel.setStatus(`Erro ao carregar modelo: ${msg}`, 'error');
    statusBar.text = '$(plug) Unplugged (erro)';
    vscode.window.showErrorMessage(`Unplugged: ${msg}`);
  }
}

function _instructionsTemplate(): string {
  return `# Instruções do Projeto

<!-- O agente lê este arquivo em cada conversa. Seja direto — bullets curtos funcionam melhor que parágrafos. -->
<!-- Use "Ver Code Briefing" para confirmar que o conteúdo está dentro do budget de tokens. -->

## O que é este projeto?

<!-- Qual o propósito principal? Quem usa? Qual problema resolve? -->
<!-- Ex: API REST para gestão de agendamentos de clínicas. Usada por recepcionistas via web app. -->

-

## Stack e tecnologias

<!-- Linguagem principal, frameworks, banco de dados, serviços externos relevantes. -->
<!-- Ex: Node.js + Fastify, PostgreSQL, Redis para cache, deploy na AWS Lambda. -->

-

## Arquitetura

<!-- Como o código está organizado? Quais são os módulos principais e o que cada um faz? -->
<!-- Ex: src/routes/ (endpoints), src/services/ (regras de negócio), src/db/ (queries). -->

-

## Convenções de código

<!-- Padrões que o agente deve seguir ao editar ou criar código neste projeto. -->
<!-- Ex: funções sempre nomeadas em camelCase, sem comentários óbvios, erros sempre tipados. -->

-

## Fluxos importantes

<!-- Descreva os fluxos críticos do sistema que o agente precisa entender antes de editar. -->
<!-- Ex: autenticação usa JWT com refresh token rotativo — nunca invalide o token sem atualizar o refresh. -->

-

## O que NÃO fazer

<!-- Comportamentos que o agente deve evitar neste projeto especificamente. -->
<!-- Ex: não usar any em TypeScript, não commitar direto na main, não alterar migrations existentes. -->

-

## Dependências e integrações externas

<!-- APIs de terceiros, SDKs, serviços que o código consome — com detalhes relevantes. -->
<!-- Ex: Stripe SDK v12 para pagamentos, webhook configurado em /api/stripe/webhook. -->

-

## Estado atual do projeto

<!-- O que está em andamento? Quais partes estão instáveis ou em refactor? -->
<!-- Ex: módulo de relatórios em reescrita — evite editar src/reports/ até a v2 ser mergeada. -->

-
`;
}

function _tutorialsReadmeTemplate(): string {
  return `# Tutoriais do Projeto

<!-- Este README não é lido pelo agente. É um guia para você criar os arquivos de tutorial. -->

Os arquivos desta pasta são injetados automaticamente no contexto do agente quando são
relevantes para a mensagem que você enviou. O agente seleciona no máximo 3 arquivos por
mensagem, com budget total de ~1500 tokens.

## Como o agente escolhe os arquivos

A seleção é feita por pontuação de palavras-chave:

- **Nome do arquivo** contém a palavra da sua mensagem → +2 pontos
- **Primeiras 5 linhas** do arquivo contêm a palavra → +1 ponto
- Arquivos com pontuação zero são ignorados naquela mensagem

**Conclusão prática:** o nome do arquivo é o fator mais importante.
Se você perguntar sobre "autenticação", o arquivo \`autenticacao.md\` será preferido
sobre um arquivo genérico chamado \`misc.md\` mesmo que este tenha conteúdo relevante.

## Convenções de nome

Use kebab-case com palavras que você naturalmente usaria ao perguntar sobre o tema:

\`\`\`
auth-login-jwt.md          → ativado por: "auth", "login", "jwt", "token"
database-queries.md        → ativado por: "database", "query", "queries", "banco"
api-endpoints.md           → ativado por: "api", "endpoint", "route", "rota"
deploy-pipeline.md         → ativado por: "deploy", "pipeline", "CI", "build"
testes-unitarios.md        → ativado por: "teste", "unit", "mock", "coverage"
pagamentos-stripe.md       → ativado por: "pagamento", "stripe", "webhook"
erros-tratamento.md        → ativado por: "erro", "exception", "tratamento"
\`\`\`

## Estrutura recomendada de cada arquivo

As primeiras 5 linhas têm peso extra na seleção — coloque os termos-chave no título e subtítulo.

\`\`\`markdown
# Auth — Login com JWT
<!-- Palavras-chave: autenticacao, login, jwt, token, refresh, sessao -->

## Fluxo
1. POST /auth/login → valida credenciais → retorna access_token (15min) + refresh_token (7d)
2. ...
\`\`\`

## O que colocar em cada tutorial

- Fluxos específicos do sistema (não documentação geral da linguagem)
- Decisões arquiteturais e o motivo por trás delas
- Armadilhas e o que não fazer naquele contexto
- Exemplos de código real do projeto, não exemplos genéricos

## O que NÃO colocar

- Tutoriais genéricos sobre a linguagem (o modelo já sabe TypeScript, Python, etc.)
- Conteúdo que já está em \`instructions.md\`
- Arquivos muito longos — o budget total é ~1500 tokens para até 3 arquivos

## Exemplos de nomes para projetos comuns

**API REST:**
\`auth-jwt.md\` · \`database-models.md\` · \`api-rest-patterns.md\` · \`validacao-inputs.md\`

**Frontend React:**
\`componentes-padrao.md\` · \`estado-global.md\` · \`chamadas-api.md\` · \`testes-react.md\`

**CLI / Scripts:**
\`comandos-cli.md\` · \`configuracao-ambiente.md\` · \`pipeline-build.md\`
`;
}

function _devProfileTemplate(): string {
  return `# Perfil do Desenvolvedor

<!-- O agente usa este arquivo para personalizar o tom, profundidade e estilo das respostas. -->
<!-- Seja honesto — isso ajuda o agente a calibrar o nível de explicação. -->

## Experiência geral

<!-- Quantos anos programando? Quais linguagens domina? Quais ainda está aprendendo? -->
<!-- Ex: 8 anos de backend (Java, Node.js), 1 ano de TypeScript, iniciante em Rust. -->

-

## Experiência neste projeto

<!-- Quanto tempo trabalhando neste projeto? Conhece bem a base de código ou está explorando? -->
<!-- Ex: 6 meses no projeto, conheço bem o módulo de auth mas pouco o de relatórios. -->

-

## Como prefiro receber respostas

<!-- Respostas curtas e diretas, ou com mais contexto e explicação? -->
<!-- Ex: prefiro respostas curtas com código funcional — só explique o porquê quando não for óbvio. -->

-

## Estilo de código que prefiro

<!-- Funções pequenas, inline ou separadas? Comentários ou nomes autoexplicativos? Tipos explícitos? -->
<!-- Ex: funções pequenas e focadas, sem comentários óbvios, tipos explícitos sempre. -->

-

## O que me trava no dia a dia

<!-- Onde você costuma perder mais tempo? O que mais pede ajuda? -->
<!-- Ex: debugging de race conditions, entender código legado sem documentação, escrever testes. -->

-

## O que não quero que o agente faça

<!-- Comportamentos que te irritam ou atrapalham o seu fluxo de trabalho. -->
<!-- Ex: não refatore código que não pedi, não sugira bibliotecas externas sem motivo forte. -->

-

## Contexto atual

<!-- No que você está trabalhando agora? Qual é o objetivo desta semana/sprint? -->
<!-- Ex: implementando exportação de relatórios em PDF, prazo sexta-feira. -->

-
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

      const tutReadmePath = path.join(tutorialsDir, 'README.md');
      fs.mkdirSync(tutorialsDir, { recursive: true });
      if (!fs.existsSync(instrPath))      { fs.writeFileSync(instrPath,      _instructionsTemplate(),   'utf8'); }
      if (!fs.existsSync(profilePath))    { fs.writeFileSync(profilePath,    _devProfileTemplate(),     'utf8'); }
      if (!fs.existsSync(tutReadmePath))  { fs.writeFileSync(tutReadmePath,  _tutorialsReadmeTemplate(), 'utf8'); }

      svc.ctxGen.invalidateCache();
      svc.scanner.invalidateCache();

      chatPanel.addMessage('tool', 'Workspace indexado. Edite .unplugged/instructions.md para personalizar o comportamento do agente.');
      vscode.window.showInformationMessage('Unplugged: workspace preparado.');
    }),

    vscode.commands.registerCommand('unplugged.showBriefing', async () => {
      const briefing = optimizer.build({ task: '' });

      const userPromptPath    = wsRoot ? path.join(wsRoot, '.unplugged', 'system-prompt.md') : null;
      const bundledPromptPath = path.join(extRoot, 'resources', 'system-prompt.md');
      const promptFile = (userPromptPath && fs.existsSync(userPromptPath))
        ? userPromptPath : bundledPromptPath;
      let systemPromptText = '_(não encontrado)_';
      try { systemPromptText = fs.readFileSync(promptFile, 'utf8').trim(); } catch {}

      let instructionsText = '_(arquivo não encontrado — execute **Indexar Workspace** para criar)_';
      if (wsRoot) {
        try {
          const t = fs.readFileSync(path.join(wsRoot, '.unplugged', 'instructions.md'), 'utf8').trim();
          instructionsText = t || '_(arquivo vazio)_';
        } catch {}
      }

      let profileText = '_(arquivo não encontrado — execute **Indexar Workspace** para criar)_';
      if (wsRoot) {
        try {
          const t = fs.readFileSync(path.join(wsRoot, '.unplugged', 'dev-profile.md'), 'utf8').trim();
          profileText = t || '_(arquivo vazio)_';
        } catch {}
      }

      const statusTable = briefing.status
        .map(s => `| ${s.icon} | ${s.label} | ${s.detail} |`)
        .join('\n');

      const toolList = TOOL_SCHEMAS
        .map(t => `\`${t.function.name}\``)
        .join(' · ');

      const budget = vscode.workspace.getConfiguration('unplugged').get<number>('contextBudget') ?? 6000;

      const content = [
        '# Code Briefing — Unplugged',
        '',
        '> Este documento mostra **exatamente o que o modelo vai receber** na próxima mensagem.',
        '> Edite os arquivos indicados em cada seção para melhorar a qualidade das respostas.',
        '',
        '---',
        '',
        '## Resumo de tokens',
        '',
        `**Total de contexto de código:** ~${briefing.tokenEstimate} / ${budget} tokens`,
        '',
        '| Status | Camada | Detalhe |',
        '|--------|--------|---------|',
        statusTable || '| — | (nenhuma seção) | — |',
        '',
        '---',
        '',
        '## System Prompt',
        '',
        '> Arquivo: `resources/system-prompt.md` (crie `.unplugged/system-prompt.md` no projeto para sobrescrever).',
        '> Não conta no budget acima — é enviado separadamente ao modelo.',
        '',
        systemPromptText,
        '',
        '---',
        '',
        '## Instruções do Projeto',
        '',
        '> Arquivo: `.unplugged/instructions.md`',
        '> Descreva aqui: arquitetura do projeto, convenções de código, o que o agente **não** deve fazer.',
        '',
        instructionsText,
        '',
        '---',
        '',
        '## Perfil do Desenvolvedor',
        '',
        '> Arquivo: `.unplugged/dev-profile.md`',
        '> Descreva aqui: sua experiência, linguagens preferidas, estilo de resposta esperado.',
        '',
        profileText,
        '',
        '---',
        '',
        '## Contexto de código (dentro do budget de 6000 tokens)',
        '',
        briefing.text || '_(nenhuma seção incluída — abra um arquivo no editor ou configure o workspace)_',
        '',
        '---',
        '',
        '## Ferramentas disponíveis ao modelo (20)',
        '',
        toolList,
      ].join('\n');

      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
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

    vscode.commands.registerCommand('unplugged.openSettings', () => {
      SettingsPanel.open(engine, context.extensionUri, () => _loadModel(engine, chatPanel, statusBar));
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
