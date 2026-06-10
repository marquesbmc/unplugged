import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';
import * as vscode from 'vscode';
import { LlamaEngine, LlamaEngineOptions } from '../llm/LlamaEngine';

export class ModelManagerPanel {
  static readonly VIEW_TYPE = 'unplugged.modelManager';
  private static _instance: ModelManagerPanel | null = null;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _subs:  vscode.Disposable[] = [];
  private _downloadAbort?: AbortController;

  private constructor(
    private readonly _engine:  LlamaEngine,
    private readonly _extUri:  vscode.Uri,
  ) {
    this._panel = vscode.window.createWebviewPanel(
      ModelManagerPanel.VIEW_TYPE,
      'Unplugged — Modelos',
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [this._extUri] },
    );
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this._dispose(), null, this._subs);
    this._panel.webview.onDidReceiveMessage(async (msg: {
      type: string; url?: string; destDir?: string; modelPath?: string; gpu?: string;
    }) => {
      switch (msg.type) {
        case 'browse':     await this._handleBrowse();                              break;
        case 'download':   await this._handleDownload(msg.url ?? '', msg.destDir); break;
        case 'cancel':     this._downloadAbort?.abort();                            break;
        case 'activate':   await this._handleActivate(msg.modelPath ?? '');         break;
        case 'setGpu':     await this._handleSetGpu(msg.gpu ?? 'auto');             break;
      }
    }, null, this._subs);
    this._sendState();
  }

  static open(engine: LlamaEngine, extUri: vscode.Uri): void {
    if (ModelManagerPanel._instance) {
      ModelManagerPanel._instance._panel.reveal();
      return;
    }
    ModelManagerPanel._instance = new ModelManagerPanel(engine, extUri);
  }

  // ── Ações ─────────────────────────────────────────────────────────────────

  private async _handleBrowse(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      filters:       { 'Modelo GGUF': ['gguf'] },
      canSelectMany: false,
      title:         'Selecionar modelo .gguf',
    });
    if (!uris?.length) { return; }
    const modelPath = uris[0].fsPath;
    await vscode.workspace.getConfiguration('unplugged').update(
      'modelPath', modelPath, vscode.ConfigurationTarget.Global,
    );
    this._post({ type: 'activated', modelPath });
  }

  private async _handleDownload(url: string, destDir?: string): Promise<void> {
    if (!url.startsWith('https://huggingface.co/')) {
      this._post({ type: 'downloadError', msg: 'URL deve começar com https://huggingface.co/' });
      return;
    }
    const dir = destDir?.trim() || path.join(os.homedir(), '.unplugged-models');
    fs.mkdirSync(dir, { recursive: true });

    const fileName = url.split('/').pop() ?? 'model.gguf';
    const destPath = path.join(dir, fileName);

    this._downloadAbort = new AbortController();
    this._post({ type: 'downloadStart', fileName });

    try {
      const res = await fetch(url, { signal: this._downloadAbort.signal });
      if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
      const total  = Number(res.headers.get('content-length') ?? 0);
      const writer = fs.createWriteStream(destPath);
      let   bytes  = 0;

      const reader = res.body?.getReader();
      if (!reader) { throw new Error('Sem body na resposta.'); }

      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }
        writer.write(Buffer.from(value));
        bytes += value.length;
        const pct = total ? Math.round((bytes / total) * 100) : undefined;
        this._post({ type: 'downloadProgress', pct, bytes, total });
      }
      writer.end();
      this._post({ type: 'downloadDone', modelPath: destPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort') || msg.includes('AbortError')) {
        this._post({ type: 'downloadCancelled' });
      } else {
        this._post({ type: 'downloadError', msg });
      }
      if (fs.existsSync(destPath)) { try { fs.unlinkSync(destPath); } catch { /* ok */ } }
    } finally {
      this._downloadAbort = undefined;
    }
  }

  private async _handleActivate(modelPath: string): Promise<void> {
    if (!modelPath || !fs.existsSync(modelPath)) {
      this._post({ type: 'error', msg: `Arquivo não encontrado: ${modelPath}` });
      return;
    }
    await vscode.workspace.getConfiguration('unplugged').update(
      'modelPath', modelPath, vscode.ConfigurationTarget.Global,
    );
    this._post({ type: 'activated', modelPath });
  }

  private async _handleSetGpu(gpu: string): Promise<void> {
    await vscode.workspace.getConfiguration('unplugged').update(
      'gpu', gpu, vscode.ConfigurationTarget.Global,
    );
    this._sendState();
  }

  private _sendState(): void {
    const cfg       = vscode.workspace.getConfiguration('unplugged');
    const modelPath = cfg.get<string>('modelPath') ?? '';
    const gpu       = cfg.get<string>('gpu') ?? 'auto';
    const isLoaded  = this._engine.isLoaded;
    this._post({ type: 'state', modelPath, isLoaded, gpu });
  }

  private _post(msg: unknown): void { this._panel.webview.postMessage(msg); }

  private _dispose(): void {
    this._downloadAbort?.abort();
    ModelManagerPanel._instance = null;
    for (const d of this._subs) { d.dispose(); }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _buildHtml(): string {
    const recommended = [
      {
        name:  'Qwen2.5-Coder-14B Q4_K_M',
        size:  '~9 GB',
        gpu:   'NVIDIA ≥ 10 GB',
        desc:  'Melhor para tool calling — recomendado',
        url:   'https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
        star:  true,
      },
      {
        name:  'Qwen2.5-Coder-7B Q4_K_M',
        size:  '~4.5 GB',
        gpu:   'GPU ≥ 6 GB',
        desc:  'Boa qualidade, mais leve',
        url:   'https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
        star:  false,
      },
      {
        name:  'Qwen2.5-Coder-3B Q4_K_M',
        size:  '~2 GB',
        gpu:   'CPU / GPU ≤ 4 GB',
        desc:  'Máquinas com pouca memória',
        url:   'https://huggingface.co/bartowski/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-3B-Instruct-Q4_K_M.gguf',
        star:  false,
      },
      {
        name:  'Qwen2.5-Coder-32B Q4_K_M',
        size:  '~20 GB',
        gpu:   'GPU ≥ 24 GB',
        desc:  'Máxima qualidade',
        url:   'https://huggingface.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
        star:  false,
      },
    ];

    const recRows = recommended.map(m => `
      <tr${m.star ? ' class="row-star"' : ''}>
        <td class="col-name">
          ${m.star ? '<span class="tag-rec">✦ recomendado</span>' : ''}
          <strong>${esc(m.name)}</strong><br>
          <span class="dim">${esc(m.desc)}</span>
        </td>
        <td class="col-size">${esc(m.size)}</td>
        <td class="col-gpu">${esc(m.gpu)}</td>
        <td class="col-act">
          <button onclick="fillUrl('${esc(m.url)}')">Baixar</button>
        </td>
      </tr>`).join('');

    return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size:   var(--vscode-font-size);
  color:       var(--vscode-foreground);
  background:  var(--vscode-editor-background);
  padding: 20px 24px;
  display: flex; flex-direction: column; gap: 22px;
}
h2 { font-size: 11px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase;
     color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
.card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px; padding: 14px 16px; }
.dim { font-size: 11px; color: var(--vscode-descriptionForeground); }
.active-model { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
.badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
.badge.loaded  { background:#1e3a1e; color:#7ec87e; border:1px solid #2d5a2d; }
.badge.unloaded{ background:var(--vscode-editor-inactiveSelectionBackground); color:var(--vscode-descriptionForeground); }
button {
  border:1px solid var(--vscode-button-background); border-radius:4px;
  padding:4px 12px; font-size:12px; cursor:pointer;
  background:transparent; color:var(--vscode-button-background);
}
button:hover:not(:disabled) { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
button:disabled { opacity:.35; cursor:not-allowed; }
button.primary  { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:transparent; }
button.primary:hover:not(:disabled) { background:var(--vscode-button-hoverBackground); }
button.danger   { border-color:var(--vscode-errorForeground,#f44); color:var(--vscode-errorForeground,#f44); }
input[type=text] {
  flex:1; background:var(--vscode-input-background); color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent); border-radius:4px;
  padding:5px 9px; font-family:var(--vscode-editor-font-family,monospace); font-size:12px; outline:none; width:100%;
}
input[type=text]:focus { border-color:var(--vscode-focusBorder); }
.row { display:flex; gap:8px; align-items:center; margin-top:10px; }
.progress-wrap { margin-top:10px; display:flex; align-items:center; gap:8px; }
.progress-bar  { flex:1; height:5px; background:var(--vscode-scrollbarSlider-background); border-radius:3px; overflow:hidden; }
.progress-fill { height:100%; background:var(--vscode-charts-blue,#61afef); border-radius:3px; transition:width .3s; }
.progress-info { font-size:11px; color:var(--vscode-descriptionForeground); min-width:60px; }
table { width:100%; border-collapse:collapse; }
thead th { text-align:left; font-size:11px; font-weight:600; text-transform:uppercase;
           color:var(--vscode-descriptionForeground); padding:0 8px 8px;
           border-bottom:1px solid var(--vscode-panel-border); }
tbody tr { border-bottom:1px solid var(--vscode-panel-border,rgba(255,255,255,.06)); }
tbody tr:last-child { border-bottom:none; }
tbody tr.row-star { background: rgba(100,160,255,.06); }
td { padding:8px; vertical-align:middle; }
.col-size { width:70px; font-size:11px; color:var(--vscode-descriptionForeground); }
.col-gpu  { width:110px; font-size:11px; color:var(--vscode-descriptionForeground); }
.col-act  { width:70px; text-align:right; }
.tag-rec  { display:block; font-size:10px; font-weight:600; color:#61afef; margin-bottom:2px; }
.gpu-btns { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.gpu-btn  { font-size:12px; padding:5px 12px; }
.gpu-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:transparent; }
.error-box { background:rgba(244,71,71,.1); border:1px solid var(--vscode-errorForeground,#f44);
             border-radius:4px; padding:10px 14px; font-size:12px; color:var(--vscode-errorForeground,#f44); }
</style>
</head>
<body>

<div id="error-area"></div>

<div>
  <h2>Modelo Ativo</h2>
  <div class="card">
    <div id="active-info" class="dim">Nenhum modelo configurado.</div>
  </div>
</div>

<div>
  <h2>Configuração de GPU</h2>
  <div class="card">
    <div class="dim">Backend de inferência. Selecione conforme sua placa de vídeo.</div>
    <div class="gpu-btns">
      <button class="gpu-btn" id="gpu-auto"   onclick="setGpu('auto')">⚡ Auto</button>
      <button class="gpu-btn" id="gpu-cuda"   onclick="setGpu('cuda')">🟢 NVIDIA (CUDA)</button>
      <button class="gpu-btn" id="gpu-vulkan" onclick="setGpu('vulkan')">🔵 AMD / Intel (Vulkan)</button>
      <button class="gpu-btn" id="gpu-metal"  onclick="setGpu('metal')">⬛ Apple (Metal)</button>
      <button class="gpu-btn" id="gpu-cpu"    onclick="setGpu('cpu')">🖥 CPU</button>
    </div>
    <div class="dim" style="margin-top:8px" id="gpu-hint"></div>
  </div>
</div>

<div>
  <h2>Selecionar Arquivo Local</h2>
  <div class="card">
    <div class="dim">Aponte para um arquivo .gguf já baixado no seu computador.</div>
    <div class="row">
      <button class="primary" onclick="browse()">📂 Procurar .gguf...</button>
    </div>
  </div>
</div>

<div>
  <h2>Baixar do Hugging Face</h2>
  <div class="card">
    <div class="dim">Cole a URL direta do arquivo .gguf no Hugging Face.</div>
    <div style="margin-top:10px">
      <input type="text" id="url-input" placeholder="https://huggingface.co/.../model.Q4_K_M.gguf">
    </div>
    <div class="dim" style="margin-top:6px">Pasta destino (opcional):</div>
    <div style="margin-top:6px">
      <input type="text" id="dest-input" placeholder="Padrão: ~/.unplugged-models">
    </div>
    <div class="row">
      <button class="primary" id="dl-btn" onclick="startDownload()">⬇ Baixar</button>
      <button class="danger" id="cancel-btn" onclick="cancelDownload()" style="display:none">✕ Cancelar</button>
    </div>
    <div id="dl-progress" style="display:none">
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="dl-fill" style="width:0%"></div></div>
        <span class="progress-info" id="dl-info">—</span>
      </div>
      <div style="margin-top:4px; font-size:11px; color:var(--vscode-descriptionForeground)" id="dl-status"></div>
    </div>
  </div>
</div>

<div>
  <h2>Modelos Recomendados</h2>
  <table>
    <thead><tr>
      <th>Modelo</th><th class="col-size">Tamanho</th><th class="col-gpu">GPU</th><th class="col-act">Ação</th>
    </tr></thead>
    <tbody>${recRows}</tbody>
  </table>
</div>

<script>
  const vsc = acquireVsCodeApi();

  function browse()        { vsc.postMessage({ type: 'browse' }); }
  function cancelDownload(){ vsc.postMessage({ type: 'cancel' }); }

  const GPU_HINTS = {
    auto:   'Detecta automaticamente a melhor opção disponível.',
    cuda:   'NVIDIA — requer drivers CUDA instalados. Recomendado para placas NVIDIA.',
    vulkan: 'AMD ou Intel — usa Vulkan. Compatível com a maioria das placas modernas.',
    metal:  'Apple Silicon (M1/M2/M3) — máximo desempenho no Mac.',
    cpu:    'Sem GPU — mais lento, mas funciona em qualquer máquina.',
  };

  function setGpu(gpu) {
    vsc.postMessage({ type: 'setGpu', gpu });
    updateGpuButtons(gpu);
  }

  function updateGpuButtons(gpu) {
    ['auto','cuda','vulkan','metal','cpu'].forEach(g => {
      const btn = document.getElementById('gpu-' + g);
      if (btn) { btn.classList.toggle('active', g === gpu); }
    });
    document.getElementById('gpu-hint').textContent = GPU_HINTS[gpu] || '';
  }

  function fillUrl(url) {
    document.getElementById('url-input').value = url;
    document.getElementById('url-input').focus();
  }

  function startDownload() {
    const url     = document.getElementById('url-input').value.trim();
    const destDir = document.getElementById('dest-input').value.trim();
    if (!url) { showError('Informe a URL do modelo.'); return; }
    if (!url.startsWith('https://huggingface.co/')) {
      showError('URL deve começar com https://huggingface.co/');
      return;
    }
    vsc.postMessage({ type: 'download', url, destDir });
  }

  function showError(msg) {
    document.getElementById('error-area').innerHTML =
      '<div class="error-box">' + esc(msg) + '</div>';
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'state') {
      const name = m.modelPath ? m.modelPath.split(/[\\/]/).pop() : null;
      const badge = m.isLoaded
        ? '<span class="badge loaded">● Carregado</span>'
        : '<span class="badge unloaded">○ Não carregado</span>';
      document.getElementById('active-info').innerHTML = name
        ? '<span class="active-model">' + esc(name) + '</span> ' + badge
        : '<span class="dim">Nenhum modelo configurado.</span>';
      updateGpuButtons(m.gpu || 'auto');
      return;
    }
    if (m.type === 'activated') {
      const name = m.modelPath.split(/[\\/]/).pop();
      document.getElementById('active-info').innerHTML =
        '<span class="active-model">' + esc(name) + '</span> <span class="badge loaded">● Carregado</span>';
      document.getElementById('error-area').innerHTML = '';
      return;
    }
    if (m.type === 'downloadStart') {
      document.getElementById('dl-btn').disabled = true;
      document.getElementById('cancel-btn').style.display = '';
      document.getElementById('dl-progress').style.display = '';
      document.getElementById('dl-fill').style.width = '0%';
      document.getElementById('dl-status').textContent = 'Baixando ' + esc(m.fileName) + '...';
      return;
    }
    if (m.type === 'downloadProgress') {
      if (m.pct !== undefined) {
        document.getElementById('dl-fill').style.width = m.pct + '%';
        document.getElementById('dl-info').textContent = m.pct + '%';
      }
      if (m.bytes && m.total) {
        document.getElementById('dl-status').textContent =
          (m.bytes / 1e6).toFixed(0) + ' MB / ' + (m.total / 1e6).toFixed(0) + ' MB';
      }
      return;
    }
    if (m.type === 'downloadDone') {
      document.getElementById('dl-btn').disabled = false;
      document.getElementById('cancel-btn').style.display = 'none';
      document.getElementById('dl-fill').style.width = '100%';
      document.getElementById('dl-status').textContent = 'Download concluído!';
      vsc.postMessage({ type: 'activate', modelPath: m.modelPath });
      return;
    }
    if (m.type === 'downloadCancelled') {
      document.getElementById('dl-btn').disabled = false;
      document.getElementById('cancel-btn').style.display = 'none';
      document.getElementById('dl-progress').style.display = 'none';
      return;
    }
    if (m.type === 'downloadError' || m.type === 'error') {
      document.getElementById('dl-btn').disabled = false;
      document.getElementById('cancel-btn').style.display = 'none';
      document.getElementById('dl-progress').style.display = 'none';
      showError(m.msg);
      return;
    }
  });

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
