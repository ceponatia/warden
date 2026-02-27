/* global window, document, fetch, WebSocket, setTimeout, URLSearchParams, URL, HTMLButtonElement, HTMLAnchorElement, HTMLSelectElement, HTMLTextAreaElement, CSS */

(function () {
  const root = document.body;
  const page = root.getAttribute("data-page") || "";
  const slug = root.getAttribute("data-slug") || "";
  let allowReconnect = true;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function isTextInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function openWs(onEvent) {
    if (!slug) return null;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    ws.addEventListener("open", function () {
      ws.send(JSON.stringify({ type: "subscribe", slug: slug }));
    });

    ws.addEventListener("message", function (event) {
      try {
        onEvent(JSON.parse(String(event.data)));
      } catch {
        // Ignore malformed events
      }
    });

    ws.addEventListener("close", function () {
      if (!allowReconnect) {
        return;
      }
      setTimeout(function () {
        openWs(onEvent);
      }, 2000);
    });

    return ws;
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  function setupRepoPage() {
    const controls = document.getElementById("repo-controls");
    const modal = document.getElementById("command-modal");
    const output = document.getElementById("command-output");
    const closeButton = document.getElementById("command-close");
    const searchInput = document.getElementById("finding-search");
    const sortSelect = document.getElementById("finding-sort");
    const findingTableBody = document.getElementById("finding-table-body");
    const helpOverlay = document.getElementById("shortcut-help");

    if (!controls || !searchInput || !sortSelect || !findingTableBody) return;

    let currentJobId = "";
    let selectedFindingIndex = 0;

    const reportScript = document.getElementById("report-data");
    const workStatusScript = document.getElementById("work-status-data");
    const findings = reportScript
      ? JSON.parse(reportScript.textContent || "{}")
      : { findings: [] };
    const workStatuses = workStatusScript
      ? JSON.parse(workStatusScript.textContent || "{}")
      : {};

    function selectedMetrics() {
      return Array.from(
        document.querySelectorAll('input[name="metric-filter"]:checked'),
      ).map(function (el) {
        return el.value;
      });
    }

    function selectedSeverities() {
      return Array.from(
        document.querySelectorAll('input[name="severity-filter"]:checked'),
      ).map(function (el) {
        return el.value;
      });
    }

    function renderFindings() {
      const metrics = selectedMetrics();
      const severities = selectedSeverities();
      const statusNode = document.getElementById("status-filter");
      if (!(statusNode instanceof HTMLSelectElement)) {
        return;
      }
      const status = statusNode.value;
      const query = searchInput.value.trim().toLowerCase();
      const sort = sortSelect.value;

      const filtered = (findings.findings || []).filter(function (finding) {
        const findingStatus = finding.workDocumentId
          ? workStatuses[finding.workDocumentId] || "unassigned"
          : "unassigned";
        if (metrics.length > 0 && metrics.indexOf(finding.metric) < 0)
          return false;
        if (severities.length > 0 && severities.indexOf(finding.severity) < 0)
          return false;
        if (status !== "all" && findingStatus !== status) return false;
        if (query.length > 0) {
          const haystack =
            `${finding.summary} ${finding.path || ""}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });

      filtered.sort(function (left, right) {
        if (sort === "path") {
          return (left.path || "").localeCompare(right.path || "");
        }
        if (sort === "consecutive") {
          return right.consecutiveReports - left.consecutiveReports;
        }
        if (sort === "severity") {
          return left.severity.localeCompare(right.severity);
        }
        return (right.lastSeen || "").localeCompare(left.lastSeen || "");
      });

      const rows = filtered.map(function (finding, index) {
        const selectedClass = selectedFindingIndex === index ? " selected" : "";
        const workDoc = finding.workDocumentId
          ? `<a href="/repo/${encodeURIComponent(slug)}/work?findingId=${encodeURIComponent(finding.workDocumentId)}">${escapeHtml(finding.workDocumentId)}</a>`
          : "-";
        return `<tr class="finding-row${selectedClass}" data-index="${index}">
          <td>${escapeHtml(finding.code)}</td>
          <td><span class="badge badge-${String(finding.severity).toLowerCase()}">${escapeHtml(finding.severity)}</span></td>
          <td>${escapeHtml(finding.summary)}</td>
          <td>${escapeHtml(finding.path || "-")}</td>
          <td>${finding.consecutiveReports}</td>
          <td>${escapeHtml(finding.trend)}</td>
          <td>${workDoc}</td>
        </tr>`;
      });

      findingTableBody.innerHTML = rows.join("");
      var hashParts = [
        "q=" + encodeURIComponent(searchInput.value),
        "sort=" + encodeURIComponent(sortSelect.value),
        "status=" + encodeURIComponent(status),
        "metrics=" + encodeURIComponent(metrics.join(",")),
        "severities=" + encodeURIComponent(severities.join(",")),
      ];
      var hash = hashParts.join("&");
      if (window.history && typeof window.history.replaceState === "function") {
        var url = new URL(window.location.href);
        url.hash = hash;
        window.history.replaceState(null, "", url);
      } else {
        window.location.hash = hash;
      }
    }

    function setCommandButtonsDisabled(disabled) {
      Array.from(controls.querySelectorAll("button[data-command]")).forEach(
        function (button) {
          button.disabled = disabled;
        },
      );
    }

    function openModal() {
      if (!modal) return;
      modal.hidden = false;
    }

    function closeModal() {
      if (!modal) return;
      modal.hidden = true;
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeModal);
    }

    controls.addEventListener("click", async function (event) {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const command = target.getAttribute("data-command");
      if (!command) return;

      setCommandButtonsDisabled(true);
      openModal();
      if (output) {
        output.textContent = `Starting ${command}...\n`;
      }

      try {
        const payload = await postJson(
          `/api/repo/${encodeURIComponent(slug)}/${command}`,
        );
        currentJobId = payload.jobId;
      } catch (error) {
        if (output) {
          output.textContent += `${error instanceof Error ? error.message : String(error)}\n`;
        }
        setCommandButtonsDisabled(false);
      }
    });

    openWs(function (event) {
      if (!event || event.slug !== slug) return;
      if (event.type === "command-output") {
        if (!currentJobId || event.payload.jobId !== currentJobId) return;
        if (output) {
          output.textContent += `${event.payload.line}\n`;
          output.scrollTop = output.scrollHeight;
        }
      }
      if (event.type === "command-complete") {
        if (!currentJobId || event.payload.jobId !== currentJobId) return;
        if (output) {
          output.textContent += `\nCommand completed with exit code ${event.payload.exitCode}.\n`;
        }
        setCommandButtonsDisabled(false);
        setTimeout(function () {
          window.location.reload();
        }, 600);
      }
    });

    const statusFilter = document.getElementById("status-filter");
    const filterInputs = Array.from(
      document.querySelectorAll(
        "#finding-filters input, #finding-filters select",
      ),
    );
    filterInputs.forEach(function (node) {
      node.addEventListener("change", renderFindings);
      node.addEventListener("input", renderFindings);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "?" && !isTextInputFocused()) {
        event.preventDefault();
        helpOverlay.hidden = !helpOverlay.hidden;
        return;
      }

      if (isTextInputFocused()) return;

      if (event.key === "c") {
        event.preventDefault();
        document.querySelector('button[data-command="collect"]').focus();
      }
      if (event.key === "a") {
        event.preventDefault();
        document.querySelector('button[data-command="analyze"]').focus();
      }
      if (event.key === "f" || event.key === "/") {
        event.preventDefault();
        searchInput.focus();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        searchInput.value = "";
        if (statusFilter instanceof HTMLSelectElement) {
          statusFilter.value = "all";
        }
        closeModal();
        helpOverlay.hidden = true;
        renderFindings();
      }
      if (event.key === "j") {
        event.preventDefault();
        const rowCount =
          findingTableBody.querySelectorAll("tr.finding-row").length;
        selectedFindingIndex = Math.min(
          Math.max(0, rowCount - 1),
          selectedFindingIndex + 1,
        );
        renderFindings();
      }
      if (event.key === "k") {
        event.preventDefault();
        selectedFindingIndex = Math.max(0, selectedFindingIndex - 1);
        renderFindings();
      }
      if (event.key === "Enter") {
        const selected = findingTableBody.querySelector(
          "tr.finding-row.selected a",
        );
        if (selected instanceof HTMLAnchorElement) {
          window.location.href = selected.href;
        }
      }
    });

    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    const q = hashParams.get("q");
    const sort = hashParams.get("sort");
    const status = hashParams.get("status");
    const metricsParam = hashParams.get("metrics");
    const severitiesParam = hashParams.get("severities");
    if (q) searchInput.value = q;
    if (sort) sortSelect.value = sort;
    if (status && statusFilter instanceof HTMLSelectElement) {
      statusFilter.value = status;
    }
    if (metricsParam) {
      const metricValues = metricsParam.split(",").filter(Boolean);
      document.querySelectorAll('input[name="metric-filter"]').forEach(function (el) {
        el.checked = metricValues.indexOf(el.value) >= 0;
      });
    }
    if (severitiesParam) {
      const severityValues = severitiesParam.split(",").filter(Boolean);
      document.querySelectorAll('input[name="severity-filter"]').forEach(function (el) {
        el.checked = severityValues.indexOf(el.value) >= 0;
      });
    }

    renderFindings();
  }

  function setupWorkPage() {
    const bulkButton = document.getElementById("bulk-update");
    const bulkStatus = document.getElementById("bulk-status");
    const bulkNote = document.getElementById("bulk-note");
    const noteButtons = Array.from(
      document.querySelectorAll("button[data-add-note]"),
    );

    if (bulkButton && bulkStatus instanceof HTMLSelectElement) {
      bulkButton.addEventListener("click", async function () {
        const selected = Array.from(
          document.querySelectorAll('input[name="bulk-finding"]:checked'),
        ).map(function (el) {
          return el.value;
        });
        if (selected.length === 0) return;

        await postJson(
          `/api/repo/${encodeURIComponent(slug)}/work/bulk-status`,
          {
            findingIds: selected,
            status: bulkStatus.value,
            note: bulkNote ? bulkNote.value : "",
          },
        );
        window.location.reload();
      });
    }

    noteButtons.forEach(function (button) {
      button.addEventListener("click", async function () {
        const findingId = button.getAttribute("data-add-note");
        if (!findingId) return;
        const input = document.querySelector(
          `textarea[data-note-for="${CSS.escape(findingId)}"]`,
        );
        if (!(input instanceof HTMLTextAreaElement)) return;
        if (input.value.trim().length === 0) return;

        await postJson(
          `/api/repo/${encodeURIComponent(slug)}/work/${encodeURIComponent(findingId)}/note`,
          {
            text: input.value,
          },
        );
        window.location.reload();
      });
    });
  }

  if (page === "repo") {
    setupRepoPage();
  }
  if (page === "work") {
    setupWorkPage();
  }

  window.addEventListener("pagehide", function () {
    allowReconnect = false;
  });
})();
