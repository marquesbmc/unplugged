import * as vscode from 'vscode';

type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
type StatusState = 'idle' | 'busy' | 'ready' | 'error';

interface StatusMsg { text: string; state: StatusState; }

export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly VIEW_ID = 'unplugged.chatView';

  private _view?:           vscode.WebviewView;
  private _onUserMsg?:  (text: string) => void;
  private _lastStatus: StatusMsg = { text: 'Inicializando...', state: 'idle' };

  constructor(private readonly _extensionUri: vscode.Uri) {}

  onUserMessage(cb: (text: string) => void): void { this._onUserMsg = cb; }

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = {
      enableScripts:      true,
      localResourceRoots: [this._extensionUri],
    };
    view.webview.html = this._buildHtml();

    view.webview.onDidReceiveMessage((msg: { type: string; text?: string }) => {
      if (msg.type === 'ready') {
        // Webview carregou — reenvia o status atual
        this._post({ type: 'status', ...this._lastStatus });
        return;
      }
      if (msg.type === 'send' && msg.text) { this._onUserMsg?.(msg.text); }
      if (msg.type === 'abort')            { vscode.commands.executeCommand('unplugged.abort'); }
    });
  }

  addMessage(role: MessageRole, content: string): void {
    this._post({ type: 'addMessage', role, content });
  }

  startStreaming(): void        { this._post({ type: 'streamStart' }); }
  appendToken(t: string): void  { this._post({ type: 'streamToken', token: t }); }
  endStreaming(): void          { this._post({ type: 'streamEnd' }); }

  setStatus(text: string, state: StatusState): void {
    this._lastStatus = { text, state };
    this._post({ type: 'status', text, state });
  }

  clear(): void { this._post({ type: 'clear' }); }

  dispose(): void { /* noop */ }

  private _post(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }

  private _buildHtml(): string {
    return `<!DOCTYPE html>
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
  background:  var(--vscode-sideBar-background, var(--vscode-editor-background));
  display: flex; flex-direction: column; height: 100vh; overflow: hidden;
}
#status-bar {
  padding: 5px 10px; font-size: 11px;
  border-bottom: 1px solid var(--vscode-panel-border);
  display: flex; align-items: center; gap: 6px; min-height: 26px;
  background: var(--vscode-editor-inactiveSelectionBackground);
}
#status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: var(--vscode-descriptionForeground);
}
#status-dot.ready { background: #4ec994; }
#status-dot.busy  { background: #e2c08d; animation: pulse 1s infinite; }
#status-dot.error { background: #f44747; }
#status-dot.idle  { background: var(--vscode-descriptionForeground); }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
#status-text {
  flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--vscode-descriptionForeground);
}
#messages {
  flex: 1; overflow-y: auto; padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.msg { max-width: 100%; word-break: break-word; }
.msg.user {
  align-self: flex-end;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  padding: 7px 11px; border-radius: 12px 12px 2px 12px;
  max-width: 85%; white-space: pre-wrap;
}
.msg.assistant {
  align-self: flex-start;
  background: var(--vscode-editor-inactiveSelectionBackground);
  padding: 8px 12px; border-radius: 2px 12px 12px 12px; max-width: 100%;
}
.msg.system {
  align-self: center; font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: pre-wrap; text-align: center; padding: 2px 6px;
}
.msg.tool {
  align-self: flex-start; font-size: 11px;
  font-family: var(--vscode-editor-font-family, monospace);
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
  padding: 4px 8px; border-left: 2px solid var(--vscode-panel-border);
  white-space: pre-wrap; max-width: 100%;
}
.msg.assistant pre {
  background: var(--vscode-editor-background); padding: 8px; border-radius: 4px;
  overflow-x: auto; margin: 4px 0;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
}
.msg.assistant code {
  background: var(--vscode-editor-background); padding: 1px 4px; border-radius: 3px;
  font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
}
.msg.assistant strong { font-weight: 600; }
.streaming::after { content: '▋'; animation: blink .7s infinite; }
@keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
#input-area {
  border-top: 1px solid var(--vscode-panel-border);
  padding: 8px; display: flex; gap: 6px; align-items: flex-end;
}
#input {
  flex: 1; background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px; padding: 6px 9px;
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
  resize: none; min-height: 36px; max-height: 120px; outline: none; line-height: 1.4;
}
#input:focus { border-color: var(--vscode-focusBorder); }
#send-btn {
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  border: none; border-radius: 4px; padding: 6px 10px;
  cursor: pointer; font-size: 13px; flex-shrink: 0; height: 36px;
}
#send-btn:hover    { background: var(--vscode-button-hoverBackground); }
#send-btn:disabled { opacity: .4; cursor: not-allowed; }
</style>
</head>
<body>
<div id="status-bar">
  <div id="status-dot" class="idle"></div>
  <span id="status-text">Carregando...</span>
</div>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" rows="1" placeholder="Digite uma mensagem... (Enter para enviar, Shift+Enter para nova linha)"></textarea>
  <button id="send-btn" onclick="send()">↑</button>
</div>
<script>
  var vsc       = acquireVsCodeApi();
  var msgs      = document.getElementById('messages');
  var input     = document.getElementById('input');
  var sendBtn   = document.getElementById('send-btn');
  var statusDot = document.getElementById('status-dot');
  var statusTxt = document.getElementById('status-text');
  var streamDiv = null;
  var busy      = false;

  // Avisa a extensao que o webview esta pronto
  vsc.postMessage({ type: 'ready' });

  function send() {
    var text = input.value.trim();
    if (!text || busy) { return; }
    addMsg('user', text);
    vsc.postMessage({ type: 'send', text: text });
    input.value = '';
    input.style.height = '';
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  input.addEventListener('input', function() {
    input.style.height = '';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  window.addEventListener('message', function(e) {
    var m = e.data;

    if (m.type === 'addMessage') {
      if (streamDiv) { finalizeStream(); }
      addMsg(m.role, m.content);
      return;
    }
    if (m.type === 'streamStart') {
      streamDiv = document.createElement('div');
      streamDiv.className = 'msg assistant streaming';
      msgs.appendChild(streamDiv);
      scrollBottom();
      return;
    }
    if (m.type === 'streamToken') {
      if (streamDiv) { streamDiv.textContent += m.token; scrollBottom(); }
      return;
    }
    if (m.type === 'streamEnd') {
      if (streamDiv) { finalizeStream(); }
      return;
    }
    if (m.type === 'status') {
      statusTxt.textContent = m.text;
      statusDot.className   = m.state || 'idle';
      busy = m.state === 'busy';
      sendBtn.disabled = busy;
      return;
    }
    if (m.type === 'clear') {
      msgs.innerHTML = '';
      streamDiv = null;
      return;
    }
  });

  function addMsg(role, content) {
    var div = document.createElement('div');
    div.className = 'msg ' + role;
    if (role === 'assistant') {
      div.innerHTML = renderMarkdown(content);
    } else {
      div.textContent = content;
    }
    msgs.appendChild(div);
    scrollBottom();
  }

  function finalizeStream() {
    if (!streamDiv) { return; }
    var raw = streamDiv.textContent;
    streamDiv.classList.remove('streaming');
    streamDiv.innerHTML = renderMarkdown(raw);
    streamDiv = null;
    scrollBottom();
  }

  function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

  // Usa RegExp() para evitar backtick literal dentro do script HTML
  var reCodeBlock  = new RegExp('\`\`\`(\\\\w*)\\\\n?([\\\\s\\\\S]*?)\`\`\`', 'g');
  var reInlineCode = new RegExp('\`([^\`\\\\n]+)\`', 'g');
  var reBold       = new RegExp('\\\\*\\\\*([^*]+)\\\\*\\\\*', 'g');

  function renderMarkdown(text) {
    text = text.replace(reCodeBlock, function(_, lang, code) {
      return '<pre><code>' + esc(code.trim()) + '</code><' + '/pre>';
    });
    text = text.replace(reInlineCode, function(_, c) {
      return '<code>' + esc(c) + '</code>';
    });
    text = text.replace(reBold, '<strong>$1</strong>');
    text = text.split('\\n').join('<br>');
    return text;
  }

  // Sem regex com < ou > para evitar confusao no parser HTML
  function esc(s) {
    return String(s)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }
</script>
</body>
</html>`;
  }
}
