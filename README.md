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
| **Contexto estruturado** | 9 camadas de captura comprimidas em ~6000 tokens por mensagem |
| **Tool calling** | Formato XML no system prompt — funciona com qualquer modelo local |
| **Memória persistente** | Decisões, padrões e eventos salvos em `.unplugged/memory/palace.json` |
| **Segurança** | Aprovação do usuário antes de editar ou deletar arquivos |

---

## Funcionalidades

- Chat com streaming de tokens em tempo real
- 20 ferramentas: leitura/edição de arquivos, busca no código, git, diagnósticos, hover, go-to-definition, memória
- Botão 📁 para injetar a árvore de arquivos do projeto no contexto
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
git clone https://github.com/seu-usuario/unplugged
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

Ou use o **Gerenciador de Modelos** (`Unplugged: Gerenciador de Modelos` na paleta de comandos) para selecionar o `.gguf` com interface gráfica.

---

## Modelos recomendados

| Modelo | Tamanho | Ideal para |
|---|---|---|
| `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf` | ~4.5 GB | Melhor relação qualidade/custo, boa para tool calling |
| `Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf` | ~2 GB | Máquinas com menos de 8 GB de RAM |
| `DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf` | ~9 GB | Máquinas com GPU ≥ 12 GB VRAM |

> Modelos menores (3B) seguem instruções com menos fidelidade. Para tool calling consistente, prefira 7B+.

Baixe via Gerenciador de Modelos ou direto do [Hugging Face](https://huggingface.co/models?search=coder+gguf).

---

## Como usar

1. Clique no ícone **⚡** na barra de atividades para abrir o painel
2. Configure o modelo (primeira vez) via **Unplugged: Gerenciador de Modelos**
3. Digite no campo de chat — **Enter** envia, **Shift+Enter** pula linha
4. Use o botão **📁** para injetar a estrutura do projeto no contexto antes de perguntas sobre o código

### Personalização por projeto

```bash
# Crie a estrutura com o comando:
# "Unplugged: Indexar Workspace"

.unplugged/
├── instructions.md     # convenções e arquitetura do projeto
├── dev-profile.md      # seu perfil e preferências de trabalho
└── tutorials/          # arquivos .md selecionados por relevância
```

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
├── capture/      ConfigScanner, EnvironmentProbe, GitAnalyzer, WorkspaceCapture
├── context/      TutorialSelector, WakeUpContextGenerator, LlmContextOptimizer
├── agent/        MessageHistory, AgentLoop (loop agêntico)
└── ui/           ChatPanel (webview sidebar), ModelManagerPanel
```

O `AgentLoop` roda até 10 rodadas por mensagem: gera resposta → parseia tool calls XML → executa → injeta resultados no histórico → repete até nenhuma tool call aparecer.

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
