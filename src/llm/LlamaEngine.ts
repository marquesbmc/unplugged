import * as fs from 'fs';
import type {
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaChatSession,
  LlamaGpuType,
} from 'node-llama-cpp';

// Tipos que existem apenas em tempo de compilação — sem geração de require()
type LlamaCpp = typeof import('node-llama-cpp');

// Cache do módulo ESM carregado dinamicamente
let _llamaCppModule: LlamaCpp | null = null;

// new Function() impede que o TypeScript transforme import() em require()
// Isso é necessário porque node-llama-cpp v3 é ESM puro
async function _loadModule(): Promise<LlamaCpp> {
  if (!_llamaCppModule) {
    _llamaCppModule = await (
      new Function('m', 'return import(m)')('node-llama-cpp') as Promise<LlamaCpp>
    );
  }
  return _llamaCppModule;
}

export interface LlamaEngineOptions {
  modelPath:   string;
  contextSize: number;
  maxTokens:   number;
  temperature: number;
  gpu:         'auto' | 'cpu' | 'cuda' | 'vulkan' | 'metal';
}

export interface ChatMessage {
  role:    'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

type Disposable = { dispose?: () => void | Promise<void> };

export class LlamaEngine {
  private _llama:   Llama | null             = null;
  private _model:   LlamaModel | null        = null;
  private _context: LlamaContext | null      = null;
  private _opts:    LlamaEngineOptions | null = null;

  get isLoaded(): boolean { return this._model !== null; }

  async load(opts: LlamaEngineOptions): Promise<void> {
    if (
      this._opts?.modelPath   === opts.modelPath &&
      this._opts?.contextSize === opts.contextSize &&
      this._opts?.gpu         === opts.gpu
    ) {
      this._opts = opts;
      return;
    }

    await this.dispose();

    if (!fs.existsSync(opts.modelPath)) {
      throw new Error(`Modelo não encontrado: ${opts.modelPath}`);
    }

    const { getLlama, LlamaLogLevel } = await _loadModule();

    const gpuValue: 'auto' | LlamaGpuType =
      opts.gpu === 'cpu' ? false : opts.gpu as LlamaGpuType;

    this._llama   = await getLlama({ gpu: gpuValue, logLevel: LlamaLogLevel.error });
    this._model   = await this._llama.loadModel({ modelPath: opts.modelPath });
    this._context = await this._model.createContext({ contextSize: opts.contextSize });
    this._opts    = opts;
  }

  async *chat(
    systemPrompt: string,
    history:      ChatMessage[],
    userMessage:  string,
    signal?:      AbortSignal,
  ): AsyncGenerator<string> {
    if (!this._context || !this._opts) {
      throw new Error('LlamaEngine: modelo não carregado. Chame load() primeiro.');
    }

    const { LlamaChatSession } = await _loadModule();

    const sequence = this._context.getSequence();

    try {
      const session = new LlamaChatSession({
        contextSequence:     sequence,
        systemPrompt,
        autoDisposeSequence: false, // gerenciamos manualmente via finally
      });

      const llamaHistory = this._convertHistory(history);
      if (llamaHistory.length > 0) {
        session.setChatHistory(
          llamaHistory as Parameters<typeof session.setChatHistory>[0],
        );
      }

      const queue:  string[]            = [];
      let   ended                       = false;
      let   error:  unknown             = undefined;
      let   notify: (() => void) | null = null;

      const push = (token: string) => { queue.push(token); notify?.(); };

      const promptPromise = session.prompt(userMessage, {
        maxTokens:   this._opts.maxTokens,
        temperature: this._opts.temperature,
        signal,
        onTextChunk: (token: string) => push(token),
      }).then(() => {
        ended = true; notify?.();
      }).catch((err: unknown) => {
        error = err; ended = true; notify?.();
      });

      while (!ended || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>(resolve => { notify = resolve; });
          notify = null;
        }
      }

      await promptPromise.catch(() => {});

      if (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        if (!isAbort) { throw error; }
      }
    } finally {
      // Sempre libera a sequence de volta ao pool, independente de erro ou abort
      try { await (sequence as Disposable).dispose?.(); } catch { /* ok */ }
    }
  }

  async dispose(): Promise<void> {
    try { await (this._context as Disposable)?.dispose?.(); } catch { /* ok */ }
    try { await (this._model   as Disposable)?.dispose?.(); } catch { /* ok */ }
    this._context = null;
    this._model   = null;
    this._llama   = null;
    this._opts    = null;
  }

  private _convertHistory(history: ChatMessage[]): unknown[] {
    const result: unknown[] = [];
    for (const msg of history) {
      if (msg.role === 'system') { continue; }
      if (msg.role === 'user') {
        result.push({ type: 'user', text: msg.content });
      } else if (msg.role === 'assistant') {
        result.push({ type: 'model', response: [msg.content] });
      } else if (msg.role === 'tool') {
        result.push({ type: 'user',  text: `[RESULTADO DE FERRAMENTA]\n${msg.content}` });
        result.push({ type: 'model', response: ['Entendido.'] });
      }
    }
    return result;
  }
}
