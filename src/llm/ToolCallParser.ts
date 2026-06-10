import { ToolSchema, ParsedToolCall } from '../tools/ToolRegistry';

export class ToolCallParser {
  fromXml(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = re.exec(text)) !== null) {
      const body = match[1].trim();

      if (body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as { name?: string; arguments?: Record<string, unknown> };
          if (parsed.name) {
            results.push({
              id:       `xml_${Date.now()}_${index++}`,
              toolName: parsed.name,
              args:     parsed.arguments ?? {},
            });
          }
        } catch { /* malformado, tenta formato tag */ }
        continue;
      }

      const nameMatch   = /<name>(.*?)<\/name>/s.exec(body);
      const paramsMatch = /<parameters>([\s\S]*?)<\/parameters>/s.exec(body);
      if (nameMatch) {
        let args: Record<string, unknown> = {};
        if (paramsMatch) {
          try { args = JSON.parse(paramsMatch[1].trim()); } catch { /* ok */ }
        }
        results.push({
          id:       `xml_${Date.now()}_${index++}`,
          toolName: nameMatch[1].trim(),
          args,
        });
      }
    }

    return results.length ? results : this._fromLooseJson(text);
  }

  hasXmlToolCalls(text: string): boolean {
    return /<tool_call>/.test(text) || this._fromLooseJson(text).length > 0;
  }

  private _fromLooseJson(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    let index = 0;

    for (const candidate of this._jsonObjectCandidates(text)) {
      try {
        const parsed = JSON.parse(candidate) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name !== 'string') { continue; }
        if (parsed.arguments !== undefined && !this._isObject(parsed.arguments)) { continue; }

        results.push({
          id:       `json_${Date.now()}_${index++}`,
          toolName: parsed.name,
          args:     parsed.arguments ?? {},
        });
      } catch { /* ignora JSON parcial ou texto comum */ }
    }

    return results;
  }

  private _jsonObjectCandidates(text: string): string[] {
    const candidates: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        if (depth === 0) { start = i; }
        depth++;
        continue;
      }

      if (ch === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return candidates;
  }

  private _isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // Builds the tool prompt in Qwen2.5-Instruct native format:
  // tools as JSON objects inside <tools> tags, calls as JSON inside <tool_call> tags.
  static buildXmlToolsPrompt(tools: ToolSchema[]): string {
    const toolsJson = tools
      .map(t => JSON.stringify(t))
      .join('\n');

    return [
      '# Ferramentas',
      '',
      'Você está executando DENTRO do VS Code com acesso real ao workspace do desenvolvedor.',
      'Você DEVE usar as ferramentas abaixo sempre que a tarefa envolver arquivos, código ou o projeto.',
      'Nunca diga "não consigo acessar arquivos" — você TEM ferramentas reais e DEVE usá-las.',
      '',
      'As ferramentas disponíveis estão listadas abaixo:',
      '<tools>',
      toolsJson,
      '</tools>',
      '',
      'Para chamar uma ferramenta, emita exatamente este bloco na sua resposta:',
      '<tool_call>',
      '{"name": "nome_da_ferramenta", "arguments": {"parametro": "valor"}}',
      '</tool_call>',
      '',
      'Você receberá o resultado e deve continuar. Chame quantas ferramentas forem necessárias.',
      '',
      '## Exemplos de uso obrigatório',
      '',
      'Usuário pede "liste os arquivos do projeto":',
      '<tool_call>',
      '{"name": "list_directory_tree", "arguments": {"path": "."}}',
      '</tool_call>',
      '',
      'Usuário pede "leia o arquivo extension.ts":',
      '<tool_call>',
      '{"name": "read_file", "arguments": {"path": "src/extension.ts"}}',
      '</tool_call>',
      '',
      'Usuário pede "o que tem no arquivo aberto":',
      '<tool_call>',
      '{"name": "get_active_file", "arguments": {}}',
      '</tool_call>',
    ].join('\n');
  }
}
