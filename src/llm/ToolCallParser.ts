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

    return results;
  }

  hasXmlToolCalls(text: string): boolean {
    return /<tool_call>/.test(text);
  }

  static buildXmlToolsPrompt(tools: ToolSchema[]): string {
    const lines = [
      '## FERRAMENTAS — LEIA COM ATENÇÃO',
      '',
      'Você está rodando DENTRO do VS Code com acesso total ao workspace do desenvolvedor.',
      'Você TEM ferramentas reais. Use-as SEMPRE que a tarefa envolver código, arquivos ou o projeto.',
      'NUNCA diga "não consigo acessar arquivos" — você PODE e DEVE usar as ferramentas abaixo.',
      '',
      'Para chamar uma ferramenta, emita exatamente este bloco XML na sua resposta:',
      '',
      '<tool_call>',
      '{"name": "nome_da_ferramenta", "arguments": {"parametro": "valor"}}',
      '</tool_call>',
      '',
      'Você receberá o resultado e deve continuar a resposta a partir dele.',
      'Chame quantas ferramentas forem necessárias, uma de cada vez.',
      '',
      '### Exemplo',
      '',
      'Usuário: "o que tem no arquivo main.ts?"',
      'Assistente:',
      '<tool_call>',
      '{"name": "get_active_file", "arguments": {}}',
      '</tool_call>',
      '',
      '[resultado chega aqui — você analisa e responde]',
      '',
      '### Ferramentas disponíveis',
    ];

    for (const t of tools) {
      const props  = t.function.parameters.properties;
      const params = Object.entries(props)
        .map(([k, v]) => `  - ${k}: ${v.description}`)
        .join('\n');
      lines.push('');
      lines.push(`**${t.function.name}** — ${t.function.description}`);
      if (params) { lines.push(params); }
      else        { lines.push('  (sem parâmetros)'); }
    }

    return lines.join('\n');
  }
}
