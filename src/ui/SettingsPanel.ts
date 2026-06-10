import * as vscode from 'vscode';
import { LlamaEngine, LlamaEngineOptions } from '../llm/LlamaEngine';

export class SettingsPanel {
  static readonly VIEW_TYPE = 'unplugged.settings';
  private static _instance: SettingsPanel | null = null;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _subs:  vscode.Disposable[] = [];

  private constructor(
    private readonly _engine:    LlamaEngine,
    private readonly _extUri:    vscode.Uri,
    private readonly _onReload:  () => Promise<void>,
  ) {
    this._panel = vscode.window.createWebviewPanel(
      SettingsPanel.VIEW_TYPE,
      'Unplugged — Configurações',
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [this._extUri] },
    );
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this._dispose(), null, this._subs);
    this._panel.webview.onDidReceiveMessage(async (msg: {
      type: string;
      key?: string;
      value?: unknown;
    }) => {
      switch (msg.type) {
        case 'set':       await this._handleSet(msg.key ?? '', msg.value);  break;
        case 'browse':    await this._handleBrowse();                        break;
        case 'reset':     await this._handleReset();                         break;
        case 'reload':    await this._onReload();                            break;
      }
    }, null, this._subs);
    this._sendState();
  }

  static open(engine: LlamaEngine, extUri: vscode.Uri, onReload: () => Promise<void>): void {
    if (SettingsPanel._instance) {
      SettingsPanel._instance._panel.reveal();
      return;
    }
    SettingsPanel._instance = new SettingsPanel(engine, extUri, onReload);
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async _handleSet(key: string, value: unknown): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('unplugged');
    await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    this._sendState();
  }

  private async _handleBrowse(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Modelo GGUF': ['gguf'] },
      title: 'Selecionar modelo .gguf',
    });
    if (!uris?.length) { return; }
    const cfg = vscode.workspace.getConfiguration('unplugged');
    await cfg.update('modelPath', uris[0].fsPath, vscode.ConfigurationTarget.Global);
    this._sendState();
  }

  private async _handleReset(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('unplugged');
    const keys = [
      'gpu', 'contextSize', 'maxTokens', 'temperature',
      'approvalMode', 'maxContextFiles', 'contextBudget',
    ];
    for (const k of keys) {
      await cfg.update(k, undefined, vscode.ConfigurationTarget.Global);
    }
    this._sendState();
  }

  private _sendState(): void {
    const cfg = vscode.workspace.getConfiguration('unplugged');
    this._panel.webview.postMessage({
      type: 'state',
      state: {
        modelPath:       cfg.get<string>('modelPath')       ?? '',
        gpu:             cfg.get<string>('gpu')             ?? 'auto',
        contextSize:     cfg.get<number>('contextSize')     ?? 8192,
        maxTokens:       cfg.get<number>('maxTokens')       ?? 1024,
        temperature:     cfg.get<number>('temperature')     ?? 0.2,
        approvalMode:    cfg.get<string>('approvalMode')    ?? 'always',
        maxContextFiles: cfg.get<number>('maxContextFiles') ?? 10,
        contextBudget:   cfg.get<number>('contextBudget')   ?? 6000,
        gpuLoaded:       this._engine.isLoaded ? this._engine.gpuBackend : null,
      },
    });
  }

  private _dispose(): void {
    SettingsPanel._instance = null;
    for (const d of this._subs) { d.dispose(); }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unplugged — Configurações</title>
<style>
  :root {
    --bg:      var(--vscode-editor-background);
    --fg:      var(--vscode-editor-foreground);
    --border:  var(--vscode-panel-border, #444);
    --input-bg:var(--vscode-input-background);
    --input-fg:var(--vscode-input-foreground);
    --btn-bg:  var(--vscode-button-background);
    --btn-fg:  var(--vscode-button-foreground);
    --btn-hov: var(--vscode-button-hoverBackground);
    --accent:  var(--vscode-focusBorder, #007acc);
    --muted:   var(--vscode-descriptionForeground, #888);
    --sec-bg:  var(--vscode-sideBar-background, #1e1e1e);
    --warn:    #e8a000;
    --ok:      #4ec9b0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    background: var(--bg);
    color: var(--fg);
    padding: 0 0 48px;
  }
  header {
    background: var(--sec-bg);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    position: sticky; top: 0; z-index: 10;
  }
  header h1 { font-size: 15px; font-weight: 600; flex: 1; }
  .header-actions { display: flex; gap: 8px; }
  section {
    border-bottom: 1px solid var(--border);
    padding: 20px 24px;
  }
  section:last-of-type { border-bottom: none; }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--muted);
    margin-bottom: 16px;
  }
  .field { margin-bottom: 20px; }
  .field:last-child { margin-bottom: 0; }
  .field-label {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 3px;
  }
  .field-desc {
    color: var(--muted);
    font-size: 11px;
    margin-bottom: 8px;
    line-height: 1.5;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  input[type=range] {
    flex: 1;
    -webkit-appearance: none;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }
  input[type=number], input[type=text] {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 13px;
    outline: none;
    width: 88px;
  }
  input[type=number]:focus, input[type=text]:focus {
    border-color: var(--accent);
  }
  input[type=text].path-input {
    width: 100%;
    font-family: monospace;
    font-size: 12px;
  }
  .path-row { display: flex; gap: 8px; align-items: center; }
  .path-row input { flex: 1; }
  .badge {
    display: inline-block;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 10px;
    font-weight: 600;
    background: var(--sec-bg);
    border: 1px solid var(--border);
    color: var(--muted);
    margin-left: 6px;
    vertical-align: middle;
  }
  .badge.ok  { color: var(--ok);  border-color: var(--ok); }
  .badge.warn{ color: var(--warn);border-color: var(--warn); }
  .btn {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover { background: var(--btn-hov); }
  .btn.secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .btn.secondary:hover { background: var(--sec-bg); }
  .btn.danger {
    background: transparent;
    color: #f14c4c;
    border: 1px solid #f14c4c44;
  }
  .btn.danger:hover { background: #f14c4c22; }
  .seg-group {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .seg-btn {
    flex: 1;
    background: transparent;
    color: var(--fg);
    border: none;
    border-right: 1px solid var(--border);
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    text-align: center;
    transition: background .1s;
  }
  .seg-btn:last-child { border-right: none; }
  .seg-btn:hover { background: var(--sec-bg); }
  .seg-btn.active {
    background: var(--accent);
    color: #fff;
  }
  .value-display {
    font-size: 12px;
    font-family: monospace;
    color: var(--accent);
    min-width: 52px;
    text-align: right;
  }
  .reload-note {
    font-size: 11px;
    color: var(--warn);
    margin-top: 8px;
  }
</style>
</head>
<body>

<header>
  <h1>⚙ Configurações — Unplugged</h1>
  <div class="header-actions">
    <button class="btn secondary" onclick="reloadModel()">↺ Recarregar modelo</button>
    <button class="btn danger"    onclick="resetAll()">Restaurar padrões</button>
  </div>
</header>

<!-- MODELO -->
<section>
  <div class="section-title">Modelo</div>

  <div class="field">
    <div class="field-label">Arquivo .gguf <span id="gpu-badge" class="badge"></span></div>
    <div class="field-desc">Caminho absoluto para o modelo GGUF carregado. Use o botão para navegar.</div>
    <div class="path-row">
      <input type="text" class="path-input" id="modelPath" readonly placeholder="Nenhum modelo selecionado">
      <button class="btn" onclick="browse()">Selecionar…</button>
    </div>
  </div>

  <div class="field">
    <div class="field-label">Backend de GPU</div>
    <div class="field-desc">Backend de inferência. CUDA para NVIDIA, Vulkan para AMD/Intel, Metal para Apple Silicon.</div>
    <div class="seg-group" id="gpu-seg">
      <button class="seg-btn" data-gpu="auto"   onclick="setGpu('auto')">⚡ Auto</button>
      <button class="seg-btn" data-gpu="cuda"   onclick="setGpu('cuda')">🟢 CUDA</button>
      <button class="seg-btn" data-gpu="vulkan" onclick="setGpu('vulkan')">🔵 Vulkan</button>
      <button class="seg-btn" data-gpu="metal"  onclick="setGpu('metal')">⬛ Metal</button>
      <button class="seg-btn" data-gpu="cpu"    onclick="setGpu('cpu')">🖥 CPU</button>
    </div>
    <div class="reload-note" id="gpu-note" style="display:none">
      ⚠ Alterar o backend requer recarregar o modelo (botão acima).
    </div>
  </div>
</section>

<!-- CONTEXTO -->
<section>
  <div class="section-title">Contexto e Memória</div>

  <div class="field">
    <div class="field-label">Janela de contexto (contextSize)</div>
    <div class="field-desc">
      Número máximo de tokens na janela do modelo (KV-cache). Valor maior = conversa mais longa, mas usa mais VRAM.
      Mínimo: 2 048 · Máximo: 131 072
    </div>
    <div class="field-row">
      <input type="range" id="contextSize-range" min="2048" max="131072" step="1024"
             oninput="syncRange('contextSize', this.value)">
      <input type="number" id="contextSize-num" min="2048" max="131072" step="1024"
             oninput="syncNum('contextSize', this.value)">
      <span class="value-display" id="contextSize-display"></span>
    </div>
  </div>

  <div class="field">
    <div class="field-label">Budget de contexto de código (contextBudget)</div>
    <div class="field-desc">
      Limite de tokens reservado para o conteúdo do workspace (arquivo ativo, tutoriais, memória, lista de arquivos).
      Aumente para modelos com janela grande. Mínimo: 1 000 · Máximo: 32 000
    </div>
    <div class="field-row">
      <input type="range" id="contextBudget-range" min="1000" max="32000" step="500"
             oninput="syncRange('contextBudget', this.value)">
      <input type="number" id="contextBudget-num" min="1000" max="32000" step="500"
             oninput="syncNum('contextBudget', this.value)">
      <span class="value-display" id="contextBudget-display"></span>
    </div>
  </div>

  <div class="field">
    <div class="field-label">Máximo de arquivos no contexto (maxContextFiles)</div>
    <div class="field-desc">
      Quantos arquivos do workspace podem ser injetados no contexto por mensagem. Mínimo: 1 · Máximo: 50
    </div>
    <div class="field-row">
      <input type="range" id="maxContextFiles-range" min="1" max="50" step="1"
             oninput="syncRange('maxContextFiles', this.value)">
      <input type="number" id="maxContextFiles-num" min="1" max="50" step="1"
             oninput="syncNum('maxContextFiles', this.value)">
      <span class="value-display" id="maxContextFiles-display"></span>
    </div>
  </div>
</section>

<!-- GERAÇÃO -->
<section>
  <div class="section-title">Geração de texto</div>

  <div class="field">
    <div class="field-label">Máximo de tokens gerados (maxTokens)</div>
    <div class="field-desc">
      Limite de tokens que o modelo pode gerar por resposta. Respostas longas precisam de valores maiores.
      Mínimo: 256 · Máximo: 32 768
    </div>
    <div class="field-row">
      <input type="range" id="maxTokens-range" min="256" max="32768" step="256"
             oninput="syncRange('maxTokens', this.value)">
      <input type="number" id="maxTokens-num" min="256" max="32768" step="256"
             oninput="syncNum('maxTokens', this.value)">
      <span class="value-display" id="maxTokens-display"></span>
    </div>
  </div>

  <div class="field">
    <div class="field-label">Temperatura (temperature)</div>
    <div class="field-desc">
      Controla a aleatoriedade das respostas. 0 = determinístico (mais preciso para código),
      1+ = mais criativo. Para tarefas de código, 0.1–0.3 é o ideal.
      Mínimo: 0 · Máximo: 2
    </div>
    <div class="field-row">
      <input type="range" id="temperature-range" min="0" max="2" step="0.05"
             oninput="syncRange('temperature', this.value, true)">
      <input type="number" id="temperature-num" min="0" max="2" step="0.05"
             oninput="syncNum('temperature', this.value, true)">
      <span class="value-display" id="temperature-display"></span>
    </div>
  </div>
</section>

<!-- SEGURANÇA -->
<section>
  <div class="section-title">Segurança</div>

  <div class="field">
    <div class="field-label">Modo de aprovação (approvalMode)</div>
    <div class="field-desc">
      Define quando o agente pede confirmação antes de aplicar alterações ao workspace.
    </div>
    <div class="seg-group" id="approval-seg">
      <button class="seg-btn" data-approval="always"
              onclick="setApproval('always')">🔒 Sempre pedir</button>
      <button class="seg-btn" data-approval="destructive-only"
              onclick="setApproval('destructive-only')">⚠ Só em deletes e terminal</button>
    </div>
    <div class="field-desc" style="margin-top:8px" id="approval-desc"></div>
  </div>
</section>

<script>
  const vsc = acquireVsCodeApi();
  let _state = {};
  let _saveTimer = {};

  window.addEventListener('message', e => {
    if (e.data.type === 'state') { applyState(e.data.state); }
  });

  function applyState(s) {
    _state = s;

    // Model path
    document.getElementById('modelPath').value = s.modelPath || '';

    // GPU badge
    const badge = document.getElementById('gpu-badge');
    if (s.gpuLoaded !== null && s.gpuLoaded !== undefined) {
      badge.textContent = s.gpuLoaded ? s.gpuLoaded.toUpperCase() : 'CPU';
      badge.className   = 'badge ' + (s.gpuLoaded ? 'ok' : 'warn');
    } else {
      badge.textContent = 'não carregado';
      badge.className   = 'badge';
    }

    // GPU buttons
    document.querySelectorAll('#gpu-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.gpu === s.gpu);
    });

    // Sliders + numbers
    setSlider('contextSize',     s.contextSize);
    setSlider('contextBudget',   s.contextBudget);
    setSlider('maxContextFiles', s.maxContextFiles);
    setSlider('maxTokens',       s.maxTokens);
    setSlider('temperature',     s.temperature, true);

    // Approval
    document.querySelectorAll('#approval-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.approval === s.approvalMode);
    });
    const descs = {
      'always':           'Toda edição de arquivo, criação ou comando de terminal requer confirmação.',
      'destructive-only': 'Apenas deletes de arquivo e comandos de terminal pedem confirmação.',
    };
    document.getElementById('approval-desc').textContent = descs[s.approvalMode] ?? '';
  }

  function setSlider(key, value, isFloat) {
    const r = document.getElementById(key + '-range');
    const n = document.getElementById(key + '-num');
    const d = document.getElementById(key + '-display');
    if (!r) return;
    r.value = value;
    n.value = value;
    d.textContent = isFloat ? parseFloat(value).toFixed(2) : value;
  }

  function syncRange(key, value, isFloat) {
    const n = document.getElementById(key + '-num');
    const d = document.getElementById(key + '-display');
    n.value = value;
    d.textContent = isFloat ? parseFloat(value).toFixed(2) : parseInt(value);
    debounceSave(key, isFloat ? parseFloat(value) : parseInt(value));
  }

  function syncNum(key, value, isFloat) {
    const r = document.getElementById(key + '-range');
    const d = document.getElementById(key + '-display');
    r.value = value;
    d.textContent = isFloat ? parseFloat(value).toFixed(2) : parseInt(value);
    debounceSave(key, isFloat ? parseFloat(value) : parseInt(value));
  }

  function debounceSave(key, value) {
    clearTimeout(_saveTimer[key]);
    _saveTimer[key] = setTimeout(() => {
      vsc.postMessage({ type: 'set', key, value });
    }, 400);
  }

  function setGpu(gpu) {
    document.querySelectorAll('#gpu-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.gpu === gpu);
    });
    document.getElementById('gpu-note').style.display = 'block';
    vsc.postMessage({ type: 'set', key: 'gpu', value: gpu });
  }

  function setApproval(mode) {
    document.querySelectorAll('#approval-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.approval === mode);
    });
    const descs = {
      'always':           'Toda edição de arquivo, criação ou comando de terminal requer confirmação.',
      'destructive-only': 'Apenas deletes de arquivo e comandos de terminal pedem confirmação.',
    };
    document.getElementById('approval-desc').textContent = descs[mode] ?? '';
    vsc.postMessage({ type: 'set', key: 'approvalMode', value: mode });
  }

  function browse() {
    vsc.postMessage({ type: 'browse' });
  }

  function reloadModel() {
    document.getElementById('gpu-note').style.display = 'none';
    vsc.postMessage({ type: 'reload' });
  }

  function resetAll() {
    if (confirm('Restaurar todos os valores para os padrões?')) {
      vsc.postMessage({ type: 'reset' });
    }
  }
</script>
</body>
</html>`;
  }
}
