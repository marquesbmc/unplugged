export interface ToolParam {
  type:        'string' | 'number' | 'boolean';
  description: string;
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

export interface ToolResult {
  content: string;
}

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
