import * as vscode from "vscode";
import { VIZFLOW_CSS } from "./vizflow-styles.js";
import { VIZFLOW_SCRIPT } from "./vizflow-script.js";
import { CodexRunner } from "./codex-runner.js";

export class VizFlowEditorProvider
  implements vscode.CustomTextEditorProvider, vscode.Disposable
{
  public static readonly viewType = "vizVibe.vizflowEditor";

  // Track active webview panel for search command
  private static activeWebviewPanel: vscode.WebviewPanel | null = null;
  private codexRunner: CodexRunner | null = null;
  private readonly codexOutput: vscode.OutputChannel;

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new VizFlowEditorProvider(context);
    const registration = vscode.window.registerCustomEditorProvider(
      VizFlowEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
    return vscode.Disposable.from(registration, provider);
  }

  // Trigger search in the active webview (called from extension.ts via Cmd+F)
  public static triggerSearch(): void {
    if (VizFlowEditorProvider.activeWebviewPanel) {
      VizFlowEditorProvider.activeWebviewPanel.webview.postMessage({
        type: "openSearch",
      });
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    this.codexOutput = vscode.window.createOutputChannel("Viz Vibe Codex");
  }

  public dispose(): void {
    this.codexRunner?.dispose();
    this.codexRunner = null;
    this.codexOutput.dispose();
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    void token;
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Track this as the active webview panel
    VizFlowEditorProvider.activeWebviewPanel = webviewPanel;

    // Update active panel when view state changes
    webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        VizFlowEditorProvider.activeWebviewPanel = e.webviewPanel;
      }
    });

    // Send current content to webview
    const updateWebview = () => {
      const mermaidCode = document.getText();
      webviewPanel.webview.postMessage({ type: "load", mermaidCode });
    };

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "ready") {
        // Webview is ready, send initial content
        updateWebview();
      } else if (message.type === "update") {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          message.mermaidCode,
        );
        await vscode.workspace.applyEdit(edit);
      } else if (message.type === "openInDefaultEditor") {
        // Open file in VS Code's default text editor for native search
        await vscode.commands.executeCommand(
          "vscode.openWith",
          document.uri,
          "default",
        );
      } else if (message.type === "launchAgent") {
        await this.launchAgent(message.agentId);
      } else if (message.type === "runCodexForNode") {
        await this.runCodexForNode(message.prompt || "");
      }
    });

    // Watch for document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          updateWebview();
        }
      },
    );

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      if (VizFlowEditorProvider.activeWebviewPanel === webviewPanel) {
        VizFlowEditorProvider.activeWebviewPanel = null;
      }
    });
  }

  // Rationale: the entire webview HTML/CSS/JS is embedded as a template string for simplicity of extension packaging and to avoid complexity of bundling separate assets.
  /* eslint-disable max-lines-per-function */
  private getHtmlForWebview(webview: vscode.Webview): string {
    void webview;
    return `<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
${VIZFLOW_CSS}
    </style>
</head>
<body>
    <!-- Toolbar -->
    <div class="toolbar">
        <button class="secondary" onclick="openInDefaultEditor()" title="Open in VS Code editor">📝 Edit Source</button>

        <select id="flowDirection" onchange="changeDirection()" title="Layout direction">
            <option value="TD">↓ Top-Down</option>
            <option value="LR">→ Left-Right</option>
            <option value="BT">↑ Bottom-Top</option>
            <option value="RL">← Right-Left</option>
        </select>

        <span class="spacer"></span>

        <div class="search-container">
            <button class="secondary" onclick="toggleSearch()" title="Search nodes (Cmd+F)">🔍 Search</button>
            <div id="search-box" class="search-box">
                <input type="text" id="search-input" placeholder="Search nodes..." autocomplete="off" />
                <span id="search-info" class="search-info"></span>
                <div class="search-nav">
                    <button onclick="navigateSearch(-1)" title="Previous (Shift+Enter)">▲</button>
                    <button onclick="navigateSearch(1)" title="Next (Enter)">▼</button>
                </div>
                <button class="search-close" onclick="closeSearch()">×</button>
            </div>
        </div>
    </div>

    <!-- Main container -->
    <div class="main-container">
        <!-- Graph view -->
        <div id="graph-view">
            <div id="canvas-wrapper">
                <div id="mermaid-container">
                    <div id="mermaid-output"></div>
                </div>
            </div>

            <!-- Node info card -->
            <div id="info-card" class="info-card" style="display:none;">
                <button class="close-btn" onclick="closeInfoCard()">×</button>
                <h4 id="info-label"></h4>
                <p id="info-prompt"></p>
                <button class="copy-btn" onclick="copyNodeInfo()">📋 Copy</button>
            </div>

            <!-- Zoom controls -->
            <div class="zoom-controls">
                <button onclick="zoomIn()" title="Zoom in">+</button>
                <div class="zoom-level" id="zoomLevel">100%</div>
                <button onclick="zoomOut()" title="Zoom out">−</button>
                <button onclick="fitToScreen()" title="Fit to screen" style="font-size:12px;">⊞</button>
            </div>

            <!-- Floating agent launcher -->
            <div class="agent-menu floating">
                <button class="secondary agent-trigger" onclick="toggleAgentPanel()" title="Run agents">🤖</button>
                <div id="agent-panel" class="agent-panel">
                    <div class="agent-panel-title">Run Agent</div>
                    <div class="agent-grid">
                        <button onclick="launchAgent('codex')">Codex</button>
                        <button onclick="launchAgent('claude-code')">Claude Code</button>
                        <button onclick="launchAgent('opencode')">OpenCode</button>
                        <button onclick="launchAgent('cursor-agent')">Cursor Agent</button>
                        <button onclick="launchAgent('copilot')">Copilot</button>
                        <button onclick="launchAgent('kiro')">Kiro</button>
                    </div>
                    <div class="agent-panel-hint">Runs commands in terminal or opens chat (Copilot).</div>
                </div>
            </div>

            <!-- Initialization prompt overlay -->
            <div id="init-prompt-overlay" class="init-prompt-overlay">
                <div class="init-prompt-card">
                    <div class="init-prompt-title" style="font-size:28px;margin-bottom:24px;">Copy this and<br/>Ask your AI agent to setup vizvibe! 👇</div>
                    <div id="init-prompt-code" class="init-prompt-code" onclick="copyInitPrompt()" style="font-size:14px;padding:20px 24px;">
                        "Please setup vizvibe for this project.<br/>Write the trajectory in my language."
                    </div>
                    <div class="language-selector">
                        <div class="language-dropdown-wrapper">
                            <select id="langSelect" class="language-dropdown" onchange="updatePromptLanguage()">
                                <option value="">🌍 Select language (optional)</option>
                                <option value="English">🇺🇸 English</option>
                                <option value="Korean">🇰🇷 한국어 (Korean)</option>
                                <option value="Japanese">🇯🇵 日本語 (Japanese)</option>
                                <option value="Chinese (Simplified)">🇨🇳 简体中文 (Chinese Simplified)</option>
                                <option value="Chinese (Traditional)">🇹🇼 繁體中文 (Chinese Traditional)</option>
                                <option value="Spanish">🇪🇸 Español (Spanish)</option>
                                <option value="French">🇫🇷 Français (French)</option>
                                <option value="German">🇩🇪 Deutsch (German)</option>
                                <option value="Portuguese">🇧🇷 Português (Portuguese)</option>
                                <option value="Italian">🇮🇹 Italiano (Italian)</option>
                                <option value="Russian">🇷🇺 Русский (Russian)</option>
                                <option value="Arabic">🇸🇦 العربية (Arabic)</option>
                                <option value="Hindi">🇮🇳 हिन्दी (Hindi)</option>
                                <option value="Thai">🇹🇭 ไทย (Thai)</option>
                                <option value="Vietnamese">🇻🇳 Tiếng Việt (Vietnamese)</option>
                                <option value="Indonesian">🇮🇩 Bahasa Indonesia (Indonesian)</option>
                                <option value="Dutch">🇳🇱 Nederlands (Dutch)</option>
                                <option value="Polish">🇵🇱 Polski (Polish)</option>
                                <option value="Turkish">🇹🇷 Türkçe (Turkish)</option>
                                <option value="Ukrainian">🇺🇦 Українська (Ukrainian)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </div>

    <!-- Context menu -->
    <div id="context-menu" class="context-menu">
        <div class="context-menu-item" onclick="copyNodeId()">Copy Node ID</div>
        <div class="context-menu-item" onclick="copyNodeLabel()">Copy Label</div>
        <div class="context-menu-item" onclick="copyNodeDescription()">Copy Description</div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" onclick="copyNodeAll()">Copy All</div>
    </div>

    <!-- Toast notification -->
    <div id="toast" class="toast"></div>

    <!-- Status bar -->
    <div class="status-bar">
        <span><span class="status-dot"></span>Ready</span>
        <span id="nodeCount">Nodes: 0</span>
        <span class="spacer"></span>
        <span class="help-hint">🖱 Scroll: Pan • ⌘/Ctrl+Scroll: Zoom • Click: Info • Cmd+F: Search</span>
    </div>

    <!-- Add node modal -->
    <div id="addNodeModal" class="modal-overlay">
        <div class="modal">
            <h3 id="modalTitle">Add New Node</h3>
            <input type="hidden" id="nodeType" />
            <label>Node ID (letters, numbers, _ only)</label>
            <input type="text" id="nodeId" placeholder="e.g. task_login_impl" />
            <label>Label (displayed on graph)</label>
            <input type="text" id="nodeLabel" placeholder="e.g. Login Implementation" />
            <label>Description (details)</label>
            <textarea id="nodePrompt" placeholder="e.g. JWT-based login implementation"></textarea>
            <label>Connect from (optional)</label>
            <select id="connectFrom">
                <option value="">No connection</option>
            </select>
            <div class="modal-buttons">
                <button class="secondary" onclick="closeAddNodeModal()">Cancel</button>
                <button onclick="confirmAddNode()">Add</button>
            </div>
        </div>
    </div>

    <script>
${VIZFLOW_SCRIPT}
    </script>
</body>
</html>`;
  }

  private async launchAgent(agentId: string): Promise<void> {
    const agentMap: Record<
      string,
      {
        label: string;
        settingKey: string;
        defaultCommand: string;
        preferCommand?: string[];
      }
    > = {
      codex: {
        label: "Codex",
        settingKey: "agentCommands.codex",
        defaultCommand: "codex",
      },
      "claude-code": {
        label: "Claude Code",
        settingKey: "agentCommands.claudeCode",
        defaultCommand: "claude",
      },
      opencode: {
        label: "OpenCode",
        settingKey: "agentCommands.openCode",
        defaultCommand: "opencode",
      },
      "cursor-agent": {
        label: "Cursor Agent",
        settingKey: "agentCommands.cursorAgent",
        defaultCommand: "cursor-agent",
      },
      copilot: {
        label: "Copilot",
        settingKey: "agentCommands.copilot",
        defaultCommand: "",
        preferCommand: [
          "github.copilot.chat.open",
          "github.copilot.chat.focus",
        ],
      },
      kiro: {
        label: "Kiro",
        settingKey: "agentCommands.kiro",
        defaultCommand: "kiro",
      },
    };

    const agent = agentMap[agentId];
    if (!agent) {
      vscode.window.showWarningMessage(`Unknown agent: ${agentId}`);
      return;
    }

    if (agent.preferCommand) {
      for (const command of agent.preferCommand) {
        try {
          await vscode.commands.executeCommand(command);
          return;
        } catch {
          // Fall back to terminal command if VS Code command is unavailable.
        }
      }
    }

    const command = await this.resolveAgentCommand(agent);
    if (!command) return;

    this.runTerminalCommand(agent.label, command);
  }

  private async runCodexForNode(prompt: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage(
        "Viz Vibe: Please open a workspace to run Codex.",
      );
      return;
    }
    if (!this.codexRunner) {
      this.codexRunner = new CodexRunner(this.codexOutput, workspaceRoot);
    }
    try {
      const response = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Viz Vibe: Running Codex...",
          cancellable: false,
        },
        async () => this.codexRunner!.sendPrompt(prompt),
      );
      if (response && response.trim().length > 0) {
        await this.showCodexResponse(prompt, response);
      } else {
        const action = await vscode.window.showInformationMessage(
          "Viz Vibe: Codex completed without a final message.",
          "Open Logs",
        );
        if (action === "Open Logs") {
          this.codexOutput.show(true);
        }
      }
    } catch (error) {
      this.codexOutput.appendLine(`[error] ${String(error)}`);
      const action = await vscode.window.showErrorMessage(
        "Viz Vibe: Failed to run Codex. See output for details.",
        "Open Logs",
      );
      if (action === "Open Logs") {
        this.codexOutput.show(true);
      }
    }
  }

  private async showCodexResponse(
    prompt: string,
    response: string,
  ): Promise<void> {
    const promptQuote = prompt
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const content = [
      "# Viz Vibe Codex Response",
      "",
      "## Prompt",
      promptQuote || "> (empty prompt)",
      "",
      "## Response",
      response,
      "",
      "---",
      `_Generated: ${new Date().toLocaleString()}_`,
    ].join("\n");

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content,
    });
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
  }

  private async resolveAgentCommand(agent: {
    label: string;
    settingKey: string;
    defaultCommand: string;
  }): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("vizVibe");
    let command = config.get<string>(agent.settingKey);
    if (!command) {
      command = await vscode.window.showInputBox({
        prompt: `Enter command to launch ${agent.label} (use {prompt} to inject text)`,
        value: agent.defaultCommand || "",
      });
      if (!command) {
        vscode.window.showInformationMessage(`${agent.label} launch canceled.`);
        return undefined;
      }
      await config.update(
        agent.settingKey,
        command,
        vscode.ConfigurationTarget.Global,
      );
    }
    return command;
  }

  private runTerminalCommand(label: string, command: string): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: `Viz Vibe: ${label}`,
      cwd: workspaceRoot,
    });
    terminal.show(true);
    terminal.sendText(command, true);
  }
}

