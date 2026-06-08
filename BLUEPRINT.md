# Unplugged — Blueprint Técnico Completo

> Documento autocontido para construção do zero.  
> Engine: **node-llama-cpp v3** (modelos GGUF locais, zero Ollama).  
> Plataforma: extensão VS Code (TypeScript, Node.js/Electron).

---

## Índice

1. Visão Geral e Arquitetura
2. Setup Inicial (package.json, tsconfig.json, .vscodeignore)
3. Tipos Compartilhados
4. `src/llm/LlamaEngine.ts`
5. `src/llm/ToolCallParser.ts`
6. `src/tools/ToolRegistry.ts`
7. `src/tools/ToolExecutor.ts`
8. `src/memory/MemoryEntry.ts`
9. `src/memory/MemoryPalace.ts`
10. `src/memory/DigestCache.ts`
11. `src/safety/ApprovalService.ts`
12. `src/capture/ConfigScanner.ts`
13. `src/capture/EnvironmentProbe.ts`
14. `src/capture/GitAnalyzer.ts`
15. `src/capture/WorkspaceCapture.ts`
16. `src/context/TutorialSelector.ts`
17. `src/context/WakeUpContextGenerator.ts`
18. `src/context/LlmContextOptimizer.ts`
19. `src/agent/MessageHistory.ts`
20. `src/agent/AgentLoop.ts`
21. `src/ui/ChatPanel.ts`
22. `src/ui/ModelManagerPanel.ts`
23. `src/extension.ts`
24. `resources/system-prompt.md`
25. Instruções de Build e Teste

---

## 1. Visão Geral e Arquitetura

**Unplugged** é um agente de desenvolvimento local para VS Code. Roda modelos de linguagem em GGUF diretamente no processo Node.js do editor — sem servidor externo, sem Ollama, sem cloud.

### Pilares

| Pilar | Descrição |
|-------|-----------|
| **LLM local** | node-llama-cpp v3 — roda GGUF com GPU (CUDA/Vulkan/Metal) ou CPU |
| **Contexto estruturado** | 9 camadas de captura → briefing compacto de ~6000 tokens |
| **Memória persistente** | SQLite via better-sqlite3 em `.unplugged/memory/` |
| **Tool calling** | XML no system prompt — funciona com qualquer modelo local |
| **Segurança** | Aprovação do usuário antes de editar/deletar arquivos |

### Fluxo de dados principal

```
Usuário digita no ChatPanel
  ↓
extension.ts → agent.run(texto, sections)
  ↓
AgentLoop._buildSystemPrompt()
  ├─ system-prompt.md (bundled ou do workspace)
  ├─ instructions.md + dev-profile.md (do workspace)
  ├─ LlmContextOptimizer.build() → briefing compactado
  └─ ToolCallParser.buildXmlToolsPrompt(TOOL_SCHEMAS)
  ↓
LlamaEngine.chat(systemPrompt, history, userMsg) → AsyncGenerator<string>
  ↓  [streaming de tokens]
ChatPanel.appendToken()   +   responseText acumula
  ↓  [fim do stream]
ToolCallParser.fromXml(responseText) → ParsedToolCall[]
  ↓
  ├─ Sem tool calls → fim, salva no MessageHistory
  └─ Com tool calls → ToolExecutor.execute() → result → próxima rodada
```

### Estrutura de pastas

```
unplugged/
├── src/
│   ├── llm/
│   │   ├── LlamaEngine.ts
│   │   └── ToolCallParser.ts
│   ├── tools/
│   │   ├── ToolRegistry.ts
│   │   └── ToolExecutor.ts
│   ├── memory/
│   │   ├── MemoryEntry.ts
│   │   ├── MemoryPalace.ts
│   │   └── DigestCache.ts
│   ├── safety/
│   │   └── ApprovalService.ts
│   ├── capture/
│   │   ├── ConfigScanner.ts
│   │   ├── EnvironmentProbe.ts
│   │   ├── GitAnalyzer.ts
│   │   └── WorkspaceCapture.ts
│   ├── context/
│   │   ├── TutorialSelector.ts
│   │   ├── WakeUpContextGenerator.ts
│   │   └── LlmContextOptimizer.ts
│   ├── agent/
│   │   ├── MessageHistory.ts
│   │   └── AgentLoop.ts
│   ├── ui/
│   │   ├── ChatPanel.ts
│   │   └── ModelManagerPanel.ts
│   └── extension.ts
├── resources/
│   └── system-prompt.md
├── package.json
├── tsconfig.json
└── .vscodeignore
```

---

## 2. Setup Inicial

### `package.json` — completo

```json
{
  "name": "unplugged",
  "displayName": "Unplugged",
  "description": "Agente de desenvolvimento local com LLM embutido (node-llama-cpp), contexto estruturado e memória persistente",
  "version": "0.2.0",
  "publisher": "unplugged",
  "icon": "logo.png",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other", "Machine Learning"],
  "keywords": ["ai", "offline", "agent", "local llm", "llama"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "unplugged.openChat",        "title": "Unplugged: Abrir Chat",                "icon": "$(hubot)" },
      { "command": "unplugged.indexWorkspace",   "title": "Unplugged: Indexar Workspace",         "icon": "$(database)" },
      { "command": "unplugged.showBriefing",     "title": "Unplugged: Ver Code Briefing",         "icon": "$(book)" },
      { "command": "unplugged.saveMemory",       "title": "Unplugged: Salvar Memória",            "icon": "$(bookmark)" },
      { "command": "unplugged.loadModel",        "title": "Unplugged: Selecionar Modelo (.gguf)", "icon": "$(chip)" },
      { "command": "unplugged.clearHistory",     "title": "Unplugged: Limpar Histórico",          "icon": "$(clear-all)" },
      { "command": "unplugged.modelManager",     "title": "Unplugged: Gerenciador de Modelos",   "icon": "$(layers)" },
      { "command": "unplugged.openInstructions", "title": "Unplugged: Instruções do Projeto",     "icon": "$(edit)" },
      { "command": "unplugged.openDevProfile",   "title": "Unplugged: Perfil do Desenvolvedor",  "icon": "$(person)" },
      { "command": "unplugged._testTool",        "title": "Unplugged: Testar Tool (dev)",         "icon": "$(beaker)" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "unplugged", "title": "Unplugged", "icon": "$(hubot)" }
      ]
    },
    "views": {
      "unplugged": [
        { "type": "webview", "id": "unplugged.chatView", "name": "Chat" }
      ]
    },
    "menus": {
      "view/title": [
        { "command": "unplugged.indexWorkspace",   "group": "navigation@1", "when": "view == unplugged.chatView" },
        { "command": "unplugged.showBriefing",     "group": "navigation@2", "when": "view == unplugged.chatView" },
        { "command": "unplugged.saveMemory",       "group": "navigation@3", "when": "view == unplugged.chatView" },
        { "command": "unplugged.loadModel",        "group": "navigation@4", "when": "view == unplugged.chatView" },
        { "command": "unplugged.clearHistory",     "group": "navigation@5", "when": "view == unplugged.chatView" },
        { "command": "unplugged.modelManager",     "group": "navigation@6", "when": "view == unplugged.chatView" },
        { "command": "unplugged.openInstructions", "group": "navigation@7", "when": "view == unplugged.chatView" }
      ],
      "editor/context": [
        { "command": "unplugged.openChat", "group": "unplugged@1", "when": "editorHasText" }
      ]
    },
    "configuration": {
      "title": "Unplugged",
      "properties": {
        "unplugged.modelPath": {
          "type": "string",
          "default": "",
          "description": "Caminho absoluto para o arquivo .gguf do modelo ativo. Use 'Unplugged: Selecionar Modelo' para configurar."
        },
        "unplugged.gpu": {
          "type": "string",
          "default": "auto",
          "enum": ["auto", "cpu", "cuda", "vulkan", "metal"],
          "enumDescriptions": [
            "Detecta automaticamente (recomendado)",
            "Força CPU (sem GPU)",
            "CUDA (NVIDIA)",
            "Vulkan (AMD/NVIDIA/Intel)",
            "Metal (Apple Silicon)"
          ],
          "description": "Backend de GPU para inferência"
        },
        "unplugged.contextSize": {
          "type": "number",
          "default": 8192,
          "minimum": 2048,
          "maximum": 131072,
          "description": "Janela de contexto em tokens"
        },
        "unplugged.maxTokens": {
          "type": "number",
          "default": 1024,
          "minimum": 256,
          "maximum": 32768,
          "description": "Máximo de tokens gerados por resposta"
        },
        "unplugged.temperature": {
          "type": "number",
          "default": 0.2,
          "minimum": 0,
          "maximum": 2,
          "description": "Temperatura (0 = determinístico)"
        },
        "unplugged.approvalMode": {
          "type": "string",
          "default": "always",
          "enum": ["always", "destructive-only"],
          "enumDescriptions": [
            "Pede aprovação antes de qualquer escrita",
            "Pede aprovação só para delete e comandos de terminal"
          ],
          "description": "Quando pedir aprovação antes de aplicar edições"
        },
        "unplugged.maxContextFiles": {
          "type": "number",
          "default": 10,
          "minimum": 1,
          "maximum": 50,
          "description": "Máximo de arquivos incluídos no contexto da LLM"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts",
    "rebuild": "electron-rebuild -v 39.8.8 -f -w better-sqlite3,node-llama-cpp"
  },
  "devDependencies": {
    "@electron/rebuild": "^4.0.4",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "node-llama-cpp": "^3.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out"]
}
```

### `.vscodeignore`

```
.vscode/**
src/**
out/test/**
node_modules/**
.gitignore
tsconfig.json
.eslintrc.json
**/*.ts
**/*.map
!out/**
!resources/**
!logo.png
```

---

## 3. Tipos Compartilhados

Esses tipos são usados por múltiplos módulos. Defini-los aqui para referência — cada arquivo importa do módulo correspondente.

### `ChatMessage` (usado em LlamaEngine e AgentLoop)
```typescript
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}
```

### `ParsedToolCall` (usado em ToolCallParser, ToolRegistry, AgentLoop)
```typescript
export interface ParsedToolCall {
  id:       string;
  toolName: string;
  args:     Record<string, unknown>;
}
```

### `ToolResult` (retorno de ToolExecutor.execute)
```typescript
export interface ToolResult {
  content: string;  // texto a ser injetado de volta no contexto
}
```

---

## 4. `src/llm/LlamaEngine.ts`

### Propósito
Encapsula todo o node-llama-cpp. Carrega modelos GGUF, gerencia sessão de chat, emite tokens em streaming via AsyncGenerator. Nenhum outro módulo importa node-llama-cpp diretamente.

### Imports necessários
```typescript
import * as fs from 'fs';
import {
  getLlama,
  LlamaChatSession,
  Llama,
  LlamaModel,
  LlamaContext,
} from 'node-llama-cpp';
```

### Interface pública

```typescript
export interface LlamaEngineOptions {
  modelPath:   string;
  contextSize: number;   // default 8192
  maxTokens:   number;   // default 1024
  temperature: number;   // default 0.2
  gpu:         'auto' | 'cpu' | 'cuda' | 'vulkan' | 'metal';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}
```

### Classe `LlamaEngine`

**Campos privados:**
```typescript
private _llama:   Llama | null = null;
private _model:   LlamaModel | null = null;
private _context: LlamaContext | null = null;
private _opts:    LlamaEngineOptions | null = null;
```

**`get isLoaded(): boolean`**  
Retorna `this._model !== null`.

---

**`async load(opts: LlamaEngineOptions): Promise<void>`**

Lógica:
1. Se `opts.modelPath` igual ao `this._opts?.modelPath` já carregado → retorna sem fazer nada (reutiliza)
2. Chama `this.dispose()` para liberar modelo anterior
3. Valida que `fs.existsSync(opts.modelPath)` → se não existir, lança `Error('Modelo não encontrado: ' + opts.modelPath)`
4. Determina o GPU backend: mapeia `opts.gpu` para o valor do node-llama-cpp
   - `'auto'` → `'auto'`
   - `'cpu'` → `false`
   - `'cuda'` / `'vulkan'` / `'metal'` → o próprio valor
5. Chama `getLlama({ gpu: gpuValue, logLevel: LlamaLogLevel.error })` → `this._llama`
6. Chama `this._llama.loadModel({ modelPath: opts.modelPath })` → `this._model`
7. Chama `this._model.createContext({ contextSize: opts.contextSize })` → `this._context`
8. Salva `opts` em `this._opts`

---

**`chat(systemPrompt: string, history: ChatMessage[], userMessage: string, signal?: AbortSignal): AsyncGenerator<string>`**

Esta é a função central — emite tokens em streaming.

Lógica completa:
```typescript
async *chat(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!this._context || !this._opts) {
    throw new Error('LlamaEngine: modelo não carregado. Chame load() primeiro.');
  }

  // 1. Cria nova sessão a partir do contexto atual
  const sequence = this._context.getSequence();
  const session  = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt,
    autoDisposeSequence: true,
  });

  // 2. Restaura histórico (converte ChatMessage[] para o formato do node-llama-cpp)
  //    Apenas mensagens user/assistant — system já vai no systemPrompt, tool é formatado como user
  const llamaHistory = this._convertHistory(history);
  if (llamaHistory.length > 0) {
    session.setChatHistory(llamaHistory);
  }

  // 3. Fila de tokens para o async generator
  const queue:   string[] = [];
  let   ended  = false;
  let   error: unknown = undefined;
  let   notify: (() => void) | null = null;

  const push = (token: string) => {
    queue.push(token);
    notify?.();
  };

  // 4. Dispara o prompt em background
  const promptPromise = session.prompt(userMessage, {
    maxTokens:   this._opts.maxTokens,
    temperature: this._opts.temperature,
    signal,
    onTextChunk: (token: string) => push(token),
  }).then(() => {
    ended = true;
    notify?.();
  }).catch((err: unknown) => {
    error = err;
    ended = true;
    notify?.();
  });

  // 5. Yield tokens conforme chegam
  while (!ended || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
    } else {
      // Aguarda próximo token
      await new Promise<void>(resolve => {
        notify = resolve;
      });
      notify = null;
    }
  }

  // Garante que a promise concluiu (cleanup)
  await promptPromise.catch(() => {});

  if (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (!isAbort) { throw error; }
  }
}
```

---

**`private _convertHistory(history: ChatMessage[]): unknown[]`**

Converte `ChatMessage[]` para o formato interno do node-llama-cpp (`ChatHistoryItem[]`).

Regras de conversão:
- `role === 'user'` → `{ type: 'user', text: content }`
- `role === 'assistant'` → `{ type: 'model', response: [content] }`
- `role === 'tool'` → formata como `{ type: 'user', text: '[RESULTADO DE FERRAMENTA]\n' + content }`
- `role === 'system'` → ignora (já está no systemPrompt)

Retorna array de pares user/model (o node-llama-cpp espera que o histórico alterne user→model). Se o histórico terminar em 'user', não adiciona (a mensagem atual é o userMessage).

Implementação simplificada (compatível com node-llama-cpp v3):
```typescript
private _convertHistory(history: ChatMessage[]): unknown[] {
  const result: unknown[] = [];
  for (const msg of history) {
    if (msg.role === 'system') { continue; }
    if (msg.role === 'user') {
      result.push({ type: 'user', text: msg.content });
    } else if (msg.role === 'assistant') {
      result.push({ type: 'model', response: [msg.content] });
    } else if (msg.role === 'tool') {
      result.push({ type: 'user', text: '[RESULTADO DE FERRAMENTA]\n' + msg.content });
      result.push({ type: 'model', response: ['Entendido.'] });
    }
  }
  return result;
}
```

---

**`async dispose(): Promise<void>`**

```typescript
async dispose(): Promise<void> {
  await this._context?.dispose?.();
  await this._model?.dispose?.();
  // getLlama não tem dispose público em v3, mas chamar dispose no model já libera
  this._context = null;
  this._model   = null;
  this._llama   = null;
  this._opts    = null;
}
```

---

## 5. `src/llm/ToolCallParser.ts`

### Propósito
Parseia tool calls no formato XML do texto gerado pelo modelo. Também gera o prompt de instrução de tools para injeção no system prompt.

### Formato XML suportado

**Formato JSON** (modelos que geram JSON estruturado):
```xml
<tool_call>
{"name": "read_file", "arguments": {"path": "src/extension.ts"}}
</tool_call>
```

**Formato tag** (modelos menores, menos capazes):
```xml
<tool_call>
<name>read_file</name>
<parameters>{"path": "src/extension.ts"}</parameters>
</tool_call>
```

### Interface

```typescript
export interface ParsedToolCall {
  id:       string;
  toolName: string;
  args:     Record<string, unknown>;
}
```

### Classe `ToolCallParser`

**`fromXml(text: string): ParsedToolCall[]`**

Extrai todas as tool calls do texto usando regex `/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g`.

Para cada match:
1. Tenta parsear como JSON `{ name, arguments }` — se `body.startsWith('{')` → `JSON.parse(body)`
2. Se falhar ou não for JSON, extrai `<name>` e `<parameters>` com regex

Retorna array de `ParsedToolCall` com `id` gerado como `` `xml_${Date.now()}_${index}` ``.

---

**`hasXmlToolCalls(text: string): boolean`**

Retorna `/<tool_call>/.test(text)`.

---

**`static buildXmlToolsPrompt(tools: ToolSchema[]): string`**

Onde `ToolSchema` é o tipo de cada tool do `ToolRegistry` (ver seção 6).

Gera o seguinte bloco de texto para ser injetado no system prompt:

```
Você pode chamar ferramentas usando este formato XML:

<tool_call>
{"name": "nome_da_ferramenta", "arguments": {"param": "valor"}}
</tool_call>

Aguarde o resultado antes de chamar outra ferramenta.
Só chame ferramentas quando realmente necessário.

Ferramentas disponíveis:

[get_active_file] Retorna o arquivo atualmente aberto no editor
  Sem parâmetros.

[read_file] Lê o conteúdo de um arquivo
  path: Caminho relativo ao workspace

[apply_edit] Aplica edição em um arquivo existente
  path: Caminho relativo
  old_string: Trecho exato a substituir (deve ser único no arquivo)
  new_string: Novo conteúdo

... (um bloco para cada tool)
```

Implementação: itera `tools`, para cada um formata `[nome] descrição\n  param: desc\n  param: desc`.

---

## 6. `src/tools/ToolRegistry.ts`

### Propósito
Define os schemas de todas as tools disponíveis para o agente. Esses schemas são usados tanto para construir o XML prompt quanto (futuramente) para validação de args.

### Tipos

```typescript
export interface ToolParam {
  type:        'string' | 'number' | 'boolean';
  description: string;
  required?:   boolean;
}

export interface ToolSchema {
  function: {
    name:        string;
    description: string;
    parameters: {
      type:       'object';
      properties: Record<string, ToolParam>;
      required:   string[];
    };
  };
}

export interface ParsedToolCall {
  id:       string;
  toolName: string;
  args:     Record<string, unknown>;
}
```

### `TOOL_SCHEMAS: ToolSchema[]` — lista completa das 20 tools

```typescript
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    function: {
      name: 'get_active_file',
      description: 'Retorna o caminho e conteúdo do arquivo atualmente aberto no editor VS Code.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    function: {
      name: 'read_file',
      description: 'Lê o conteúdo completo de um arquivo. Use caminhos relativos ao workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo ao workspace (ex: src/extension.ts)' },
        },
        required: ['path'],
      },
    },
  },
  {
    function: {
      name: 'apply_edit',
      description: 'Substitui um trecho exato em um arquivo existente. old_string deve ser único no arquivo.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string', description: 'Caminho relativo ao arquivo' },
          old_string: { type: 'string', description: 'Trecho exato a substituir (deve existir e ser único)' },
          new_string: { type: 'string', description: 'Novo conteúdo que substituirá old_string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    function: {
      name: 'create_file',
      description: 'Cria um novo arquivo com o conteúdo especificado. Falha se o arquivo já existir.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'Caminho relativo do arquivo a criar' },
          content: { type: 'string', description: 'Conteúdo inicial do arquivo' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    function: {
      name: 'delete_file',
      description: 'Deleta um arquivo do workspace. OPERAÇÃO DESTRUTIVA — requer aprovação.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo do arquivo a deletar' },
        },
        required: ['path'],
      },
    },
  },
  {
    function: {
      name: 'run_terminal',
      description: 'Executa um comando no terminal integrado do VS Code. REQUER APROVAÇÃO.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Comando a executar (ex: npm run test)' },
        },
        required: ['command'],
      },
    },
  },
  {
    function: {
      name: 'get_diagnostics',
      description: 'Retorna erros e avisos do TypeScript/ESLint do arquivo ativo ou do workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo (opcional — sem path retorna diagnósticos do workspace todo)' },
        },
        required: [],
      },
    },
  },
  {
    function: {
      name: 'find_symbol',
      description: 'Busca definições de símbolos (classes, funções, interfaces) no workspace.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Nome do símbolo a buscar (ex: AgentLoop, activate)' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    function: {
      name: 'list_files',
      description: 'Lista arquivos do workspace por padrão glob.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Padrão glob (ex: src/**/*.ts, **/*.json)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    function: {
      name: 'list_directory_tree',
      description: 'Exibe a árvore de diretórios do workspace ou de um subdiretório.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Subdiretório (opcional — sem path mostra a raiz)' },
        },
        required: [],
      },
    },
  },
  {
    function: {
      name: 'search_codebase',
      description: 'Busca texto ou padrão regex em todos os arquivos do workspace.',
      parameters: {
        type: 'object',
        properties: {
          query:   { type: 'string', description: 'Texto ou regex a buscar' },
          pattern: { type: 'string', description: 'Glob de arquivos a incluir (opcional, ex: **/*.ts)' },
        },
        required: ['query'],
      },
    },
  },
  {
    function: {
      name: 'get_selection',
      description: 'Retorna o texto selecionado no editor ativo.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    function: {
      name: 'git_status',
      description: 'Retorna o status git do workspace (arquivos modificados, staged, untracked).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    function: {
      name: 'git_diff',
      description: 'Retorna o diff git de um arquivo ou do workspace todo.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo (opcional — sem path retorna diff completo)' },
        },
        required: [],
      },
    },
  },
  {
    function: {
      name: 'get_hover',
      description: 'Retorna informações de hover do VS Code para um símbolo (tipo, documentação).',
      parameters: {
        type: 'object',
        properties: {
          path:   { type: 'string', description: 'Caminho relativo do arquivo' },
          symbol: { type: 'string', description: 'Símbolo a inspecionar' },
          line:   { type: 'number', description: 'Linha (1-based)' },
        },
        required: ['path', 'line'],
      },
    },
  },
  {
    function: {
      name: 'find_definition',
      description: 'Encontra a definição de um símbolo via Language Server.',
      parameters: {
        type: 'object',
        properties: {
          path:   { type: 'string', description: 'Arquivo onde o símbolo está referenciado' },
          symbol: { type: 'string', description: 'Nome do símbolo' },
          line:   { type: 'number', description: 'Linha (1-based)' },
          column: { type: 'number', description: 'Coluna (1-based)' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    function: {
      name: 'find_references',
      description: 'Lista todas as referências a um símbolo no workspace via Language Server.',
      parameters: {
        type: 'object',
        properties: {
          path:   { type: 'string', description: 'Arquivo onde o símbolo está' },
          line:   { type: 'number', description: 'Linha (1-based)' },
          column: { type: 'number', description: 'Coluna (1-based)' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  {
    function: {
      name: 'save_memory',
      description: 'Salva uma entrada na memória persistente do projeto.',
      parameters: {
        type: 'object',
        properties: {
          type:    { type: 'string', description: 'Tipo: decision | pattern | risk | event | problem | workflow' },
          title:   { type: 'string', description: 'Título curto da entrada' },
          content: { type: 'string', description: 'Descrição detalhada' },
          tags:    { type: 'string', description: 'Tags separadas por vírgula (opcional)' },
        },
        required: ['type', 'title', 'content'],
      },
    },
  },
  {
    function: {
      name: 'get_memory',
      description: 'Busca entradas na memória persistente do projeto por texto.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar na memória' },
        },
        required: ['query'],
      },
    },
  },
  {
    function: {
      name: 'get_graph',
      description: 'Retorna o grafo de dependências dos arquivos do workspace (quem importa quem).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
```

---

## 7. `src/tools/ToolExecutor.ts`

### Propósito
Implementa a execução de cada tool. Recebe um `ParsedToolCall`, executa a operação correspondente, retorna `ToolResult`.

### Dependências
```typescript
import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import * as cp     from 'child_process';
import { ParsedToolCall, ToolResult } from '../tools/ToolRegistry';
import { ApprovalService, PendingEdit } from '../safety/ApprovalService';
import { MemoryPalace }                 from '../memory/MemoryPalace';
```

### Interface do construtor

```typescript
export interface ToolExecutorOptions {
  onPendingEdit:        (edit: PendingEdit) => Promise<boolean>;
  onDestructiveCommand: (command: string)   => Promise<boolean>;
  memoryPalace?:        MemoryPalace;
}

export class ToolExecutor {
  constructor(private readonly opts: ToolExecutorOptions) {}

  async execute(call: ParsedToolCall): Promise<ToolResult> {
    switch (call.toolName) {
      case 'get_active_file':      return this._getActiveFile();
      case 'read_file':            return this._readFile(call.args);
      case 'apply_edit':           return this._applyEdit(call.args);
      case 'create_file':          return this._createFile(call.args);
      case 'delete_file':          return this._deleteFile(call.args);
      case 'run_terminal':         return this._runTerminal(call.args);
      case 'get_diagnostics':      return this._getDiagnostics(call.args);
      case 'find_symbol':          return this._findSymbol(call.args);
      case 'list_files':           return this._listFiles(call.args);
      case 'list_directory_tree':  return this._listDirectoryTree(call.args);
      case 'search_codebase':      return this._searchCodebase(call.args);
      case 'get_selection':        return this._getSelection();
      case 'git_status':           return this._gitStatus();
      case 'git_diff':             return this._gitDiff(call.args);
      case 'get_hover':            return this._getHover(call.args);
      case 'find_definition':      return this._findDefinition(call.args);
      case 'find_references':      return this._findReferences(call.args);
      case 'save_memory':          return this._saveMemory(call.args);
      case 'get_memory':           return this._getMemory(call.args);
      case 'get_graph':            return this._getGraph();
      default:
        return { content: `Tool desconhecida: ${call.toolName}` };
    }
  }
}
```

### Implementações das tools

**`_getActiveFile()`**  
- Obtém `vscode.window.activeTextEditor`
- Se não houver editor ativo → retorna `{ content: 'Nenhum arquivo aberto.' }`
- Obtém `editor.document.uri.fsPath` e `editor.document.getText()`
- Obtém wsRoot via `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`
- Retorna `{ content: 'Arquivo: ' + path.relative(wsRoot, filePath) + '\n\n' + content }`
- Limitar content a 10000 chars se muito grande

**`_readFile(args)`**  
- `args.path` deve ser string
- Resolve path: `path.resolve(wsRoot, args.path as string)`
- Se `!fs.existsSync(absPath)` → `{ content: 'Arquivo não encontrado: ' + args.path }`
- `fs.readFileSync(absPath, 'utf8')`
- Limitar a 20000 chars; se truncar, adicionar `\n[... truncado em 20000 chars]`
- Retorna `{ content: texto }`

**`_applyEdit(args)`**  
- `args.path`, `args.old_string`, `args.new_string` — todos string
- Resolve abs path, lê conteúdo do arquivo
- Se `old_string` não existir no arquivo → `{ content: 'Erro: old_string não encontrado no arquivo.' }`
- Se `old_string` aparecer mais de uma vez → `{ content: 'Erro: old_string não é único — encontrado N vezes.' }`
- Constrói `PendingEdit = { path: absPath, original: content, modified: content.replace(old_string, new_string) }`
- Chama `this.opts.onPendingEdit(edit)` → se retornar `false` → `{ content: 'Edição recusada pelo usuário.' }`
- Aplica via `vscode.workspace.applyEdit` com `WorkspaceEdit.replace`
- Salva o documento
- Retorna `{ content: 'Edição aplicada em ' + args.path }`

**`_createFile(args)`**  
- `args.path`, `args.content` — string
- Se arquivo já existe → `{ content: 'Erro: arquivo já existe. Use apply_edit para modificar.' }`
- Cria `PendingEdit` com `original: ''` e `modified: args.content`
- Chama `onPendingEdit` para aprovação (modo always)
- Cria via `vscode.workspace.applyEdit` + `WorkspaceEdit.createFile`
- Retorna `{ content: 'Arquivo criado: ' + args.path }`

**`_deleteFile(args)`**  
- `args.path` — string
- Chama `onDestructiveCommand('delete_file: ' + args.path)` para aprovação
- Se recusado → `{ content: 'Deleção recusada.' }`
- Deleta via `vscode.workspace.applyEdit` + `WorkspaceEdit.deleteFile`
- Retorna `{ content: 'Arquivo deletado: ' + args.path }`

**`_runTerminal(args)`**  
- `args.command` — string
- Chama `onDestructiveCommand(args.command)` para aprovação
- Se recusado → `{ content: 'Comando recusado.' }`
- Abre terminal via `vscode.window.createTerminal({ name: 'Unplugged' })`
- Executa `terminal.sendText(args.command)`
- Retorna `{ content: 'Comando enviado ao terminal: ' + args.command + '\n(veja a saída no terminal)' }`
- **Nota:** não captura stdout — o VS Code não permite captura de terminal integrado. O agente deve observar via `get_diagnostics` ou pedir ao usuário para reportar resultado.

**`_getDiagnostics(args)`**  
- `args.path` opcional
- Se path fornecido → `vscode.languages.getDiagnostics(vscode.Uri.file(absPath))`
- Se não → `vscode.languages.getDiagnostics()` (retorna Map de todos)
- Filtra por severidade Error e Warning
- Formata: `${severidade} [${source}] ${mensagem} (linha ${line+1})`
- Limitar a 50 diagnósticos
- Retorna `{ content: formatado || 'Nenhum diagnóstico encontrado.' }`

**`_findSymbol(args)`**  
- `args.symbol` — string
- Usa `vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java}', '**/node_modules/**', 200)`
- Para cada arquivo, lê conteúdo e faz regex de `args.symbol` com linhas contexto
- Retorna primeiras 20 ocorrências no formato `arquivo:linha: conteúdo da linha`

**`_listFiles(args)`**  
- `args.pattern` — glob string
- Usa `vscode.workspace.findFiles(args.pattern, '**/node_modules/**', 500)`
- Retorna lista de paths relativos ao workspace, um por linha
- Se nenhum → `'Nenhum arquivo encontrado para o padrão: ' + args.pattern`

**`_listDirectoryTree(args)`**  
- `args.path` opcional — subdiretório
- Função recursiva que percorre o diretório com `fs.readdirSync`
- Ignora: `node_modules`, `.git`, `out`, `dist`, `.unplugged/memory`
- Formata como árvore com indentação de 2 espaços:
  ```
  src/
    agent/
      AgentLoop.ts
      MessageHistory.ts
    llm/
      LlamaEngine.ts
  ```
- Limitar a 200 entradas

**`_searchCodebase(args)`**  
- `args.query` — string (texto ou regex)
- `args.pattern` — glob opcional (default `**/*.{ts,js,py,go,rs,java,md}`)
- Busca com `vscode.workspace.findFiles` + lê cada arquivo + regex
- Retorna até 30 matches no formato `arquivo:linha: conteúdo`
- Se query for regex inválido, usar como texto literal

**`_getSelection()`**  
- `vscode.window.activeTextEditor?.selection`
- Se sem seleção → `{ content: 'Nenhum texto selecionado.' }`
- `editor.document.getText(selection)`
- Retorna `{ content: 'Seleção em ' + arquivo + ' (linhas X-Y):\n\n' + texto }`

**`_gitStatus()`**  
- Executa `git status --short` via `cp.execSync` no wsRoot
- Timeout 5000ms
- Retorna stdout; se falhar → mensagem de erro

**`_gitDiff(args)`**  
- `args.path` opcional
- Executa `git diff HEAD -- <path>` ou `git diff HEAD` se sem path
- Limitar output a 10000 chars
- Retorna diff ou `'Sem alterações.'`

**`_getHover(args)`**  
- `args.path`, `args.line` (1-based), `args.symbol` opcional
- Abre documento `vscode.workspace.openTextDocument(absPath)`
- Executa `vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(line-1, 0))`
- Extrai texto do resultado
- Retorna hover text ou `'Sem hover disponível.'`

**`_findDefinition(args)`**  
- `args.path`, `args.line`, `args.column` (ambos 1-based)
- Executa `vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position)`
- Retorna lista de localizações: `arquivo:linha`

**`_findReferences(args)`**  
- Similar a `_findDefinition` mas com `'vscode.executeReferenceProvider'`
- Retorna lista de localizações

**`_saveMemory(args)`**  
- Se `!this.opts.memoryPalace` → `{ content: 'Memória não disponível (workspace não aberto).' }`
- Valida `type` ∈ `['decision','pattern','risk','event','problem','workflow']`
- `tags` → split por vírgula, trim
- Chama `palace.save(entry)`
- Retorna `{ content: 'Memória salva: [' + type + '] ' + title }`

**`_getMemory(args)`**  
- `args.query` — string
- Chama `palace.search(query)` → retorna entradas formatadas
- Máximo 10 entradas
- Formata: `[tipo] título\n  conteúdo\n  tags: ...`
- Retorna `{ content: formatado || 'Nenhuma entrada encontrada.' }`

**`_getGraph()`**  
- Lista arquivos `.ts` e `.js` do workspace
- Para cada arquivo, extrai imports via regex `from ['"]([^'"]+)['"]`
- Constrói mapa: `arquivo → [dependências]`
- Formata como lista: `arquivo: dep1, dep2, dep3`
- Limitar a 50 arquivos
- Retorna `{ content: grafo formatado }`

---

## 8. `src/memory/MemoryEntry.ts`

```typescript
export type EntryType = 'decision' | 'pattern' | 'risk' | 'event' | 'problem' | 'workflow';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  decision: '🔵 Decisão',
  pattern:  '🟢 Padrão',
  risk:     '🔴 Risco',
  event:    '🟡 Evento',
  problem:  '🟠 Problema',
  workflow: '⚪ Workflow',
};

export interface MemoryEntry {
  id:      string;
  type:    EntryType;
  title:   string;
  content: string;
  tags:    string[];
  related: string[];
  date:    string;   // ISO 8601, ex: 2025-01-15
}
```

---

## 9. `src/memory/MemoryPalace.ts`

### Propósito
Armazena entradas de memória em SQLite. O banco fica em `.unplugged/memory/palace.db`.

### Dependências
```typescript
import Database from 'better-sqlite3';
import * as fs   from 'fs';
import * as path from 'path';
import { MemoryEntry, EntryType } from './MemoryEntry';
```

### Schema SQLite
```sql
CREATE TABLE IF NOT EXISTS entries (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  title   TEXT NOT NULL,
  content TEXT NOT NULL,
  tags    TEXT NOT NULL DEFAULT '[]',
  related TEXT NOT NULL DEFAULT '[]',
  date    TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts
  USING fts5(id UNINDEXED, title, content, tags, content='entries', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, id, title, content, tags)
  VALUES (new.rowid, new.id, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, id, title, content, tags)
  VALUES('delete', old.rowid, old.id, old.title, old.content, old.tags);
END;
```

### Classe `MemoryPalace`

**`constructor(wsRoot: string)`**  
- `dbDir = path.join(wsRoot, '.unplugged', 'memory')`
- `fs.mkdirSync(dbDir, { recursive: true })`
- `this._db = new Database(path.join(dbDir, 'palace.db'))`
- Executa o schema acima via `this._db.exec(schema)`

**`save(entry: MemoryEntry): void`**  
- `this._db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?)').run(...)`
- `tags` e `related` são serializados como `JSON.stringify(array)`

**`search(query: string, limit = 20): MemoryEntry[]`**  
- Usa FTS5: `SELECT e.* FROM entries e JOIN entries_fts f ON e.id = f.id WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?`
- Sanitiza a query: escapa caracteres especiais do FTS5
- Converte rows para `MemoryEntry[]` (parse JSON nos campos tags/related)
- Se falhar (query inválida), fallback para LIKE: `SELECT * FROM entries WHERE title LIKE ? OR content LIKE ? LIMIT ?`

**`list(type?: EntryType): MemoryEntry[]`**  
- Se type → `SELECT * FROM entries WHERE type = ? ORDER BY date DESC`
- Senão → `SELECT * FROM entries ORDER BY date DESC LIMIT 100`

**`delete(id: string): void`**  
- `DELETE FROM entries WHERE id = ?`

**`nextId(type: EntryType): string`**  
- `SELECT COUNT(*) FROM entries WHERE type = ?`
- Retorna `` `${type}_${count + 1}` `` (ex: `decision_3`)

---

## 10. `src/memory/DigestCache.ts`

### Propósito
Cache simples em memória para evitar recomputar o mesmo conteúdo de contexto repetidamente quando arquivos não mudaram.

### Implementação

```typescript
export class DigestCache {
  private _cache = new Map<string, { hash: string; value: string }>();

  get(key: string, currentHash: string): string | null {
    const entry = this._cache.get(key);
    if (entry && entry.hash === currentHash) { return entry.value; }
    return null;
  }

  set(key: string, hash: string, value: string): void {
    this._cache.set(key, { hash, value });
  }

  invalidate(key?: string): void {
    if (key) { this._cache.delete(key); }
    else      { this._cache.clear(); }
  }
}
```

**Hash simples** — use length + primeiros 100 chars como hash (não precisa ser criptográfico, só detectar mudança):
```typescript
static hashContent(content: string): string {
  return `${content.length}:${content.slice(0, 100)}`;
}
```

---

## 11. `src/safety/ApprovalService.ts`

### Propósito
Solicita aprovação do usuário antes de edições e comandos destrutivos, respeitando o modo configurado.

### Tipos

```typescript
export interface PendingEdit {
  path:     string;   // abs path
  original: string;   // conteúdo antes
  modified: string;   // conteúdo depois
}
```

### Classe `ApprovalService`

**`async requestEditApproval(edit: PendingEdit): Promise<boolean>`**

1. Obtém `approvalMode = vscode.workspace.getConfiguration('unplugged').get('approvalMode')`
2. Se `approvalMode === 'destructive-only'` → retorna `true` sem perguntar
3. Calcula diff simplificado: linhas adicionadas e removidas
4. Mostra `vscode.window.showInformationMessage` com:
   - Mensagem: `Unplugged: Aplicar edição em ${path.basename(edit.path)}? (+X / -Y linhas)`
   - Botões: `['Aplicar', 'Rejeitar']`
5. Retorna `choice === 'Aplicar'`

**`async requestCommandApproval(command: string): Promise<boolean>`**

1. Mostra `vscode.window.showWarningMessage`:
   - Mensagem: `Unplugged: Executar comando?`
   - Detalhe: primeiros 100 chars do comando
   - Botões: `['Executar', 'Cancelar']`
2. Retorna `choice === 'Executar'`

---

## 12. `src/capture/ConfigScanner.ts`

### Propósito
Detecta tecnologias e dependências do projeto a partir de arquivos de configuração.

### Classe `ConfigScanner`

**`scan(wsRoot: string): ConfigInfo`**

Onde `ConfigInfo`:
```typescript
export interface ConfigInfo {
  packageJson?:     Record<string, unknown>;
  mainLanguage:     string;    // 'TypeScript' | 'JavaScript' | 'Python' | 'Go' | 'Rust' | ...
  frameworks:       string[];  // ex: ['React', 'Express']
  hasTests:         boolean;
  hasCi:            boolean;
  packageManager:   'npm' | 'yarn' | 'pnpm' | 'pip' | 'cargo' | 'go' | 'unknown';
  configFiles:      string[];  // arquivos de config encontrados (.eslintrc, tsconfig.json, etc.)
}
```

**Lógica de scan:**
1. Verifica existência dos arquivos: `package.json`, `tsconfig.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`
2. Se `package.json` existe → parse e detecta frameworks pelas dependências
3. Detecta mainLanguage por extensões mais presentes nos arquivos do workspace
4. `hasTests`: presença de `jest`, `vitest`, `pytest`, `testing` nas deps ou pastas `test/`, `__tests__/`
5. `hasCi`: presença de `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`

**Cache:** usa `DigestCache` internamente. Invalida quando `package.json` muda.

**`invalidateCache(): void`** — chama `cache.invalidate()`.

---

## 13. `src/capture/EnvironmentProbe.ts`

### Propósito
Detecta o ambiente de execução: versões de runtimes, SO, variáveis de ambiente relevantes.

### `probe(): EnvironmentInfo`

```typescript
export interface EnvironmentInfo {
  platform: string;      // 'Windows' | 'Linux' | 'macOS'
  nodeVersion: string;
  runtimes: string[];    // ex: ['Node 20.x', 'Python 3.11']
  envVars: string[];     // nomes de variáveis relevantes (não valores)
}
```

**Lógica:**
- `process.platform` → mapeia para nome legível
- `process.version` → versão do Node
- Tenta `cp.execSync('python --version', ...)`, `cp.execSync('go version', ...)` — todos com try/catch e timeout 2s
- `envVars`: lista variáveis em `process.env` que começam com nomes comuns de config (`DATABASE_`, `API_`, `PORT`, `HOST`, etc.) — apenas os nomes, não os valores

---

## 14. `src/capture/GitAnalyzer.ts`

### Propósito
Extrai informações relevantes do repositório git para o contexto da LLM.

### Classe `GitAnalyzer`

**`analyze(wsRoot: string): GitInfo`**

```typescript
export interface GitInfo {
  branch:       string;
  recentCommits: string[];   // últimos 5 commits, formato: "abc1234 Mensagem do commit"
  modifiedFiles: string[];   // arquivos modificados (git status)
  hasUncommitted: boolean;
}
```

**Implementação:**
- `git rev-parse --abbrev-ref HEAD` → branch atual
- `git log --oneline -5` → commits recentes
- `git status --short` → arquivos modificados
- Todos via `cp.execSync` com try/catch (falha silenciosamente se não for git repo)

---

## 15. `src/capture/WorkspaceCapture.ts`

### Propósito
Orquestra todas as capturas e retorna um snapshot do workspace.

### Classe `WorkspaceCapture`

```typescript
export interface WorkspaceSnapshot {
  config:      ConfigInfo;
  environment: EnvironmentInfo;
  git:         GitInfo;
  fileCount:   number;
  topFiles:    string[];   // arquivos mais importantes por heurística
}
```

**`async capture(wsRoot: string): Promise<WorkspaceSnapshot>`**

1. Executa `ConfigScanner.scan()`, `EnvironmentProbe.probe()`, `GitAnalyzer.analyze()` em paralelo (Promise.all)
2. Conta arquivos via `vscode.workspace.findFiles('**/*', exclude, 1000)`
3. `topFiles`: prioriza arquivos como `src/extension.ts`, `src/index.ts`, `main.ts`, `app.ts`, `README.md` — os que existem no workspace
4. Retorna snapshot completo

---

## 16. `src/context/TutorialSelector.ts`

### Propósito
Seleciona tutoriais relevantes do workspace baseados na tarefa atual.

### Classe `TutorialSelector`

**`constructor(extRoot: string)`**  
`extRoot` é o path raiz da extensão (para encontrar tutoriais bundled).

**`select(wsRoot: string, task: string): string[]`**

- Procura arquivos em `${wsRoot}/.unplugged/tutorials/*.md`
- Para cada tutorial, calcula relevância: quantas palavras da `task` aparecem no nome do arquivo ou nas primeiras 5 linhas
- Retorna paths dos top 3 tutoriais mais relevantes

**`readAll(wsRoot: string): string`**

Lê e concatena todos os tutoriais de `.unplugged/tutorials/`, separados por `\n---\n`. Limitar total a 3000 chars.

---

## 17. `src/context/WakeUpContextGenerator.ts`

### Propósito
Gera o contexto de "wake-up" — sumário rápido do projeto para orientar a LLM na primeira mensagem.

### Classe `WakeUpContextGenerator`

**`generate(wsRoot: string, snapshot: WorkspaceSnapshot): string`**

Gera um bloco markdown com:
```markdown
## Contexto do Projeto

**Linguagem principal:** TypeScript
**Frameworks:** React, Express
**Branch atual:** feature/llama-engine
**Commits recentes:**
- abc1234 Implementa LlamaEngine
- def5678 Remove OllamaServer

**Arquivos modificados:**
- src/llm/LlamaEngine.ts (modificado)
- src/extension.ts (modificado)

**Arquivos principais:** src/extension.ts, src/agent/AgentLoop.ts
```

**`invalidateCache(): void`** — invalida o cache interno para forçar regeneração.

---

## 18. `src/context/LlmContextOptimizer.ts`

### Propósito
Monta o "Code Briefing" — o bloco de contexto entregue à LLM, com budget fixo de tokens.

### Tipos

```typescript
export interface ContextSection {
  label:    string;
  content:  string;
  priority: number;   // maior = mais importante; corta de baixo para cima
}

export interface StatusLine {
  icon:   string;
  label:  string;
  detail: string;
}

export interface CodeBriefing {
  text:           string;
  tokenEstimate:  number;
  status:         StatusLine[];
}

export interface BuildOptions {
  task?:     string;
  sections?: ContextSection[];
}
```

### Classe `LlmContextOptimizer`

**`constructor(scanner: ConfigScanner, selector: TutorialSelector, palace?: MemoryPalace)`**

**`build(opts: BuildOptions): CodeBriefing`**

Budget total: **6000 tokens** (estimado como `chars / 3.5`).

Seções em ordem de prioridade (maior primeiro):
1. **Arquivo ativo** (priority 100) — conteúdo do arquivo aberto no editor, max 2000 tokens
2. **Tutoriais relevantes** (priority 80) — via `TutorialSelector.select()`, max 1500 tokens
3. **Memória recente** (priority 70) — últimas 5 entradas do `MemoryPalace`, max 800 tokens
4. **Git status** (priority 60) — branch + commits + modified, max 300 tokens
5. **Config do projeto** (priority 50) — frameworks, packageManager, max 200 tokens
6. **Seções adicionais** (priority 40) — passadas via `opts.sections`, max 1000 tokens

Algoritmo de corte:
- Ordena seções por priority decrescente
- Acumula tokens até atingir budget
- Corta ou trunca a seção que excederia o budget
- Seções com priority < 40 são opcionais e descartadas primeiro

Retorna `CodeBriefing` com o texto montado e lista de `StatusLine` mostrando o que foi incluído/cortado.

---

## 19. `src/agent/MessageHistory.ts`

### Propósito
Mantém o histórico de mensagens do chat com limite para não explodir o contexto.

```typescript
import { ChatMessage } from '../llm/LlamaEngine';

const MAX_HISTORY = 30;   // mensagens (não tokens)

export class MessageHistory {
  private _messages: ChatMessage[] = [];

  add(msg: ChatMessage): void {
    this._messages.push(msg);
    // Se exceder, remove as mensagens mais antigas (mantém pares user/assistant)
    while (this._messages.length > MAX_HISTORY) {
      this._messages.shift();
    }
  }

  getAll(): ChatMessage[] {
    return [...this._messages];
  }

  clear(): void {
    this._messages = [];
  }

  get length(): number {
    return this._messages.length;
  }
}
```

---

## 20. `src/agent/AgentLoop.ts`

### Propósito
Orquestra o loop agêntico: chama a LLM, parseia tool calls, executa tools, repete até fim ou limite.

### Dependências
```typescript
import * as fs     from 'fs';
import * as path   from 'path';
import * as vscode from 'vscode';
import { LlamaEngine, ChatMessage } from '../llm/LlamaEngine';
import { ToolCallParser }           from '../llm/ToolCallParser';
import { ToolExecutor }             from '../tools/ToolExecutor';
import { TOOL_SCHEMAS }             from '../tools/ToolRegistry';
import { LlmContextOptimizer, ContextSection } from '../context/LlmContextOptimizer';
import { ChatPanel }                from '../ui/ChatPanel';
import { MessageHistory }           from './MessageHistory';
import { MemoryPalace }             from '../memory/MemoryPalace';
```

### Constantes
```typescript
const MAX_TOOL_ROUNDS = 10;
```

### Classe `AgentLoop`

```typescript
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
    this.history.add({ role: 'user', content: userMessage });

    try {
      await this._loop(userMessage, sections);
    } finally {
      this._running = false;
      this._abort   = undefined;
    }
  }
}
```

**`private async _loop(userMessage: string, sections?: ContextSection[]): Promise<void>`**

```
1. this.chat.setStatus('preparando contexto...', 'busy')
2. Monta systemPrompt via _buildSystemPrompt(userMessage, sections)
   - Registra tempo (tCtx)
   - Exibe no chat: "⚙ Contexto: ~N tokens · Xms"
3. let rounds = 0, lastText = '', totalToolCalls = 0
4. WHILE rounds < MAX_TOOL_ROUNDS:
   a. rounds++
   b. this.chat.setStatus('gerando...', 'busy')
   c. this.chat.startStreaming()
   d. let responseText = ''
   e. TRY:
      FOR AWAIT token OF engine.chat(systemPrompt, history.getAll(), userMessage, signal):
        responseText += token
        this.chat.appendToken(token)
      CATCH err:
        this.chat.endStreaming()
        this.chat.addMessage('system', 'Erro LLM: ' + err.message)
        this.chat.setStatus('erro', 'error')
        return
   f. this.chat.endStreaming()
   g. history.add({ role: 'assistant', content: responseText })
   h. lastText = responseText
   i. toolCalls = _parser.fromXml(responseText)
   j. SE toolCalls.length === 0:
      → _autoSaveEvent(userMessage, responseText, rounds)
      → chat.setStatus('pronto', 'ready')
      → chat.addMessage('system', '✓ Xms · N ferramenta(s) · M rodada(s)')
      → return
   k. this.chat.setStatus('executando ferramentas... (rodada N)', 'busy')
   l. PARA CADA call em toolCalls:
      totalToolCalls++
      chat.addMessage('tool', '→ ' + _formatToolCall(call))
      tTool = Date.now()
      result = await executor.execute(call)
      chat.addMessage('tool', '← [Xms] ' + _formatResult(result.content))
      history.add({ role: 'tool', content: '[TOOL: ' + call.toolName + ']\n' + result.content })
   m. userMessage = '' (nas rodadas seguintes, a mensagem vai no histórico)
5. SE chegou aqui (limite atingido):
   chat.addMessage('system', 'Limite de 10 rodadas atingido.')
   chat.setStatus('limite atingido', 'error')
```

**`private _buildSystemPrompt(task: string, sections?: ContextSection[]): string`**

1. Lê `system-prompt.md`: verifica `${wsRoot}/.unplugged/system-prompt.md` primeiro, senão usa `${extRoot}/resources/system-prompt.md`
2. Lê `instructions.md` de `.unplugged/instructions.md` (se existir)
3. Lê `dev-profile.md` de `.unplugged/dev-profile.md` (se existir)
4. Chama `optimizer.build({ task, sections })` → briefing
5. Gera bloco de tools: `ToolCallParser.buildXmlToolsPrompt(TOOL_SCHEMAS)`
6. Concatena tudo separado por `\n---\n`:
   ```
   [system-prompt.md]
   ---
   ## Instruções do Projeto
   [instructions.md]
   ---
   ## Perfil do Desenvolvedor
   [dev-profile.md]
   ---
   [briefing.text]
   ---
   [xmlToolsPrompt]
   ```
7. Retorna a string final e o briefing (para log)

**`private _formatToolCall(call: ParsedToolCall): string`**  
Switch sobre `call.toolName`, retorna string legível. Ex:
- `read_file` → `read_file: ${args.path}`
- `apply_edit` → `apply_edit: ${args.path}`
- `run_terminal` → `run_terminal: ${String(args.command).slice(0, 60)}`
- Default → `${toolName}: ${JSON.stringify(args).slice(0, 60)}`

**`private _formatResult(content: string): string`**  
- Pega primeira linha, trunca em 80 chars
- Adiciona ` · +N linhas` se houver mais linhas

**`private _autoSaveEvent(task: string, response: string, rounds: number): void`**  
- Se `!palace || rounds <= 1` → retorna
- Salva entrada tipo `event` com resumo da tarefa executada

---

## 21. `src/ui/ChatPanel.ts`

### Propósito
Webview sidebar do chat. Exibe mensagens, streaming de tokens, status bar.

### Tipos de mensagem

```typescript
type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
type StatusState = 'idle' | 'busy' | 'ready' | 'error';
```

### Classe `ChatPanel`

```typescript
export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly VIEW_ID = 'unplugged.chatView';

  private _view?: vscode.WebviewView;
  private _streamingDiv = false;

  // Callbacks
  private _onUserMessage?: (text: string, sections: unknown[]) => void;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  onUserMessage(cb: (text: string, sections: unknown[]) => void): void {
    this._onUserMessage = cb;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    view.webview.html = this._buildHtml();
    view.webview.onDidReceiveMessage((msg: { type: string; text?: string; sections?: unknown[] }) => {
      if (msg.type === 'send' && msg.text) {
        this._onUserMessage?.(msg.text, msg.sections ?? []);
      }
      if (msg.type === 'abort') {
        vscode.commands.executeCommand('unplugged.abort');
      }
    });
  }

  addMessage(role: MessageRole, content: string): void {
    this._post({ type: 'addMessage', role, content });
  }

  startStreaming(): void {
    this._streamingDiv = true;
    this._post({ type: 'streamStart' });
  }

  appendToken(token: string): void {
    this._post({ type: 'streamToken', token });
  }

  endStreaming(): void {
    this._streamingDiv = false;
    this._post({ type: 'streamEnd' });
  }

  setStatus(text: string, state: StatusState): void {
    this._post({ type: 'status', text, state });
  }

  clear(): void {
    this._post({ type: 'clear' });
  }

  dispose(): void { /* cleanup se necessário */ }

  private _post(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }
}
```

### HTML do ChatPanel

O HTML deve ser construído pelo método `_buildHtml(): string`. Segue a especificação completa:

**Layout:** sidebar vertical com 3 seções:
1. Status bar no topo (texto + indicador de estado)
2. Área de mensagens (scroll, flex-grow)
3. Input area no rodapé (textarea + botão enviar)

**Estilos:**
- Usa variáveis CSS do VS Code (`--vscode-*`) para tema automático
- Mensagens user: alinhadas à direita, fundo `--vscode-button-background`
- Mensagens assistant: alinhadas à esquerda, fundo `--vscode-editor-inactiveSelectionBackground`
- Mensagens system/tool: fonte menor, cor `--vscode-descriptionForeground`
- Status busy: ícone animado `$(sync~spin)` ou similar
- Streaming: div que cresce com tokens, cursor piscando no fim

**Comportamento JS (inline no HTML):**
- `send()`: pega texto do textarea, posta `{ type: 'send', text }`, limpa textarea
- `Ctrl+Enter` ou botão → envia
- `addMessage(role, content)`: cria div com classe da role, adiciona ao histórico, scroll para baixo
- `streamStart()`: cria div especial para streaming
- `streamToken(token)`: appenda token ao div de streaming (innerText +=)
- `streamEnd()`: finaliza div de streaming, aplica markdown básico
- `setStatus(text, state)`: atualiza a status bar

**Markdown básico** para mensagens do assistente:
- ` ```...``` ` → `<pre><code>...</code></pre>`
- `` `...` `` → `<code>...</code>`
- `**...**` → `<strong>...</strong>`
- `\n` → `<br>` (para texto simples)

**CSP (Content Security Policy):**
```
default-src 'none';
style-src 'unsafe-inline';
script-src 'unsafe-inline';
```

---

## 22. `src/ui/ModelManagerPanel.ts`

### Propósito
Webview para gerenciar modelos GGUF. Permite selecionar arquivo local ou baixar do Hugging Face.

### Classe `ModelManagerPanel`

```typescript
export class ModelManagerPanel {
  static readonly VIEW_TYPE = 'unplugged.modelManager';
  private static _instance: ModelManagerPanel | null = null;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _subs:  vscode.Disposable[] = [];
  private _downloadAbort?: AbortController;

  private constructor(
    private readonly _engine: LlamaEngine,
    extensionUri: vscode.Uri,
  ) {
    this._panel = vscode.window.createWebviewPanel(
      ModelManagerPanel.VIEW_TYPE,
      'Unplugged — Modelos',
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [extensionUri] }
    );
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this._dispose(), null, this._subs);
    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'browse':    await this._handleBrowse(); break;
        case 'download':  await this._handleDownload(msg.url, msg.destDir); break;
        case 'cancel':    this._downloadAbort?.abort(); break;
        case 'activate':  await this._handleActivate(msg.modelPath); break;
      }
    }, null, this._subs);
    this._sendState();
  }

  static open(engine: LlamaEngine, extensionUri: vscode.Uri): void {
    if (ModelManagerPanel._instance) {
      ModelManagerPanel._instance._panel.reveal();
      return;
    }
    ModelManagerPanel._instance = new ModelManagerPanel(engine, extensionUri);
  }
}
```

**`_handleBrowse(): Promise<void>`**
1. Abre `vscode.window.showOpenDialog({ filters: { 'Modelo GGUF': ['gguf'] }, canSelectMany: false })`
2. Se cancelado → retorna
3. Salva path em configuração: `vscode.workspace.getConfiguration('unplugged').update('modelPath', uri.fsPath, Global)`
4. Chama `engine.load(...)` com as configurações atuais
5. Posta `{ type: 'activated', modelPath: uri.fsPath }`

**`_handleDownload(url: string, destDir: string): Promise<void>`**
1. Valida que `url` começa com `https://huggingface.co/` (segurança)
2. `destDir` default: `os.homedir() + '/.unplugged-models'`
3. Cria diretório se não existir
4. `this._downloadAbort = new AbortController()`
5. `response = await fetch(url, { signal: _downloadAbort.signal })`
6. Obtém tamanho via `response.headers.get('content-length')`
7. Stream do body: lê chunks, escreve em arquivo, calcula progresso
8. A cada chunk posta `{ type: 'downloadProgress', pct, bytes, total }`
9. Ao terminar: posta `{ type: 'downloadDone', modelPath: destPath }`
10. Em erro (não abort): posta `{ type: 'downloadError', msg }`

**`_handleActivate(modelPath: string): Promise<void>`**
1. Atualiza `unplugged.modelPath` na configuração
2. Tenta `engine.load(...)` — se falhar, posta erro
3. Se ok, posta `{ type: 'activated', modelPath }`

**`_sendState(): void`**  
Posta `{ type: 'state', currentModelPath, isLoaded: engine.isLoaded }`

### HTML do ModelManagerPanel

**Seções:**
1. **Modelo Ativo** — exibe nome do arquivo .gguf atual e status (carregado/não carregado)
2. **Selecionar Arquivo Local** — botão "Procurar .gguf" que abre o file dialog
3. **Baixar do Hugging Face** — campo de URL (ex: `https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf`), campo de pasta destino, botão Baixar, barra de progresso

**Modelos recomendados** — lista estática de links pré-definidos para facilitar:
| Modelo | Tamanho | Uso |
|--------|---------|-----|
| Qwen2.5-Coder-7B Q4 | ~4.5GB | Geral, boa relação custo/benefício |
| Qwen2.5-Coder-3B Q4 | ~2GB | Máquinas mais modestas |
| DeepSeek-Coder-6.7B Q4 | ~4GB | Alternativa para código |

**JavaScript da UI:**
- Ao receber `state`: exibe nome do modelo ativo e status
- Ao receber `downloadProgress`: atualiza barra de progresso
- Ao receber `downloadDone`: pede ao usuário se quer ativar o modelo baixado
- Validação do campo URL: avisa se não começar com `https://huggingface.co/`

---

## 23. `src/extension.ts`

### Propósito
Ponto de entrada da extensão. Inicializa todos os serviços e registra comandos.

### Função `activate(context: vscode.ExtensionContext): void`

```typescript
export function activate(context: vscode.ExtensionContext): void {
  // 1. Determinar pasta de storage
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const storagePath = wsRoot
    ? path.join(wsRoot, '.unplugged')
    : context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  // 2. Instanciar serviços
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
    memoryPalace: palace,
  });

  const agent = new AgentLoop(engine, executor, optimizer, chatPanel, history, extRoot, palace);

  // 3. Carregar modelo se configurado
  const cfg = vscode.workspace.getConfiguration('unplugged');
  const modelPath = cfg.get<string>('modelPath') ?? '';

  if (modelPath) {
    _loadModel(engine, chatPanel, statusBar).catch(err => {
      console.error('[Unplugged] Falha ao carregar modelo:', err);
    });
  } else {
    chatPanel.setStatus('Configure um modelo — use Gerenciador de Modelos', 'idle');
  }

  // 4. Observar mudança de configuração do modelo
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('unplugged.modelPath') ||
          e.affectsConfiguration('unplugged.gpu') ||
          e.affectsConfiguration('unplugged.contextSize')) {
        _loadModel(engine, chatPanel, statusBar).catch(() => {});
      }
    })
  );

  // 5. Registrar ChatPanel como webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanel.VIEW_ID, chatPanel, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // 6. Handler de mensagem do usuário
  chatPanel.onUserMessage((text) => {
    if (!engine.isLoaded) {
      chatPanel.addMessage('system', 'Nenhum modelo carregado. Use "Unplugged: Gerenciador de Modelos" para configurar um modelo .gguf.');
      return;
    }
    agent.run(text).catch(err => {
      chatPanel.addMessage('system', 'Erro no agente: ' + (err instanceof Error ? err.message : String(err)));
      chatPanel.setStatus('erro', 'error');
    });
  });

  // 7. Registrar comandos (ver lista abaixo)
  _registerCommands(context, { engine, agent, history, chatPanel, statusBar, palace, optimizer, scanner, ctxGen, extRoot });

  // 8. Invalidar cache ao salvar arquivo
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      ctxGen.invalidateCache();
      scanner.invalidateCache();
    })
  );

  context.subscriptions.push(statusBar, chatPanel);
}

export function deactivate(): void {
  // engine.dispose() é chamado via subscription
}
```

### Função auxiliar `_loadModel`

```typescript
async function _loadModel(engine: LlamaEngine, chatPanel: ChatPanel, statusBar: vscode.StatusBarItem): Promise<void> {
  const cfg       = vscode.workspace.getConfiguration('unplugged');
  const modelPath = cfg.get<string>('modelPath') ?? '';

  if (!modelPath) {
    chatPanel.setStatus('Sem modelo configurado', 'idle');
    return;
  }

  const modelName = path.basename(modelPath, '.gguf');
  chatPanel.setStatus(`carregando ${modelName}...`, 'busy');

  try {
    await engine.load({
      modelPath,
      gpu:         cfg.get<string>('gpu') as LlamaEngineOptions['gpu'] ?? 'auto',
      contextSize: cfg.get<number>('contextSize') ?? 8192,
      maxTokens:   cfg.get<number>('maxTokens')   ?? 1024,
      temperature: cfg.get<number>('temperature') ?? 0.2,
    });
    chatPanel.setStatus(`pronto · ${modelName}`, 'ready');
    statusBar.text = `$(hubot) ${modelName}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    chatPanel.setStatus(`Erro ao carregar modelo: ${msg}`, 'error');
    vscode.window.showErrorMessage(`Unplugged: ${msg}`);
  }
}
```

### Comandos registrados

```typescript
// unplugged.openChat — abre a sidebar
vscode.commands.registerCommand('unplugged.openChat', () =>
  vscode.commands.executeCommand('workbench.view.extension.unplugged')
);

// unplugged.abort — aborta geração atual
vscode.commands.registerCommand('unplugged.abort', () => agent.abort());

// unplugged.indexWorkspace — gera arquivos .unplugged/
vscode.commands.registerCommand('unplugged.indexWorkspace', async () => {
  if (!wsRoot) { vscode.window.showErrorMessage('Nenhum workspace aberto.'); return; }
  // 1. Cria .unplugged/ se não existir
  // 2. Cria instructions.md vazio se não existir (com template)
  // 3. Cria dev-profile.md vazio se não existir (com template)
  // 4. Cria .unplugged/tutorials/ se não existir
  // 5. Invalida caches
  // 6. Mostra notification de sucesso
  chatPanel.addMessage('tool', 'Workspace indexado. Edite .unplugged/instructions.md para personalizar o comportamento do agente.');
  vscode.window.showInformationMessage('Unplugged: workspace preparado.');
});

// unplugged.showBriefing — abre documento markdown com o briefing atual
vscode.commands.registerCommand('unplugged.showBriefing', async () => {
  const task = await vscode.window.showInputBox({ prompt: 'Tarefa (opcional)' }) ?? '';
  const briefing = optimizer.build({ task });
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# Code Briefing\n\n**Tokens:** ~${briefing.tokenEstimate}\n\n---\n\n${briefing.text}`,
  });
  vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
});

// unplugged.saveMemory — UI para salvar entrada de memória
vscode.commands.registerCommand('unplugged.saveMemory', async () => {
  // QuickPick para tipo, InputBox para título, InputBox para conteúdo
  // Chama palace.save()
});

// unplugged.loadModel — abre file dialog para selecionar .gguf
vscode.commands.registerCommand('unplugged.loadModel', async () => {
  const uris = await vscode.window.showOpenDialog({
    filters: { 'Modelo GGUF': ['gguf'] },
    canSelectMany: false,
    title: 'Selecionar modelo .gguf',
  });
  if (!uris?.length) { return; }
  await vscode.workspace.getConfiguration('unplugged').update('modelPath', uris[0].fsPath, vscode.ConfigurationTarget.Global);
  // onDidChangeConfiguration vai chamar _loadModel automaticamente
});

// unplugged.clearHistory — limpa histórico do chat
vscode.commands.registerCommand('unplugged.clearHistory', () => {
  history.clear();
  chatPanel.clear();
  chatPanel.setStatus('histórico limpo', 'idle');
});

// unplugged.modelManager — abre painel de gerenciamento
vscode.commands.registerCommand('unplugged.modelManager', () => {
  ModelManagerPanel.open(engine, context.extensionUri);
});

// unplugged.openInstructions — abre .unplugged/instructions.md
vscode.commands.registerCommand('unplugged.openInstructions', async () => {
  if (!wsRoot) { return; }
  const p = path.join(wsRoot, '.unplugged', 'instructions.md');
  if (!fs.existsSync(p)) { fs.writeFileSync(p, _instructionsTemplate()); }
  vscode.window.showTextDocument(await vscode.workspace.openTextDocument(p), { preview: false });
});

// unplugged.openDevProfile — abre .unplugged/dev-profile.md
vscode.commands.registerCommand('unplugged.openDevProfile', async () => {
  if (!wsRoot) { return; }
  const p = path.join(wsRoot, '.unplugged', 'dev-profile.md');
  if (!fs.existsSync(p)) { fs.writeFileSync(p, _devProfileTemplate()); }
  vscode.window.showTextDocument(await vscode.workspace.openTextDocument(p), { preview: false });
});

// unplugged._testTool — testa tools individualmente (dev)
vscode.commands.registerCommand('unplugged._testTool', async () => {
  const tools = ['get_active_file','list_directory_tree','git_status','get_diagnostics','search_codebase'];
  const pick = await vscode.window.showQuickPick(tools.map(t => ({ label: t })));
  if (!pick) { return; }
  const result = await executor.execute({ id: 'test', toolName: pick.label, args: {} });
  chatPanel.addMessage('tool', `[${pick.label}]\n${result.content}`);
  vscode.commands.executeCommand('workbench.view.extension.unplugged');
});
```

### Templates de arquivo

**`_instructionsTemplate(): string`**
```markdown
# Instruções do Projeto

<!-- Edite este arquivo para personalizar o comportamento do Unplugged neste projeto. -->
<!-- O agente lê este arquivo em cada conversa. -->

## Convenções de Código

- (descreva suas convenções aqui)

## Arquitetura

- (descreva a arquitetura do projeto)

## O que NÃO fazer

- (liste comportamentos a evitar)
```

**`_devProfileTemplate(): string`**
```markdown
# Perfil do Desenvolvedor

<!-- Descreva quem você é e como prefere trabalhar. O agente usa isso para personalizar respostas. -->

## Experiência

- (ex: 5 anos de TypeScript, novo em Rust)

## Preferências

- (ex: prefiro funções pequenas, sem comentários óbvios)

## Contexto atual

- (ex: trabalhando em refactor do módulo de autenticação)
```

---

## 24. `resources/system-prompt.md`

Este arquivo é bundled com a extensão. O usuário pode sobrescrever criando `.unplugged/system-prompt.md` no workspace.

```markdown
Você é Unplugged, um agente de desenvolvimento de software local e offline.

## Identidade

- Você tem acesso ao workspace do desenvolvedor via ferramentas
- Você é preciso, direto e evita verbosidade desnecessária
- Você prefere editar código existente a criar do zero quando possível
- Você não faz suposições — usa as ferramentas para verificar antes de afirmar

## Comportamento

- Antes de editar um arquivo, sempre leia-o com read_file
- Prefira apply_edit a create_file quando o arquivo já existe
- Para tarefas que envolvam múltiplos arquivos, explore a estrutura primeiro com list_directory_tree
- Se não tiver certeza de algo, use search_codebase ou find_symbol para verificar
- Use save_memory para registrar decisões arquiteturais importantes

## Limitações

- Você roda localmente — sem acesso à internet
- Seus erros não são catastróficos: o usuário revisa edições antes de aplicar
- Se uma tarefa for ambígua, pergunte antes de executar

## Formato de resposta

- Respostas curtas para perguntas simples
- Para tarefas complexas, descreva o plano em 2-3 linhas antes de executar
- Use código em blocos de markdown quando mostrar exemplos
- Não explique o que o código faz linha a linha — apenas o porquê quando não for óbvio
```

---

## 25. Instruções de Build e Teste

### Setup inicial (workspace novo)

```bash
# 1. Criar estrutura
mkdir unplugged && cd unplugged
git init

# 2. Copiar package.json, tsconfig.json, .vscodeignore (da spec acima)

# 3. Instalar dependências
npm install

# 4. Recompilar módulos nativos para o Electron do VS Code
npm run rebuild

# 5. Compilar TypeScript
npm run compile

# 6. Abrir no VS Code para debug
code .
# Pressionar F5 → abre Extension Development Host
```

### Verificação de node-llama-cpp

Após `npm install`, verificar se o rebuild funcionou:
```bash
node -e "const {getLlama} = require('node-llama-cpp'); getLlama({gpu:'auto'}).then(l => console.log('OK:', l)).catch(e => console.error('FAIL:', e.message))"
```

Se falhar com erro de ABI, o `electron-rebuild` precisa ser reexecutado com a versão correta do Electron. Verificar a versão do VS Code via `Help > About` e ajustar `-v` no script de rebuild.

### Baixar um modelo para teste

Baixar um modelo GGUF pequeno para teste rápido (~2GB):
```
https://huggingface.co/bartowski/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf
```

Após baixar, configurar via `unplugged.modelPath` nas configurações do VS Code.

### Ordem de implementação recomendada

Para quem está implementando do zero, seguir nesta ordem — cada etapa é testável independentemente:

1. `package.json` + `tsconfig.json` + `npm install` + `npm run rebuild`
2. `src/memory/MemoryEntry.ts` (tipos puros, sem deps)
3. `src/memory/DigestCache.ts` (simples)
4. `src/memory/MemoryPalace.ts` (testar no node com `better-sqlite3`)
5. `src/safety/ApprovalService.ts`
6. `src/llm/ToolCallParser.ts` (testar com strings de exemplo)
7. `src/tools/ToolRegistry.ts` (tipos e constante)
8. `src/llm/LlamaEngine.ts` (testar carregamento de modelo)
9. `src/capture/*` (4 arquivos de captura)
10. `src/context/*` (3 arquivos de contexto)
11. `src/tools/ToolExecutor.ts` (implementar tool por tool, testar via `_testTool`)
12. `src/agent/MessageHistory.ts`
13. `src/agent/AgentLoop.ts`
14. `src/ui/ChatPanel.ts` (HTML primeiro, depois lógica TS)
15. `src/ui/ModelManagerPanel.ts`
16. `src/extension.ts` (monta tudo junto)
17. `resources/system-prompt.md`
18. Teste de fumaça E2E: abrir Extension Development Host, configurar modelo, enviar mensagem

### Checklist de fumaça

- [ ] Extensão ativa sem erros no console
- [ ] Status bar exibe nome do modelo ao carregar
- [ ] ChatPanel abre na sidebar
- [ ] Enviar "olá" retorna resposta em streaming
- [ ] Tool `get_active_file` retorna conteúdo do editor ativo
- [ ] Tool `list_directory_tree` exibe estrutura do workspace
- [ ] Tool `apply_edit` pede aprovação e aplica edição
- [ ] `save_memory` e `get_memory` funcionam
- [ ] Abortar geração com botão de cancelar funciona
- [ ] `limpar histórico` reseta o chat

---

*Fim do blueprint. Versão 2.0 — node-llama-cpp, zero Ollama.*
```
