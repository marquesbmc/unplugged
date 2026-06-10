<p align="center">
  <img src="logo.png" width="128" alt="Unplugged">
</p>

# Unplugged

Agente de desenvolvimento local para VS Code. Roda modelos GGUF diretamente no processo do editor — sem Ollama, sem servidor externo, sem cloud.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue?logo=visualstudiocode)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue?logo=typescript)
![node-llama-cpp](https://img.shields.io/badge/node--llama--cpp-v3-green)
![License](https://img.shields.io/badge/license-MIT-green)

---

## O que é

Unplugged integra um LLM local à sua sessão de VS Code. Você conversa com o agente no painel lateral e ele pode ler arquivos, aplicar edições, buscar no código, ver diagnósticos do TypeScript, consultar o git — tudo com aprovação explícita antes de qualquer escrita.

**Pilares:**

| | |
|---|---|
| **LLM local** | `node-llama-cpp v3` — GGUF com GPU (CUDA / Vulkan / Metal) ou CPU |
| **Contexto estruturado** | Até 8 camadas de contexto comprimidas em ~6000 tokens por mensagem (arquivo ativo, tutoriais, memória, config, instruções do projeto, perfil do desenvolvedor) |
| **Tool calling** | Formato XML no system prompt — funciona com qualquer modelo local |
| **Memória persistente** | Decisões, padrões e eventos salvos em `.unplugged/memory/palace.json` |
| **Segurança** | Aprovação do usuário antes de editar ou deletar arquivos |

---

## Funcionalidades

- Chat com streaming de tokens em tempo real
- 20 ferramentas: leitura/edição de arquivos, busca no código, git, diagnósticos, hover, go-to-definition, memória
- Gerenciador de modelos: selecione um `.gguf` local ou baixe direto do Hugging Face
- Personalização via `.unplugged/instructions.md` e `.unplugged/dev-profile.md` por projeto
- Memória por projeto — o agente pode salvar e consultar decisões arquiteturais

---

## Requisitos

- VS Code 1.85+
- Node.js 18+ (incluso no VS Code)
- Um modelo GGUF (veja recomendações abaixo)
- GPU opcional (NVIDIA CUDA, AMD/Intel Vulkan, Apple Metal)

---

## Instalação

### Modo desenvolvimento (F5)

```bash
git clone https://github.com/marquesbmc/unplugged
cd unplugged
npm install
# Recompila o módulo nativo para o Electron do VS Code:
npm run rebuild
npm run compile
```

Abra a pasta no VS Code e pressione **F5** — uma nova janela de extensão abre.

> **Windows:** o `npm run rebuild` usa `@electron/rebuild`. Se der erro de permissão, rode o terminal como administrador na primeira vez.

---

## Configuração

Após instalar, abra as configurações (`Ctrl+,`) e procure por `unplugged`:

| Configuração | Padrão | Descrição |
|---|---|---|
| `unplugged.modelPath` | `""` | Caminho absoluto para o arquivo `.gguf` |
| `unplugged.gpu` | `"auto"` | Backend de GPU: `auto`, `cpu`, `cuda`, `vulkan`, `metal` |
| `unplugged.contextSize` | `8192` | Janela de contexto em tokens |
| `unplugged.maxTokens` | `1024` | Máximo de tokens gerados por resposta |
| `unplugged.temperature` | `0.2` | Temperatura (0 = determinístico) |
| `unplugged.approvalMode` | `"always"` | `always` pede aprovação em toda edição; `destructive-only` só pede para delete/terminal |
| `unplugged.maxContextFiles` | `10` | Máximo de arquivos incluídos no contexto da LLM (1–50) |

Ou use o **Gerenciador de Modelos** (`Unplugged: Gerenciador de Modelos` na paleta de comandos) para selecionar o `.gguf` com interface gráfica.

---

## Modelos recomendados

A família **Qwen2.5-Coder-Instruct** é a mais recomendada para o Unplugged — segue system prompts e tool calling com alta fidelidade.

| GPU / RAM | Modelo recomendado | VRAM / RAM |
|---|---|---|
| Sem GPU / RAM limitada | `Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf` | ~2 GB |
| GPU ≤ 8 GB ou CPU ≥ 16 GB RAM | `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf` | ~4.5 GB |
| **GPU 10–16 GB VRAM** | **`Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf`** | **~9 GB** |
| GPU ≥ 24 GB VRAM | `Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf` | ~20 GB |

> Modelos menores (3B) seguem instruções com menos fidelidade e frequentemente ignoram tool calls.
> Para uso consistente do agente, prefira **14B ou superior** se sua GPU permitir.

Baixe via Gerenciador de Modelos (📚) ou direto do [Hugging Face](https://huggingface.co/models?search=qwen2.5-coder+gguf).

---

## Como usar

### Primeiro uso

1. Clique no ícone **🔌** na barra de atividades para abrir o painel lateral
2. Clique em 📚 **Gerenciador de Modelos** e selecione ou baixe um modelo `.gguf`
3. Aguarde o modelo carregar — o indicador no painel muda para **pronto**
4. Clique em 🗄️ **Indexar Workspace** para criar a estrutura `.unplugged/` no projeto
5. Comece a conversar — **Enter** envia, **Shift+Enter** pula linha

### Fluxo de uma conversa

Quando você envia uma mensagem, o agente:

1. **Monta o contexto** — arquivo ativo no editor, tutoriais do projeto, memória salva, configuração e instruções são empacotados dentro do budget de ~6000 tokens, por prioridade
2. **Gera a resposta** — tokens streamados em tempo real no painel
3. **Executa ferramentas** — se o modelo emitir chamadas XML, o Unplugged as intercepta e executa (leitura de arquivos, busca, git, etc.)
4. **Pede aprovação** — qualquer edição ou comando de terminal abre um diálogo de confirmação antes de ser aplicado
5. **Itera** — resultados das ferramentas voltam ao modelo; o ciclo repete até a resposta final (máximo 10 rodadas)

O painel exibe o consumo de contexto e o tempo de cada etapa após cada resposta.

### Botões do painel

Os ícones na barra de título do painel dão acesso rápido às ações principais:

| Ícone | Ação | O que faz |
|---|---|---|
| 🗄️ | **Indexar Workspace** | Cria `.unplugged/` com `instructions.md`, `dev-profile.md` e `tutorials/`; invalida caches de contexto |
| 📖 | **Ver Code Briefing** | Abre um preview markdown com o contexto atual do projeto (arquivo ativo, git, dependências) e a estimativa de tokens que será enviada ao modelo |
| 🔖 | **Salvar Memória** | Salva uma entrada manual na memória do projeto: escolha o tipo (decisão, padrão, risco, evento...), título e conteúdo |
| 🔧 | **Selecionar Modelo** | Abre o seletor de arquivo para escolher um `.gguf` local e carregá-lo imediatamente |
| 🗑️ | **Limpar Histórico** | Apaga todas as mensagens da conversa atual sem afetar a memória persistente |
| 📚 | **Gerenciador de Modelos** | Abre o painel de modelos para gerenciar, baixar e alternar entre modelos GGUF |
| ✏️ | **Instruções do Projeto** | Abre `.unplugged/instructions.md` no editor — defina aqui convenções de código, arquitetura e comportamentos esperados do agente |

### Aprovação de edições

Por padrão (`approvalMode: always`), o agente **sempre pede confirmação** antes de aplicar qualquer escrita. O diálogo mostra exatamente o que será alterado. Você pode aprovar, rejeitar ou editar antes de confirmar.

Com `approvalMode: destructive-only`, apenas deletes de arquivo e comandos de terminal pedem confirmação — edições de conteúdo são aplicadas diretamente.

### Memória por projeto

O agente pode salvar e recuperar informações entre sessões. As entradas ficam em `.unplugged/memory/palace.json` e são injetadas automaticamente no contexto quando relevantes.

Tipos de entrada disponíveis: `decision` · `pattern` · `risk` · `event` · `problem` · `workflow`

Você pode salvar manualmente via 🔖 ou deixar o agente salvar automaticamente quando detectar uma decisão relevante na conversa.

### Personalização por projeto

```bash
# Crie a estrutura com o comando "Unplugged: Indexar Workspace"

.unplugged/
├── instructions.md     # convenções, arquitetura e regras para o agente neste projeto
├── dev-profile.md      # seu perfil, experiência e preferências de trabalho
├── tutorials/          # arquivos .md com guias — selecionados por relevância a cada mensagem
└── memory/
    └── palace.json     # memória persistente do projeto (decisões, padrões, eventos)
```

**`instructions.md`** é lido em toda conversa. Use para descrever a arquitetura do projeto, convenções de código e o que o agente não deve fazer.

**`dev-profile.md`** descreve quem você é — nível de experiência, linguagens preferidas, estilo de resposta esperado.

**`tutorials/`** aceita qualquer `.md`. O agente seleciona os mais relevantes para a tarefa atual e os injeta no contexto automaticamente.

---

## Ferramentas disponíveis para o agente

| Ferramenta | Descrição |
|---|---|
| `get_active_file` | Arquivo aberto no editor |
| `read_file` | Lê qualquer arquivo do workspace |
| `apply_edit` | Substitui trecho exato (requer aprovação) |
| `create_file` | Cria novo arquivo |
| `delete_file` | Deleta arquivo (requer aprovação) |
| `run_terminal` | Envia comando ao terminal integrado |
| `list_directory_tree` | Árvore de diretórios |
| `list_files` | Busca por glob |
| `search_codebase` | Busca texto/regex no código |
| `get_diagnostics` | Erros e avisos TypeScript/ESLint |
| `find_symbol` | Definições de classes e funções |
| `find_definition` | Go-to-definition via Language Server |
| `find_references` | Referências via Language Server |
| `get_hover` | Informações de hover |
| `get_selection` | Texto selecionado no editor |
| `git_status` | Status git |
| `git_diff` | Diff de arquivos ou workspace |
| `save_memory` | Salva entrada na memória do projeto |
| `get_memory` | Busca na memória do projeto |
| `get_graph` | Grafo de dependências entre arquivos |

---

## Arquitetura

```
src/
├── llm/          LlamaEngine (node-llama-cpp), ToolCallParser (XML)
├── tools/        ToolRegistry (schemas), ToolExecutor (20 tools)
├── memory/       MemoryEntry, MemoryPalace (JSON), DigestCache
├── safety/       ApprovalService (confirmação do usuário)
├── capture/      ConfigScanner (ativo), WorkspaceCapture + GitAnalyzer + EnvironmentProbe (auxiliares)
├── context/      TutorialSelector, LlmContextOptimizer (ativos), WakeUpContextGenerator (auxiliar)
├── agent/        MessageHistory, AgentLoop (loop agêntico)
└── ui/           ChatPanel (webview sidebar), ModelManagerPanel
```

O `AgentLoop` roda até 10 rodadas por mensagem: gera resposta → parseia tool calls XML → executa → injeta resultados no histórico → repete até nenhuma tool call aparecer. O `LlmContextOptimizer` monta o contexto por prioridade dentro de um budget de ~6000 tokens.

---

## Desenvolvimento

```bash
npm run compile      # compila TypeScript → out/
npm run watch        # watch mode
npm run lint         # ESLint
npm run rebuild      # recompila node-llama-cpp para o Electron do VS Code
```

---

## Licença

MIT
