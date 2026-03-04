// Rationale: extracted JS from VizFlowEditorProvider for readability; content size is inherent to the webview UI.
/* eslint-disable max-lines */
/** Extracted JavaScript for the VizFlow webview. */
export const VIZFLOW_SCRIPT = `
        const vscode = acquireVsCodeApi();
        
        let mermaidCode = '';
        let nodeMetadata = {}; // {nodeId: {type, prompt}}
        let selectedNodeId = null;
        let selectedNodeLabel = '';

        // Zoom/pan state
        let transform = { x: 50, y: 50, scale: 1 };
        let isPanning = false;
        let startPan = { x: 0, y: 0 };

        // Node drag state
        let isDraggingNode = false;
        let draggingNodeId = null;
        let dragStartPos = { x: 0, y: 0 };
        let nodeOffsets = {}; // { nodeId: { x, y } }

        // Search state
        let searchResults = [];
        let currentSearchIndex = -1;
        let isSearchActive = false;

        // Initial load state - for focusing on RECENT node on first open
        let isFirstLoad = true;
        // Flag for focusing on RECENT after direction change
        let pendingFocusOnRecent = false;
        let hasShownLargeDiagramWarning = false;

        // Mermaid initialization
        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            maxTextSize: 200000,
            flowchart: {
                useMaxWidth: false,
                htmlLabels: true,
                curve: 'basis',
                rankSpacing: 50,
                nodeSpacing: 30
            },
            themeVariables: {
                primaryColor: '#334155',
                primaryTextColor: '#f8fafc',
                primaryBorderColor: '#475569',
                lineColor: '#475569',
                secondaryColor: '#1e293b',
                tertiaryColor: '#0f172a',
                fontSize: '14px'
            }
        });

        // Parse metadata from comments
        let lastActiveNodeId = null;
        function parseMetadata(code) {
            nodeMetadata = {};
            lastActiveNodeId = null;

            // Parse lastActive
            const lastActiveMatch = code.match(/%% @lastActive:\\s*(\\w+)/);
            if (lastActiveMatch) {
                lastActiveNodeId = lastActiveMatch[1];
            }

            // Support formats: [type], [type, state], [type, state, date], [type, state, date, author]
            // Description after colon is optional
            const metaRegex = /%% @(\\w+) \\[([\\w-]+)(?:,\\s*(\\w+))?(?:,\\s*([\\d-]+))?(?:,\\s*([\\w@.-]+))?\\](?::\\s*(.+))?/g;
            let match;
            while ((match = metaRegex.exec(code)) !== null) {
                nodeMetadata[match[1]] = {
                    type: match[2],
                    state: match[3] || 'opened',
                    date: match[4] || null,
                    author: match[5] || null,
                    prompt: match[6] || null
                };
            }
        }

        // Extract node list
        function extractNodes(code) {
            const nodes = [];
            // Node definition pattern: nodeId["label"] or nodeId(["label"]) etc
            const nodeRegex = /^\\s+(\\w+)(?:\\[|\\(|\\{)/gm;
            let match;
            while ((match = nodeRegex.exec(code)) !== null) {
                if (!nodes.includes(match[1]) && match[1] !== 'style' && match[1] !== 'flowchart') {
                    nodes.push(match[1]);
                }
            }
            return nodes;
        }

        function extractSubgraphs(code) {
            const subgraphs = [];
            // Subgraph pattern: subgraph id [label] or subgraph id
            const subgraphRegex = /^\\s*subgraph\\s+(\\w+)(?:\\s*\\[(.*)\\])?/gm;
            let match;
            while ((match = subgraphRegex.exec(code)) !== null) {
                subgraphs.push({
                    id: match[1],
                    label: match[2] || match[1]
                });
            }
            return subgraphs;
        }

        // Extract direction
        function extractDirection(code) {
            const match = code.match(/flowchart\\s+(TD|LR|BT|RL)/);
            return match ? match[1] : 'TD';
        }

        function updateTransform() {
            const wrapper = document.getElementById('canvas-wrapper');
            wrapper.style.transform = 'translate(' + transform.x + 'px, ' + transform.y + 'px) scale(' + transform.scale + ')';
            document.getElementById('zoomLevel').innerText = Math.round(transform.scale * 100) + '%';
        }

        // Reduce render payload size by removing non-directive comments.
        // Metadata parsing already happened before rendering.
        function compactCodeForRender(code) {
            const lines = code.split('\\n');
            const compact = [];
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('%%') && !trimmed.startsWith('%%{')) {
                    continue;
                }
                compact.push(line);
            }
            return compact.join('\\n');
        }

        // Add descriptions and date/author to node definitions before rendering
        function addDescriptionsToCode(code) {
            const lines = code.split('\\n');
            const result = [];
            for (const line of lines) {
                let newLine = line;
                // Skip comments and style lines
                if (!line.trim().startsWith('%') && !line.trim().startsWith('style')) {
                    for (const [nodeId, meta] of Object.entries(nodeMetadata)) {
                        // Check if this line defines this node (contains nodeId followed by ( or [)
                        const nodePattern = new RegExp('^\\\\s*' + nodeId + '\\\\s*[\\\\(\\\\[]');
                        if (nodePattern.test(line) && line.includes('"')) {
                            // Find the last " in the line
                            const lastQuoteIdx = line.lastIndexOf('"');
                            if (lastQuoteIdx > 0) {
                                let additions = '';
                                // Add prompt/description if available
                                if (meta.prompt) {
                                    let desc = meta.prompt;
                                    if (desc.length > 150) {
                                        desc = desc.substring(0, 147) + '...';
                                    }
                                    additions += '<br/><span style="font-size:10px;opacity:0.6">' + desc + '</span>';
                                }
                                // Build date/author label if available
                                if (meta.date || meta.author) {
                                    const parts = [];
                                    if (meta.date) parts.push(meta.date);
                                    if (meta.author) parts.push(meta.author);
                                    additions += '<br/><span style="font-size:9px;opacity:0.4;color:#888">' + parts.join(' · ') + '</span>';
                                }
                                if (additions) {
                                    newLine = line.slice(0, lastQuoteIdx) + additions + line.slice(lastQuoteIdx);
                                }
                                break;
                            }
                        }
                    }
                }
                result.push(newLine);
            }
            return result.join('\\n');
        }

        // Check if trajectory is in template state (only has project_start node)
        function isTemplateState(nodes) {
            if (nodes.length === 0) return true;
            if (nodes.length === 1 && (nodes[0] === 'project_start' || nodes[0] === 'Start')) return true;
            // Also check if there are only style/connection lines but effectively just one node
            const meaningfulNodes = nodes.filter(n => !['style', 'flowchart', 'subgraph', 'end'].includes(n.toLowerCase()));
            return meaningfulNodes.length <= 1;
        }

        // Show or hide initialization prompt
        function updateInitPrompt(show) {
            const overlay = document.getElementById('init-prompt-overlay');
            if (overlay) {
                if (show) {
                    overlay.classList.add('active');
                } else {
                    overlay.classList.remove('active');
                }
            }
        }

        // Copy initialization prompt to clipboard
        function copyInitPrompt() {
            const prompt = getPromptText();
            navigator.clipboard.writeText(prompt).then(() => {
                showToast('📋 Prompt copied! Paste it in your AI chat.');
            }).catch(() => {
                showToast('Copy failed - select and copy manually');
            });
        }

        // Get prompt text based on selected language
        function getPromptText() {
            const langSelect = document.getElementById('langSelect');
            const selectedLang = langSelect ? langSelect.value : '';
            if (selectedLang) {
                return 'Please setup vizvibe for this project. Write the trajectory in ' + selectedLang + '.';
            }
            return 'Please setup vizvibe for this project. Write the trajectory in my language.';
        }

        // Update prompt display when language changes
        function updatePromptLanguage() {
            const codeEl = document.getElementById('init-prompt-code');
            if (codeEl) {
                const langSelect = document.getElementById('langSelect');
                const selectedLang = langSelect ? langSelect.value : '';
                if (selectedLang) {
                    codeEl.innerHTML = '"Please setup vizvibe for this project.<br/>Write the trajectory in ' + selectedLang + '."';
                } else {
                    codeEl.innerHTML = '"Please setup vizvibe for this project.<br/>Write the trajectory in my language."';
                }
            }
        }

        async function render() {
            if (!mermaidCode.trim()) {
                document.getElementById('mermaid-output').innerHTML = '<p style="color:#888;padding:20px;">Empty file. Add some nodes.</p>';
                updateInitPrompt(true);
                return;
            }

            parseMetadata(mermaidCode);
            const nodes = extractNodes(mermaidCode);

            // Sync direction dropdown
            const direction = extractDirection(mermaidCode);
            document.getElementById('flowDirection').value = direction;

            // Update connection dropdown
            updateConnectDropdown(nodes);

            // Check for template state and show/hide init prompt
            const showInitPrompt = isTemplateState(nodes);
            updateInitPrompt(showInitPrompt);

            const container = document.getElementById('mermaid-output');

            const compactCode = compactCodeForRender(mermaidCode);

            // Add descriptions to code for proper node sizing
            const codeWithDescriptions = addDescriptionsToCode(compactCode);
            let renderCode = codeWithDescriptions;
            if (codeWithDescriptions.length > 49000) {
                renderCode = compactCode;
                if (!hasShownLargeDiagramWarning) {
                    hasShownLargeDiagramWarning = true;
                    showToast('Large diagram detected. Rendering without metadata overlay for stability.');
                }
            } else {
                hasShownLargeDiagramWarning = false;
            }

            try {
                // Remove existing SVG
                const existingSvg = document.getElementById('mermaid-svg');
                if (existingSvg) existingSvg.remove();

                const { svg } = await mermaid.render('mermaid-svg', renderCode);
                container.innerHTML = svg;

                // Node click/right-click/double-click events
                // Mermaid v10 uses .node class for node groups
                const nodeElements = container.querySelectorAll('.node');
                nodeElements.forEach(nodeEl => {
                    // Extract nodeId from element id (format: flowchart-nodeId-number)
                    const elId = nodeEl.id || '';
                    let foundNodeId = null;

                    // Try to match with known node IDs
                    for (const nid of nodes) {
                        if (elId.includes(nid) || elId.includes('flowchart-' + nid)) {
                            foundNodeId = nid;
                            break;
                        }
                    }

                    if (!foundNodeId) return;

                    const nodeId = foundNodeId;
                    
                    // Save base transform and apply saved offset if exists
                    const baseTransform = nodeEl.getAttribute('transform') || '';
                    nodeEl.setAttribute('data-base-transform', baseTransform);
                    
                    if (nodeOffsets[nodeId]) {
                        const offset = nodeOffsets[nodeId];
                        nodeEl.setAttribute('transform', baseTransform + ' translate(' + offset.x + ',' + offset.y + ')');
                    }

                    // Node drag handlers
                    nodeEl.addEventListener('mousedown', (e) => {
                        if (e.button !== 0) return; // Left button only
                        if (e.target.closest('.node-play')) return;
                        e.stopPropagation();
                        isDraggingNode = true;
                        draggingNodeId = nodeId;
                        nodeEl.classList.add('dragging');
                        
                        // Get current offset or initialize
                        const currentOffset = nodeOffsets[nodeId] || { x: 0, y: 0 };
                        dragStartPos = {
                            x: e.clientX / transform.scale - currentOffset.x,
                            y: e.clientY / transform.scale - currentOffset.y
                        };
                    });

                    // Single click - show info (only if not dragging)
                    let dragDistance = 0;
                    nodeEl.addEventListener('click', (e) => {
                        if (dragDistance > 5) {
                            dragDistance = 0;
                            return; // Skip if dragged
                        }
                        e.stopPropagation();
                        e.preventDefault();
                        showNodeInfo(nodeId);
                    });

                    // Double click - copy all
                    nodeEl.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        selectedNodeId = nodeId;
                        extractNodeLabel(nodeEl, nodeId);
                        copyNodeAll();
                    });

                    // Right click - context menu
                    nodeEl.addEventListener('contextmenu', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        selectedNodeId = nodeId;
                        extractNodeLabel(nodeEl, nodeId);
                        showContextMenu(e.clientX, e.clientY);
                    });

                    attachPlayButton(nodeEl, nodeId);
                });

                document.getElementById('nodeCount').innerText = 'Nodes: ' + nodes.length;
            } catch (e) {
                container.innerHTML = '<p style="color:#ef4444;padding:20px;">Render error: ' + e.message + '</p>';
            }
        }

        // Extract label with line breaks preserved
        function extractNodeLabel(nodeEl, nodeId) {
            const textEl = nodeEl ? nodeEl.querySelector('.nodeLabel, text, foreignObject') : null;
            if (textEl) {
                let html = textEl.innerHTML || '';
                // Convert <br/>, <br>, <br /> to newlines
                html = html.replace(/<br\\s*\\/?>/gi, '\\n');
                // Remove other HTML tags
                html = html.replace(/<[^>]+>/g, '');
                // Decode HTML entities
                const temp = document.createElement('div');
                temp.innerHTML = html;
                selectedNodeLabel = temp.textContent.trim();
            } else {
                selectedNodeLabel = nodeId;
            }
        }

        function getNodeContent(nodeId) {
            const meta = nodeMetadata[nodeId] || {};
            const label = getNodeLabelText(nodeId) || nodeId;
            const description = meta.prompt ? ('\\n' + meta.prompt) : '';
            return label + description;
        }

        function attachPlayButton(nodeEl, nodeId) {
            if (!nodeEl || nodeEl.querySelector('.node-play')) return;
            const bbox = nodeEl.getBBox();
            const size = 16;
            const cx = bbox.x + bbox.width - 8;
            const cy = bbox.y + 8;

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'node-play');
            g.setAttribute('transform', 'translate(' + (cx - size / 2) + ',' + (cy - size / 2) + ')');

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(size / 2));
            circle.setAttribute('cy', String(size / 2));
            circle.setAttribute('r', String(size / 2));

            const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            triangle.setAttribute('points', '6,4 12,8 6,12');

            g.appendChild(circle);
            g.appendChild(triangle);

            g.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            g.addEventListener('click', (e) => {
                e.stopPropagation();
                const prompt = 'Read vizvibe.mmd and get the current context.\\n\\n' +
                    '[' + getNodeContent(nodeId) + ']';
                vscode.postMessage({ type: 'runCodexForNode', prompt });
            });

            nodeEl.appendChild(g);
        }

        function showNodeInfo(nodeId) {
            const meta = nodeMetadata[nodeId] || {};
            selectedNodeId = nodeId;
            // Get label from rendered node
            const container = document.getElementById('mermaid-output');
            // Find node element by .node class and matching id
            let nodeEl = null;
            container.querySelectorAll('.node').forEach(el => {
                if (el.id && (el.id.includes(nodeId) || el.id.includes('flowchart-' + nodeId))) {
                    nodeEl = el;
                }
            });
            extractNodeLabel(nodeEl, nodeId);

            // Build status text
            const isRecent = (nodeId === lastActiveNodeId);
            const state = meta.state || 'opened';
            let statusText = state === 'closed' ? '✓ Closed' : '○ Open';
            if (isRecent) statusText += '  •  ⭐ Recent';

            // Add date/author if available
            let dateAuthorText = '';
            if (meta.date || meta.author) {
                const parts = [];
                if (meta.date) parts.push('📅 ' + meta.date);
                if (meta.author) parts.push('👤 ' + meta.author);
                dateAuthorText = '\\n' + parts.join('  •  ');
            }

            document.getElementById('info-card').style.display = 'block';
            document.getElementById('info-label').innerText = selectedNodeLabel;
            document.getElementById('info-prompt').innerText = statusText + dateAuthorText + '\\n\\n' + (meta.prompt || '');
        }

        function closeInfoCard() {
            document.getElementById('info-card').style.display = 'none';
        }

        // Context menu functions
        function showContextMenu(x, y) {
            const menu = document.getElementById('context-menu');
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.classList.add('active');
        }

        function hideContextMenu() {
            document.getElementById('context-menu').classList.remove('active');
        }

        // Copy functions
        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Copied to clipboard!');
            }).catch(() => {
                showToast('Failed to copy');
            });
            hideContextMenu();
        }

        function copyNodeId() {
            if (selectedNodeId) {
                copyToClipboard(selectedNodeId);
            }
        }

        function copyNodeLabel() {
            if (selectedNodeLabel) {
                copyToClipboard(selectedNodeLabel);
            }
        }

        function copyNodeDescription() {
            const meta = nodeMetadata[selectedNodeId] || {};
            copyToClipboard(meta.prompt || '');
        }

        function copyNodeAll() {
            if (!selectedNodeId) return;
            // selectedNodeLabel already contains label + description from rendering
            copyToClipboard(selectedNodeLabel);
        }

        function copyNodeInfo() {
            copyNodeAll();
        }

        // Close context menu on click outside
        document.addEventListener('click', hideContextMenu);
        document.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.node')) {
                hideContextMenu();
            }
        });

        function updateConnectDropdown(nodes) {
            const select = document.getElementById('connectFrom');
            select.innerHTML = '<option value="">No connection</option>';
            nodes.forEach(id => {
                select.innerHTML += '<option value="' + id + '">' + id + '</option>';
            });
        }

        // Open file in VS Code's default editor
        function openInDefaultEditor() {
            vscode.postMessage({ type: 'openInDefaultEditor' });
        }

        // === Zoom/Panning ===
        const graphView = document.getElementById('graph-view');
        
        graphView.addEventListener('mousedown', (e) => {
            if (e.target.closest('.info-card') || e.target.closest('.zoom-controls')) return;
            isPanning = true;
            startPan = { x: e.clientX - transform.x, y: e.clientY - transform.y };
            graphView.classList.add('grabbing');
        });

        document.addEventListener('mousemove', (e) => {
            // Node dragging takes priority
            if (isDraggingNode && draggingNodeId) {
                const newX = e.clientX / transform.scale - dragStartPos.x;
                const newY = e.clientY / transform.scale - dragStartPos.y;
                
                nodeOffsets[draggingNodeId] = { x: newX, y: newY };
                
                // Find and update the node element
                const container = document.getElementById('mermaid-output');
                
                container.querySelectorAll('.node').forEach(nodeEl => {
                    if (nodeEl.id && (nodeEl.id.includes(draggingNodeId) || nodeEl.id.includes('flowchart-' + draggingNodeId))) {
                        // Update transform
                        const baseTransform = nodeEl.getAttribute('data-base-transform') || '';
                        nodeEl.setAttribute('transform', baseTransform + ' translate(' + newX + ',' + newY + ')');
                    }
                });
                
                return;
            }
            
            if (!isPanning) return;
            transform.x = e.clientX - startPan.x;
            transform.y = e.clientY - startPan.y;
            updateTransform();
        });
        
        // Store edge connections parsed from mermaid code
        let edgeConnections = []; // [{from: 'nodeA', to: 'nodeB', pathIndex: 0}, ...]
        
        // Parse edge connections from mermaid code
        function parseEdgeConnections(code) {
            edgeConnections = [];
            // Match patterns like: nodeA --> nodeB, nodeA -.-> nodeB, etc.
            const edgeRegex = /(\\w+)\\s*(?:-->|-.->|==>|--o|--x)\\s*(\\w+)/g;
            let match;
            let index = 0;
            while ((match = edgeRegex.exec(code)) !== null) {
                edgeConnections.push({
                    from: match[1],
                    to: match[2],
                    index: index++
                });
            }
        }
        
        // Function to update edges connected to a node
        function updateEdgesForNode(nodeId, offsetX, offsetY) {
            const container = document.getElementById('mermaid-output');
            const svg = container.querySelector('svg');
            if (!svg) return;
            
            // Parse connections if not already done
            if (edgeConnections.length === 0) {
                parseEdgeConnections(mermaidCode);
            }
            
            // Find edges connected to this node
            const connectedEdges = edgeConnections.filter(e => e.from === nodeId || e.to === nodeId);
            if (connectedEdges.length === 0) return;
            
            // In Mermaid v10, edges are rendered as path elements
            // They can be in .edgePaths g elements or directly as path.flowchart-link
            const allPaths = svg.querySelectorAll('path.flowchart-link, .edgePath path, .edgePaths path');
            
            // Also try to find edge labels and markers
            const edgeGroups = svg.querySelectorAll('.edgePath, .edge, [class*="edge"]');
            
            // For each path, try to determine which edge it represents
            allPaths.forEach((pathEl, pathIndex) => {
                // Store original path
                if (!pathEl.hasAttribute('data-original-d')) {
                    pathEl.setAttribute('data-original-d', pathEl.getAttribute('d') || '');
                }
                
                // Try to find which edge this path belongs to
                // Method 1: Check parent element ID
                let parent = pathEl.closest('[id*="-"]') || pathEl.parentElement;
                let edgeId = parent ? (parent.id || '') : '';
                
                // Method 2: Check path's class or data attributes
                const pathClass = pathEl.getAttribute('class') || '';
                
                // Try to match with our edge connections
                let matchedEdge = null;
                
                // Check if edgeId contains node IDs
                for (const edge of connectedEdges) {
                    if (edgeId.includes(edge.from) && edgeId.includes(edge.to)) {
                        matchedEdge = edge;
                        break;
                    }
                    // Also check by index if paths are in order
                    if (pathIndex === edge.index) {
                        matchedEdge = edge;
                        break;
                    }
                }
                
                // If still no match, check by parent's ID pattern
                if (!matchedEdge && edgeId) {
                    for (const edge of connectedEdges) {
                        // Mermaid often uses format like "L-from-to" or "flowchart-from-to"
                        if (edgeId.toLowerCase().includes(edge.from.toLowerCase()) || 
                            edgeId.toLowerCase().includes(edge.to.toLowerCase())) {
                            matchedEdge = edge;
                            break;
                        }
                    }
                }
                
                if (!matchedEdge) return;
                
                const isSource = matchedEdge.from === nodeId;
                const originalD = pathEl.getAttribute('data-original-d') || '';
                
                // Parse and modify the path
                const pathCommands = parsePathD(originalD);
                if (pathCommands.length === 0) return;
                
                if (isSource) {
                    // Offset start of path
                    if (pathCommands[0]) {
                        pathCommands[0].x = (parseFloat(pathCommands[0].origX) || 0) + offsetX;
                        pathCommands[0].y = (parseFloat(pathCommands[0].origY) || 0) + offsetY;
                    }
                    // Offset first control point for curves
                    if (pathCommands.length > 1 && pathCommands[1].type === 'C') {
                        pathCommands[1].x1 = (parseFloat(pathCommands[1].origX1) || 0) + offsetX;
                        pathCommands[1].y1 = (parseFloat(pathCommands[1].origY1) || 0) + offsetY;
                    }
                } else {
                    // Offset end of path
                    const lastIdx = pathCommands.length - 1;
                    if (pathCommands[lastIdx]) {
                        pathCommands[lastIdx].x = (parseFloat(pathCommands[lastIdx].origX) || 0) + offsetX;
                        pathCommands[lastIdx].y = (parseFloat(pathCommands[lastIdx].origY) || 0) + offsetY;
                    }
                    // Offset last control point for curves
                    if (pathCommands[lastIdx] && pathCommands[lastIdx].type === 'C') {
                        pathCommands[lastIdx].x2 = (parseFloat(pathCommands[lastIdx].origX2) || 0) + offsetX;
                        pathCommands[lastIdx].y2 = (parseFloat(pathCommands[lastIdx].origY2) || 0) + offsetY;
                    }
                }
                
                const newD = buildPathD(pathCommands);
                pathEl.setAttribute('d', newD);
            });
        }
        
        // Parse SVG path 'd' attribute into commands
        function parsePathD(d) {
            const commands = [];
            // Simple regex to extract path commands
            const regex = /([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi;
            let match;
            while ((match = regex.exec(d)) !== null) {
                const type = match[1].toUpperCase();
                const args = match[2].trim().split(/[\\s,]+/).map(Number).filter(n => !isNaN(n));
                
                if (type === 'M' || type === 'L') {
                    commands.push({ type, x: args[0], y: args[1], origX: args[0], origY: args[1] });
                } else if (type === 'C') {
                    commands.push({ 
                        type, 
                        x1: args[0], y1: args[1], 
                        x2: args[2], y2: args[3], 
                        x: args[4], y: args[5],
                        origX1: args[0], origY1: args[1],
                        origX2: args[2], origY2: args[3],
                        origX: args[4], origY: args[5]
                    });
                } else if (type === 'Z') {
                    commands.push({ type });
                } else {
                    // Handle other commands as-is
                    commands.push({ type, args });
                }
            }
            return commands;
        }
        
        // Build SVG path 'd' attribute from commands
        function buildPathD(commands) {
            return commands.map(cmd => {
                if (cmd.type === 'M' || cmd.type === 'L') {
                    return cmd.type + cmd.x + ',' + cmd.y;
                } else if (cmd.type === 'C') {
                    return cmd.type + cmd.x1 + ',' + cmd.y1 + ' ' + cmd.x2 + ',' + cmd.y2 + ' ' + cmd.x + ',' + cmd.y;
                } else if (cmd.type === 'Z') {
                    return 'Z';
                } else if (cmd.args) {
                    return cmd.type + cmd.args.join(',');
                }
                return '';
            }).join(' ');
        }

        document.addEventListener('mouseup', () => {
            // End node dragging
            if (isDraggingNode && draggingNodeId) {
                const container = document.getElementById('mermaid-output');
                container.querySelectorAll('.node').forEach(nodeEl => {
                    nodeEl.classList.remove('dragging');
                });
                
                isDraggingNode = false;
                draggingNodeId = null;
            }
            
            isPanning = false;
            graphView.classList.remove('grabbing');
        });
        
        // Redraw all edges based on current node positions
        function redrawAllEdges(svg) {
            // Parse edge connections from mermaid code
            parseEdgeConnections(mermaidCode);
            
            // Hide original Mermaid edges
            svg.querySelectorAll('.edgePath, .edgePaths').forEach(g => {
                g.style.display = 'none';
            });
            
            // Remove previously drawn custom edges
            svg.querySelectorAll('.vizvibe-edge').forEach(el => el.remove());
            
            // Create a group for our custom edges
            let edgeGroup = svg.querySelector('.vizvibe-edges');
            if (!edgeGroup) {
                edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                edgeGroup.setAttribute('class', 'vizvibe-edges');
                // Insert before nodes so edges are behind
                const nodesGroup = svg.querySelector('.nodes') || svg.firstChild;
                svg.insertBefore(edgeGroup, nodesGroup);
            }
            
            // Draw each edge
            edgeConnections.forEach(conn => {
                const fromCenter = getNodeCenter(conn.from);
                const toCenter = getNodeCenter(conn.to);
                
                if (!fromCenter || !toCenter) return;
                
                // Create path element
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('class', 'vizvibe-edge');
                
                // Calculate bezier curve
                const dx = toCenter.x - fromCenter.x;
                const dy = toCenter.y - fromCenter.y;
                
                // Control points - create a smooth curve
                let cx1, cy1, cx2, cy2;
                
                if (Math.abs(dy) > Math.abs(dx)) {
                    // Mostly vertical - curve horizontally
                    cx1 = fromCenter.x;
                    cy1 = fromCenter.y + dy * 0.4;
                    cx2 = toCenter.x;
                    cy2 = fromCenter.y + dy * 0.6;
                } else {
                    // Mostly horizontal - curve vertically
                    cx1 = fromCenter.x + dx * 0.4;
                    cy1 = fromCenter.y;
                    cx2 = fromCenter.x + dx * 0.6;
                    cy2 = toCenter.y;
                }
                
                const d = 'M' + fromCenter.x + ',' + fromCenter.y + 
                    ' C' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + toCenter.x + ',' + toCenter.y;
                
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', '#475569');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('marker-end', 'url(#vizvibe-arrow)');
                
                edgeGroup.appendChild(path);
            });
            
            // Add arrow marker if not exists
            if (!svg.querySelector('#vizvibe-arrow')) {
                const defs = svg.querySelector('defs') || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                if (!svg.querySelector('defs')) svg.insertBefore(defs, svg.firstChild);
                
                const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
                marker.setAttribute('id', 'vizvibe-arrow');
                marker.setAttribute('viewBox', '0 0 10 10');
                marker.setAttribute('refX', '8');
                marker.setAttribute('refY', '5');
                marker.setAttribute('markerWidth', '6');
                marker.setAttribute('markerHeight', '6');
                marker.setAttribute('orient', 'auto-start-reverse');
                
                const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
                arrowPath.setAttribute('fill', '#475569');
                
                marker.appendChild(arrowPath);
                defs.appendChild(marker);
            }
        }
        
        // Get node center position (including offset)
        function getNodeCenter(nodeId) {
            const container = document.getElementById('mermaid-output');
            let nodeEl = null;
            
            container.querySelectorAll('.node').forEach(el => {
                if (el.id && (el.id.includes(nodeId) || el.id.includes('flowchart-' + nodeId))) {
                    nodeEl = el;
                }
            });
            
            if (!nodeEl) return null;
            
            // Get bounding box
            const bbox = nodeEl.getBBox();
            const offset = nodeOffsets[nodeId] || { x: 0, y: 0 };
            
            // Calculate center with offset
            return {
                x: bbox.x + bbox.width / 2 + offset.x,
                y: bbox.y + bbox.height / 2 + offset.y
            };
        }
        
        // Reconnect all edges based on current node positions
        function reconnectEdges(svg) {
            // Parse connections from mermaid code
            parseEdgeConnections(mermaidCode);
            
            // Get all edge paths
            const allPaths = svg.querySelectorAll('path.flowchart-link, .edgePath path, .edgePaths path');
            
            // Show edges again
            svg.querySelectorAll('.edgePath, .edgePaths, path.flowchart-link').forEach(edge => {
                edge.style.opacity = '1';
            });
            
            // For each connection, find and update the corresponding path
            edgeConnections.forEach((conn, index) => {
                const fromCenter = getNodeCenter(conn.from);
                const toCenter = getNodeCenter(conn.to);
                
                if (!fromCenter || !toCenter) return;
                
                // Find the path for this edge (by index or ID matching)
                const pathEl = allPaths[index];
                if (!pathEl) return;
                
                // Calculate new path - simple curved line
                const dx = toCenter.x - fromCenter.x;
                const dy = toCenter.y - fromCenter.y;
                
                // Control points for bezier curve
                const cx1 = fromCenter.x + dx * 0.3;
                const cy1 = fromCenter.y;
                const cx2 = fromCenter.x + dx * 0.7;
                const cy2 = toCenter.y;
                
                // Build new path - M start, C curve to end
                const newPath = 'M' + fromCenter.x + ',' + fromCenter.y + 
                    ' C' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + toCenter.x + ',' + toCenter.y;
                
                pathEl.setAttribute('d', newPath);
            });
        }

        // Figma-style navigation: Scroll = Pan, Ctrl/Cmd+Scroll or Pinch = Zoom
        graphView.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Pinch zoom on trackpad sets ctrlKey to true
            // Also support Ctrl+scroll (Windows) and Cmd+scroll (Mac)
            if (e.ctrlKey || e.metaKey) {
                // Zoom mode
                // Use a continuous zoom factor based on deltaY magnitude for smoother control.
                // This prevents high sensitivity on trackpads where deltaY is small but frequent.
                const zoomIntensity = 0.0075;
                const delta = Math.exp(-e.deltaY * zoomIntensity);
                const newScale = Math.max(0.2, Math.min(3, transform.scale * delta));
                
                const rect = graphView.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                
                // Zoom toward mouse position
                transform.x = mx - (mx - transform.x) * (newScale / transform.scale);
                transform.y = my - (my - transform.y) * (newScale / transform.scale);
                transform.scale = newScale;
            } else {
                // Pan mode - scroll to move canvas
                transform.x -= e.deltaX;
                transform.y -= e.deltaY;
            }
            
            updateTransform();
        }, { passive: false });

        function zoomIn() {
            transform.scale = Math.min(3, transform.scale * 1.2);
            updateTransform();
        }

        function zoomOut() {
            transform.scale = Math.max(0.2, transform.scale / 1.2);
            updateTransform();
        }

        function resetView() {
            transform = { x: 50, y: 50, scale: 1 };
            updateTransform();
        }

        function fitToScreen() {
            const container = document.getElementById('graph-view');
            const mermaidEl = document.getElementById('mermaid-container');
            const cRect = container.getBoundingClientRect();
            const mRect = mermaidEl.getBoundingClientRect();
            
            if (mRect.width === 0 || mRect.height === 0) return;
            
            const scaleX = (cRect.width - 100) / (mRect.width / transform.scale);
            const scaleY = (cRect.height - 100) / (mRect.height / transform.scale);
            transform.scale = Math.min(scaleX, scaleY, 1.5);
            transform.x = 50;
            transform.y = 50;
            updateTransform();
        }

        // === Direction change ===
        function changeDirection() {
            const newDir = document.getElementById('flowDirection').value;
            mermaidCode = mermaidCode.replace(/flowchart\\s+(TD|LR|BT|RL)/, 'flowchart ' + newDir);
            // Set flag to focus on RECENT after document update cycle completes
            pendingFocusOnRecent = true;
            vscode.postMessage({ type: 'update', mermaidCode });
        }

        // === Node creation ===
        const nodeShapes = {
            'start': { open: '(["', close: '"])', style: 'fill:#64748b,stroke:#475569,color:#fff,stroke-width:1px' },
            'end': { open: '(["', close: '"])', style: 'fill:#64748b,stroke:#475569,color:#fff,stroke-width:2px' },
            'ai-task': { open: '["', close: '"]', style: 'fill:#334155,stroke:#475569,color:#f8fafc,stroke-width:1px' },
            'human-task': { open: '["', close: '"]', style: 'fill:#1e293b,stroke:#6366f1,color:#f8fafc,stroke-width:2px' },
            'condition': { open: '{"', close: '"}', style: 'fill:#0f172a,stroke:#f59e0b,color:#fbbf24,stroke-width:2px' },
            'blocker': { open: '{{"', close: '"}}', style: 'fill:#450a0a,stroke:#dc2626,color:#fca5a5,stroke-width:2px' }
        };

        function openAddNodeModal(type) {
            document.getElementById('nodeType').value = type;
            document.getElementById('modalTitle').innerText = 'Add New ' + type.toUpperCase() + ' Node';
            document.getElementById('nodeId').value = 'node_' + Date.now();
            document.getElementById('nodeLabel').value = '';
            document.getElementById('nodePrompt').value = '';
            document.getElementById('addNodeModal').classList.add('active');
            setTimeout(() => document.getElementById('nodeLabel').focus(), 100);
        }

        function closeAddNodeModal() {
            document.getElementById('addNodeModal').classList.remove('active');
        }

        function confirmAddNode() {
            const type = document.getElementById('nodeType').value;
            const nodeId = document.getElementById('nodeId').value.trim().replace(/[^a-zA-Z0-9_]/g, '_') || ('node_' + Date.now());
            const label = document.getElementById('nodeLabel').value.trim() || type;
            const prompt = document.getElementById('nodePrompt').value.trim();
            const connectFrom = document.getElementById('connectFrom').value;
            
            const shape = nodeShapes[type] || nodeShapes['ai-task'];
            
            // Generate new code
            let newCode = '';

            // Metadata comment
            if (prompt) {
                newCode += '    %% @' + nodeId + ' [' + type + ']: ' + prompt.replace(/\\n/g, ' ') + '\\n';
            }
            
            // Node definition
            newCode += '    ' + nodeId + shape.open + label + shape.close + '\\n';

            // Edge (connection)
            if (connectFrom) {
                newCode += '    ' + connectFrom + ' --> ' + nodeId + '\\n';
            }

            // Style
            newCode += '    style ' + nodeId + ' ' + shape.style + '\\n';

            // Add to existing code
            if (!mermaidCode.trim()) {
                mermaidCode = 'flowchart TD\\n' + newCode;
            } else {
                // Add before styles section or at end
                const stylesMatch = mermaidCode.match(/\\n(\\s*style\\s)/);
                if (stylesMatch) {
                    const pos = mermaidCode.indexOf(stylesMatch[0]);
                    mermaidCode = mermaidCode.slice(0, pos) + '\\n' + newCode + mermaidCode.slice(pos);
                } else {
                    mermaidCode += '\\n' + newCode;
                }
            }
            
            closeAddNodeModal();
            vscode.postMessage({ type: 'update', mermaidCode });
            render();
        }

        // === Message handler ===
        window.onmessage = async (e) => {
            if (e.data.type === 'load') {
                mermaidCode = e.data.mermaidCode || '';
                await render();

                // Focus on RECENT node on first load or after direction change
                if (isFirstLoad || pendingFocusOnRecent) {
                    isFirstLoad = false;
                    pendingFocusOnRecent = false;
                    focusOnRecentNode();
                }
            } else if (e.data.type === 'openSearch') {
                openSearch();
            }
        };

        // Close modal
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.onclick = (e) => {
                if (e.target.classList.contains('modal-overlay')) {
                    modal.classList.remove('active');
                }
            };
        });

        // Enter key for node creation
        document.getElementById('nodeLabel').onkeydown = (e) => {
            if (e.key === 'Enter') confirmAddNode();
        };

        // === Search functionality ===
        function toggleSearch() {
            const searchBox = document.getElementById('search-box');
            if (searchBox.classList.contains('active')) {
                closeSearch();
            } else {
                openSearch();
            }
        }

        function openSearch() {
            const searchBox = document.getElementById('search-box');
            searchBox.classList.add('active');
            isSearchActive = true;
            document.getElementById('search-input').focus();
        }

        function closeSearch() {
            const searchBox = document.getElementById('search-box');
            searchBox.classList.remove('active');
            isSearchActive = false;
            clearSearchHighlights();
            document.getElementById('search-input').value = '';
            document.getElementById('search-info').textContent = '';
            searchResults = [];
            currentSearchIndex = -1;
        }

        // === Agent launcher ===
        function toggleAgentPanel() {
            const panel = document.getElementById('agent-panel');
            panel.classList.toggle('active');
        }

        function closeAgentPanel() {
            const panel = document.getElementById('agent-panel');
            panel.classList.remove('active');
        }

        function launchAgent(agentId) {
            closeAgentPanel();
            vscode.postMessage({ type: 'launchAgent', agentId });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.agent-menu')) {
                closeAgentPanel();
            }
        });

        function performSearch(query) {
            clearSearchHighlights();
            searchResults = [];
            currentSearchIndex = -1;

            if (!query.trim()) {
                document.getElementById('search-info').textContent = '';
                return;
            }

            const lowerQuery = query.toLowerCase();
            const container = document.getElementById('mermaid-output');
            const nodes = extractNodes(mermaidCode);
            const subgraphs = extractSubgraphs(mermaidCode);

            // Search in node labels and metadata descriptions
            nodes.forEach(nodeId => {
                const meta = nodeMetadata[nodeId] || {};
                const label = getNodeLabelText(nodeId) || nodeId;
                const description = meta.prompt || '';
                
                if (label.toLowerCase().includes(lowerQuery) || 
                    description.toLowerCase().includes(lowerQuery) ||
                    nodeId.toLowerCase().includes(lowerQuery)) {
                    searchResults.push(nodeId);
                }
            });

            // Search in subgraphs
            subgraphs.forEach(sg => {
                if (sg.label.toLowerCase().includes(lowerQuery) || 
                    sg.id.toLowerCase().includes(lowerQuery)) {
                    if (!searchResults.includes(sg.id)) {
                        searchResults.push(sg.id);
                    }
                }
            });

            // Update UI
            if (searchResults.length > 0) {
                document.getElementById('search-info').textContent = '1/' + searchResults.length;
                currentSearchIndex = 0;
                highlightSearchResults();
                focusOnNode(searchResults[0]);
            } else {
                document.getElementById('search-info').textContent = '0 results';
            }
        }

        function findElementById(id) {
            const container = document.getElementById('mermaid-output');
            // Try exact ID match first (for nodes)
            let el = document.getElementById(id) || document.getElementById('flowchart-' + id);
            
            // If not found, search through all nodes and clusters
            if (!el) {
                // Nodes
                const nodes = container.querySelectorAll('.node');
                for (const node of nodes) {
                    if (node.id === id || node.id === 'flowchart-' + id || node.id.startsWith('flowchart-' + id + '-')) {
                        el = node;
                        break;
                    }
                }
            }
            
            if (!el) {
                // Clusters (subgraphs) - Mermaid often adds prefixes and suffixes
                const clusters = container.querySelectorAll('.cluster');
                for (const cluster of clusters) {
                    const cid = cluster.id || '';
                    if (cid === id || cid === 'flowchart-' + id || cid === 'cluster-' + id || 
                        cid.includes('-' + id + '-') || cid.endsWith('-' + id)) {
                        el = cluster;
                        break;
                    }
                }
            }
            return el;
        }

        function getNodeLabelText(id) {
            const el = findElementById(id);
            if (!el) return id;
            
            const textEl = el.querySelector('.nodeLabel, .cluster-label, text, foreignObject');
            if (textEl) {
                let text = textEl.textContent || textEl.innerText || '';
                return text.trim();
            }
            return id;
        }

        function highlightSearchResults() {
            const container = document.getElementById('mermaid-output');
            const nodes = extractNodes(mermaidCode);
            const subgraphs = extractSubgraphs(mermaidCode).map(sg => sg.id);

            // Clear and Dim everything if search is active
            clearSearchHighlights();
            if (searchResults.length > 0) {
                container.querySelectorAll('.node, .cluster').forEach(el => {
                    el.classList.add('search-dimmed');
                });
            }

            // Highlight matches
            searchResults.forEach((id, index) => {
                const el = findElementById(id);
                if (el) {
                    el.classList.remove('search-dimmed');
                    if (index === currentSearchIndex) {
                        el.classList.add('search-current');
                    } else {
                        el.classList.add('search-match');
                    }
                }
            });
        }

        function clearSearchHighlights() {
            const container = document.getElementById('mermaid-output');
            container.querySelectorAll('.node, .cluster').forEach(el => {
                el.classList.remove('search-match', 'search-current', 'search-dimmed');
            });
        }

        function navigateSearch(direction) {
            if (searchResults.length === 0) return;
            
            currentSearchIndex = (currentSearchIndex + direction + searchResults.length) % searchResults.length;
            document.getElementById('search-info').textContent = (currentSearchIndex + 1) + '/' + searchResults.length;
            highlightSearchResults();
            focusOnNode(searchResults[currentSearchIndex]);
        }

        function focusOnNode(id) {
            const graphView = document.getElementById('graph-view');
            const targetEl = findElementById(id);
            
            if (!targetEl) return;
            
            // Get current positions using getBoundingClientRect (screen coordinates)
            // For clusters, we might need to find the child rect for more accurate positioning
            const rectEl = targetEl.querySelector('rect') || targetEl;
            const targetRect = rectEl.getBoundingClientRect();
            const graphRect = graphView.getBoundingClientRect();
            
            // Calculate where the target center currently is in screen coordinates
            const targetCenterScreenX = targetRect.left + targetRect.width / 2;
            const targetCenterScreenY = targetRect.top + targetRect.height / 2;
            
            // Calculate where we want it (center of graph view)
            const targetScreenX = graphRect.left + graphRect.width / 2;
            const targetScreenY = graphRect.top + graphRect.height / 2;
            
            // Calculate the difference we need to move
            const deltaX = targetScreenX - targetCenterScreenX;
            const deltaY = targetScreenY - targetCenterScreenY;
            
            // Apply delta to current transform
            transform.x += deltaX;
            transform.y += deltaY;
            
            updateTransform();
        }

        // Focus on RECENT subgraph or lastActive node on initial load
        function focusOnRecentNode() {
            // Reset transform to origin first, then set scale
            transform.x = 0;
            transform.y = 0;
            transform.scale = 0.8;
            updateTransform();

            // Wait for DOM to settle, then find and center on target
            setTimeout(() => {
                const container = document.getElementById('mermaid-output');
                const svg = container.querySelector('svg');
                if (!svg) return;

                // Strategy 1: Find RECENT subgraph cluster (only .cluster class)
                let targetEl = svg.querySelector('.cluster[id*="recent"], .cluster[id*="RECENT"]');

                // Strategy 2: If no RECENT subgraph, find lastActive node
                if (!targetEl && lastActiveNodeId) {
                    container.querySelectorAll('.node').forEach(el => {
                        if (el.id && (el.id.includes(lastActiveNodeId) || el.id.includes('flowchart-' + lastActiveNodeId))) {
                            targetEl = el;
                        }
                    });
                }

                // Strategy 3: If still nothing, just fit to screen
                if (!targetEl) {
                    fitToScreen();
                    return;
                }

                const graphView = document.getElementById('graph-view');
                const graphRect = graphView.getBoundingClientRect();
                const targetRect = targetEl.getBoundingClientRect();

                const targetCenterX = targetRect.left + targetRect.width / 2;
                const targetCenterY = targetRect.top + targetRect.height / 2;
                const graphCenterX = graphRect.left + graphRect.width / 2;
                const graphCenterY = graphRect.top + graphRect.height / 2;

                // Calculate offset to center target in viewport
                transform.x = graphCenterX - targetCenterX;
                transform.y = graphCenterY - targetCenterY;
                updateTransform();
            }, 150);
        }

        // Search input handlers
        const searchInput = document.getElementById('search-input');
        let searchTimeout = null;
        
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                performSearch(e.target.value);
            }, 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    navigateSearch(-1);
                } else {
                    navigateSearch(1);
                }
            } else if (e.key === 'Escape') {
                closeSearch();
            }
        });

        // Cmd+F / Ctrl+F keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                openSearch();
            }
        });

        updateTransform();

        // Signal that webview is ready to receive data
        vscode.postMessage({ type: 'ready' });`;
