// Rationale: extracted CSS styles from VizFlowEditorProvider for readability; content size is inherent to the webview UI.
/* eslint-disable max-lines */
/** Extracted CSS styles for the VizFlow webview. */
export const VIZFLOW_CSS = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background); 
            color: var(--vscode-editor-foreground);
            height: 100vh; overflow: hidden;
            display: flex; flex-direction: column;
        }

        .toolbar {
            display: flex; gap: 6px; padding: 8px 12px;
            background: var(--vscode-editorWidget-background);
            border-bottom: 1px solid var(--vscode-editorWidget-border);
            align-items: center; z-index: 100;
            flex-wrap: wrap;
        }
        .toolbar button {
            padding: 4px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none; border-radius: 4px; cursor: pointer;
            font-size: 11px; font-weight: 500;
            transition: all 0.15s;
        }
        .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
        .toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .toolbar button.danger { background: #dc3545; color: white; }
        .spacer { flex: 1; }
        .toolbar select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            font-size: 11px;
        }
        .agent-menu {
            position: relative;
        }
        .agent-menu.floating {
            position: absolute;
            bottom: 64px;
            right: 16px;
            z-index: 60;
        }
        .agent-menu .agent-trigger {
            width: 36px;
            height: 36px;
            padding: 0;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .agent-panel {
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 8px;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.4);
            z-index: 300;
            min-width: 220px;
            display: none;
        }
        .agent-panel.active { display: block; }
        .agent-panel-title {
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-menu-foreground);
        }
        .agent-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
        }
        .agent-panel button {
            padding: 6px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            cursor: pointer;
            font-size: 11px;
            text-align: left;
        }
        .agent-panel button:hover { background: var(--vscode-button-hoverBackground); }
        .agent-panel-hint {
            margin-top: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        /* Main container */
        .main-container {
            flex: 1;
            display: flex;
            overflow: hidden;
        }

        /* Graph view */
        #graph-view { 
            flex: 1; position: relative; overflow: hidden;
            cursor: grab;
            background-image: radial-gradient(circle, var(--vscode-editorLineNumber-foreground) 0.5px, transparent 0.5px);
            background-size: 20px 20px;
            user-select: none;
            -webkit-user-select: none;
        }
        #graph-view.grabbing { cursor: grabbing; }

        #canvas-wrapper {
            position: absolute;
            transform-origin: 0 0;
        }

        #mermaid-container {
            background: var(--vscode-editor-background);
            border-radius: 8px;
            padding: 20px;
            display: inline-block;
            border: 1px solid var(--vscode-editorWidget-border);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        /* Node hover */
        .node rect, .node polygon, .node circle, .node ellipse {
            cursor: grab;
            transition: all 0.15s;
        }
        .node.dragging rect, .node.dragging polygon, .node.dragging circle, .node.dragging ellipse {
            cursor: grabbing;
        }
        .node:hover rect, .node:hover polygon, .node:hover circle {
            filter: brightness(1.15);
        }
        .node-play {
            cursor: pointer;
        }
        .node-play circle {
            fill: #111827;
            stroke: #22c55e;
            stroke-width: 1.5px;
            filter: drop-shadow(0 0 6px rgba(34, 197, 94, 0.35));
        }
        .node-play polygon {
            fill: #22c55e;
        }

        .status-bar {
            padding: 6px 16px;
            background: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            font-size: 11px; display: flex; gap: 20px; align-items: center;
            z-index: 100;
        }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4CAF50; display: inline-block; margin-right: 6px; }
        .help-hint { font-size: 10px; color: var(--vscode-descriptionForeground); }

        /* Node info card */
        .info-card {
            position: absolute;
            bottom: 16px; left: 16px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 8px;
            padding: 12px 16px;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 50;
        }
        .info-card h4 {
            margin-bottom: 6px;
            color: var(--vscode-textLink-foreground);
            font-size: 13px;
        }
        .info-card p {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            white-space: pre-wrap;
        }
        .info-card .close-btn {
            position: absolute; top: 8px; right: 8px;
            background: none; border: none; color: var(--vscode-descriptionForeground);
            cursor: pointer; font-size: 14px;
        }
        .info-card .copy-btn {
            margin-top: 8px;
            padding: 4px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none; border-radius: 4px; cursor: pointer;
            font-size: 10px;
        }
        .info-card .copy-btn:hover { background: var(--vscode-button-hoverBackground); }

        /* Context menu */
        .context-menu {
            position: fixed;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 6px;
            padding: 4px 0;
            min-width: 160px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            z-index: 1000;
            display: none;
        }
        .context-menu.active { display: block; }
        .context-menu-item {
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
        }
        .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }
        .context-menu-divider {
            height: 1px;
            background: var(--vscode-menu-separatorBackground);
            margin: 4px 0;
        }

        /* Toast notification */
        .toast {
            position: fixed;
            bottom: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--vscode-notificationsInfoIcon-foreground);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1001;
            opacity: 0;
            transition: opacity 0.3s;
        }
        .toast.show { opacity: 1; }

        /* Search box */
        .search-container {
            position: relative;
            display: flex;
            align-items: center;
        }
        .search-box {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 8px 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 200;
            min-width: 280px;
        }
        .search-box.active { display: flex; gap: 8px; align-items: center; }
        .search-box input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: var(--vscode-input-foreground);
            font-size: 12px;
            min-width: 180px;
        }
        .search-box input::placeholder { color: var(--vscode-input-placeholderForeground); }
        .search-info {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        .search-nav {
            display: flex;
            gap: 2px;
        }
        .search-nav button {
            padding: 2px 6px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }

        .search-nav button:hover { background: var(--vscode-button-hoverBackground); }
        .search-close {
            background: none !important;
            color: var(--vscode-descriptionForeground) !important;
            font-size: 14px !important;
            padding: 2px 4px !important;
        }

        /* Node & Cluster highlight for search */
        .node.search-match rect,
        .node.search-match polygon,
        .node.search-match circle,
        .node.search-match ellipse,
        .cluster.search-match rect {
            filter: brightness(1.2) drop-shadow(0 0 8px rgba(74, 222, 128, 0.6));
        }
        .node.search-current rect,
        .node.search-current polygon,
        .node.search-current circle,
        .node.search-current ellipse,
        .cluster.search-current rect {
            filter: brightness(1.4) drop-shadow(0 0 12px rgba(250, 204, 21, 0.8));
            stroke: #facc15 !important;
            stroke-width: 3px !important;
        }
        .node.search-dimmed,
        .cluster.search-dimmed {
            opacity: 0.3;
        }

        /* Zoom controls */
        .zoom-controls {
            position: absolute;
            bottom: 16px; right: 16px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            z-index: 50;
        }
        .zoom-controls button {
            width: 32px; height: 32px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .zoom-controls button:hover { background: var(--vscode-button-hoverBackground); }
        .zoom-level {
            text-align: center;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            padding: 4px;
        }

        /* Initialization prompt overlay */
        .init-prompt-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            display: none;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.95) 100%);
            z-index: 80;
            backdrop-filter: blur(4px);
        }
        .init-prompt-overlay.active { display: flex; }
        .init-prompt-card {
            background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%);
            border: 2px solid #3b82f6;
            border-radius: 16px;
            padding: 40px 48px;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6),
                        0 0 40px rgba(59, 130, 246, 0.15);
            max-width: 500px;
            animation: pulse-glow 2s ease-in-out infinite;
        }
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 40px rgba(59, 130, 246, 0.15); }
            50% { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 60px rgba(59, 130, 246, 0.25); }
        }
        .init-prompt-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .init-prompt-title {
            font-size: 22px;
            font-weight: 600;
            color: #f1f5f9;
            margin-bottom: 12px;
            line-height: 1.3;
        }
        .init-prompt-subtitle {
            font-size: 14px;
            color: #94a3b8;
            margin-bottom: 24px;
            line-height: 1.5;
        }
        .init-prompt-code {
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 16px 20px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 15px;
            color: #38bdf8;
            margin-bottom: 20px;
            user-select: all;
            cursor: text;
        }
        .init-prompt-code:hover {
            border-color: #3b82f6;
            background: #1e293b;
        }
        .init-prompt-hint {
            font-size: 11px;
            color: #64748b;
            display: flex;
            gap: 16px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .init-prompt-hint span {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        /* Language selector */
        .language-selector {
            margin-bottom: 20px;
        }
        .language-selector label {
            display: block;
            font-size: 12px;
            color: #94a3b8;
            margin-bottom: 8px;
        }
        .language-dropdown-wrapper {
            position: relative;
            display: inline-block;
            min-width: 200px;
        }
        .language-dropdown {
            width: 100%;
            padding: 10px 14px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            color: #f1f5f9;
            font-size: 14px;
            cursor: pointer;
            appearance: none;
            -webkit-appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6,9 12,15 18,9'%3E%3C/polyline%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 12px center;
            padding-right: 36px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .language-dropdown:hover {
            border-color: #3b82f6;
        }
        .language-dropdown:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
        .language-dropdown option {
            background: #1e293b;
            color: #f1f5f9;
            padding: 8px;
        }

        /* Modal */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal-overlay.active { display: flex; }
        .modal {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 8px;
            padding: 20px;
            min-width: 400px;
            max-width: 500px;
        }
        .modal h3 { margin-bottom: 16px; font-size: 14px; }
        .modal label {
            display: block;
            font-size: 11px;
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground);
        }
        .modal input, .modal textarea, .modal select {
            width: 100%;
            padding: 8px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 12px;
            font-size: 12px;
            font-family: inherit;
        }
        .modal textarea { min-height: 80px; resize: vertical; }
        .modal-buttons {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 8px;
        }`;
