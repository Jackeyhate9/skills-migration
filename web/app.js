const scanRows = document.querySelector("#scanRows");
const conflictRows = document.querySelector("#conflictRows");
const logsBox = document.querySelector("#logsBox");
const statusPill = document.querySelector("#statusPill");
const agentGrid = document.querySelector("#agentGrid");
const restorePlanBox = document.querySelector("#restorePlanBox");
const packagePreview = document.querySelector("#packagePreview");
const configReviewList = document.querySelector("#configReviewList");
const mcpRuntimeList = document.querySelector("#mcpRuntimeList");
const resultSummaryGrid = document.querySelector("#resultSummaryGrid");
const selfCheckResult = document.querySelector("#selfCheckResult");
const runtimePill = document.querySelector("#runtimePill");
const capabilityNotice = document.querySelector("#capabilityNotice");
let currentRestorePlanPath = "";
let currentArchivePath = "";
const runtimeMode = window.__TAURI__ ? "tauri_desktop" : "browser_fallback";

document.querySelectorAll("nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll("nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

applyCapabilityGuard();

document.querySelector("#wizardOldScan").addEventListener("click", () => {
  location.hash = "#scan";
  if (runtimeMode === "tauri_desktop") runScan();
});
document.querySelector("#wizardOldExport").addEventListener("click", () => {
  location.hash = "#export";
  document.querySelector("#exportBtn").click();
});
document.querySelector("#wizardNewChoose").addEventListener("click", () => {
  location.hash = "#import";
  document.querySelector("#choosePackageBtn").click();
});
document.querySelector("#wizardNewRestore").addEventListener("click", () => {
  location.hash = "#result-summary";
  document.querySelector("#restoreBtn").click();
});

function log(message, data) {
  const line = data ? `${message}\n${JSON.stringify(data, null, 2)}` : message;
  logsBox.textContent = `${new Date().toLocaleTimeString()} ${line}\n\n${logsBox.textContent}`;
}

function setStatus(text, mode = "idle") {
  statusPill.textContent = text;
  const colors = {
    idle: ["#1849a9", "#e0edff"],
    busy: ["#854a0e", "#fff4df"],
    done: ["#087443", "#dcfaeb"],
    error: ["#b42318", "#fee4e2"]
  };
  const [color, background] = colors[mode] || colors.idle;
  statusPill.style.color = color;
  statusPill.style.background = background;
}

async function getJson(url, options) {
  setStatus("Working", "busy");
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    setStatus("Error", "error");
    throw new Error(data.error || response.statusText);
  }
  setStatus("Ready", "done");
  return data;
}

function applyCapabilityGuard() {
  const desktop = runtimeMode === "tauri_desktop";
  runtimePill.textContent = desktop ? "tauri_desktop" : "browser_fallback";
  runtimePill.style.color = desktop ? "#087443" : "#854a0e";
  runtimePill.style.background = desktop ? "#dcfaeb" : "#fff4df";
  capabilityNotice.textContent = desktop
    ? "Desktop mode: file chooser, local scanning, backup, restore, and rollback are enabled."
    : "Browser fallback: local directory scanning, direct restore, backup, and rollback are disabled. Upload a zip to preview manifest and restore plan. Full migration requires the desktop app.";
  ["#quickScanBtn", "#scanBtn", "#exportBtn", "#exportFolderBtn", "#restoreBtn", "#rollbackBtn", "#wizardOldScan", "#wizardOldExport", "#wizardNewRestore"].forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) element.disabled = !desktop;
  });
}

document.querySelector("#quickScanBtn").addEventListener("click", () => runScan());
document.querySelector("#scanBtn").addEventListener("click", () => runScan());

async function runScan() {
  if (runtimeMode !== "tauri_desktop") {
    log("Scan disabled in browser fallback. Use the desktop app for full migration.");
    return;
  }
  const sessions = document.querySelector("#sessions").checked;
  const manifest = await getJson(`/api/scan?sessions=${sessions}`);
  document.querySelector("#totalFiles").textContent = manifest.summary.total_files;
  document.querySelector("#includedFiles").textContent = manifest.summary.included_files;
  document.querySelector("#secretFiles").textContent = manifest.excluded_secrets.length;
  renderAgents(manifest);
  scanRows.innerHTML = manifest.entries.length === 0 ? `<tr><td colspan="5" class="empty">No agent files found.</td></tr>` : manifest.entries.slice(0, 200).map((entry) => `
    <tr>
      <td>${entry.agent_name}</td>
      <td>${entry.category}</td>
      <td><span class="badge ${entry.risk_level}">${entry.risk_level}</span></td>
      <td>${entry.size}</td>
      <td>${entry.detected_paths[0]}</td>
    </tr>
  `).join("");
  log("Scan complete", manifest.summary);
}

document.querySelector("#exportBtn").addEventListener("click", async () => {
  if (runtimeMode !== "tauri_desktop") return log("Export disabled in browser fallback.");
  const result = await getJson("/api/export", { method: "POST" });
  document.querySelector("#exportResult").textContent = `Exported ${result.fileCount} files to ${result.exportDir}; zip ${result.zipPath}`;
  document.querySelector("#archivePath").value = result.zipPath;
  log("Export complete", result);
});

document.querySelector("#exportFolderBtn").addEventListener("click", async () => {
  if (runtimeMode !== "tauri_desktop") return log("Export to folder disabled in browser fallback.");
  const dir = encodeURIComponent(document.querySelector("#backupDir").value || "local-backup");
  const git = document.querySelector("#gitCommit").checked;
  const result = await getJson(`/api/export/folder?dir=${dir}&git=${git}`, { method: "POST" });
  document.querySelector("#exportResult").textContent = `Latest zip ${result.latestZip}; history ${result.historyPath}`;
  document.querySelector("#archivePath").value = result.latestZip;
  log("Export to folder complete", result);
});

document.querySelector("#choosePackageBtn").addEventListener("click", async () => {
  const tauriOpen = window.__TAURI__?.dialog?.open || window.__TAURI__?.core?.invoke;
  if (tauriOpen && window.__TAURI__?.dialog?.open) {
    const chooseDir = window.confirm("选择已解压导出目录？点击“取消”选择 .zip 迁移包。");
    const selected = await window.__TAURI__.dialog.open({
      multiple: false,
      directory: chooseDir,
      filters: chooseDir ? undefined : [{ name: "Migration package", extensions: ["zip"] }]
    });
    if (selected) {
      document.querySelector("#archivePath").value = selected;
      await loadPackagePreview(selected);
    }
  } else {
    document.querySelector("#packageFileInput").click();
  }
});

document.querySelector("#packageFileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const upload = await fetch(`/api/import/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: await file.arrayBuffer()
  }).then((response) => response.json());
  document.querySelector("#archivePath").value = upload.archivePath;
  await loadPackagePreview(upload.archivePath);
});

document.querySelector("#previewBtn").addEventListener("click", async () => {
  const archive = encodeURIComponent(document.querySelector("#archivePath").value || "exports/latest.zip");
  currentArchivePath = document.querySelector("#archivePath").value || "exports/latest.zip";
  const result = await getJson(`/api/import/manifest?from=${archive}`);
  renderActions(result.restorePlan.actions);
  renderPackagePreview(result.manifest);
  renderRestorePlan(result.restorePlan);
  renderConfigReview(result.configReview);
  renderMcpRuntime(result.mcpRuntime.servers);
  currentRestorePlanPath = result.restorePlanPath;
  document.querySelector("#snapshotPath").value = result.restorePlan.backup_snapshot;
  log("Import preview ready", { actions: result.restorePlan.actions.length, snapshotDir: result.restorePlan.backup_snapshot });
});

document.querySelector("#restoreBtn").addEventListener("click", async () => {
  if (runtimeMode !== "tauri_desktop") return log("Restore disabled in browser fallback. Use the desktop app for full migration.");
  const archive = encodeURIComponent(document.querySelector("#archivePath").value || "exports/latest.zip");
  const plan = currentRestorePlanPath ? `&plan=${encodeURIComponent(currentRestorePlanPath)}` : "";
  const result = await getJson(`/api/import/run?from=${archive}${plan}`, { method: "POST" });
  renderActions(result.actions);
  renderResultSummary(result.resultSummary);
  renderMcpRuntime(result.mcpRuntime.servers);
  document.querySelector("#snapshotPath").value = result.snapshotDir;
  log("Restore complete", result);
});

document.querySelector("#applyConfigReviewBtn").addEventListener("click", async () => {
  const choices = {};
  document.querySelectorAll("[data-config-choice]").forEach((select) => {
    choices[select.dataset.configChoice] = select.value;
  });
  const result = await getJson("/api/config-review/apply", {
    method: "POST",
    body: JSON.stringify({ restorePlanPath: currentRestorePlanPath, choices })
  });
  renderRestorePlan(result.restorePlan);
  log("Config choices applied", choices);
});

document.querySelector("#exportDiffReportBtn").addEventListener("click", async () => {
  if (!currentRestorePlanPath) return log("No restore plan loaded.");
  const result = await getJson("/api/config-review/report", {
    method: "POST",
    body: JSON.stringify({ restorePlanPath: currentRestorePlanPath })
  });
  log("Config diff report exported", result);
});

document.querySelector("#recheckMcpBtn").addEventListener("click", async () => {
  const archive = encodeURIComponent(currentArchivePath || document.querySelector("#archivePath").value || "exports/latest.zip");
  const result = await getJson(`/api/mcp-runtime/recheck?from=${archive}`);
  renderMcpRuntime(result.servers);
  log("MCP runtime rechecked", result);
});

document.querySelector("#rollbackBtn").addEventListener("click", async () => {
  if (runtimeMode !== "tauri_desktop") return log("Rollback disabled in browser fallback. Use the desktop app for full migration.");
  const snapshot = encodeURIComponent(document.querySelector("#snapshotPath").value);
  const result = await getJson(`/api/rollback?snapshot=${snapshot}`, { method: "POST" });
  log("Rollback complete", result);
});

document.querySelector("#selfCheckBtn").addEventListener("click", async () => {
  const result = await getJson("/api/self-check", { method: "POST" });
  renderSelfCheck(result);
  log("Self check complete", result);
});

function renderActions(actions) {
  conflictRows.innerHTML = actions.length === 0 ? `<tr><td colspan="4" class="empty">No actions planned.</td></tr>` : actions.map((action) => `
    <tr>
      <td>${action.action}</td>
      <td>${action.status}</td>
      <td>${action.target_path}</td>
      <td>${action.reason || ""}</td>
    </tr>
  `).join("");
}

function renderRestorePlan(plan) {
  restorePlanBox.textContent = JSON.stringify({
    backup_snapshot: plan.backup_snapshot,
    create: plan.actions.filter((action) => action.action === "create").length,
    merge: plan.actions.filter((action) => action.action === "merge").length,
    rename: plan.actions.filter((action) => action.action === "rename").length,
    confirm: plan.actions.filter((action) => action.action === "confirm").length,
    skip: plan.actions.filter((action) => action.action === "skip").length,
    actions: plan.actions.slice(0, 25)
  }, null, 2);
}

async function loadPackagePreview(archivePath) {
  currentArchivePath = archivePath;
  const result = await getJson(`/api/import/manifest?from=${encodeURIComponent(archivePath)}`);
  renderPackagePreview(result.manifest);
  renderRestorePlan(result.restorePlan);
  renderConfigReview(result.configReview);
  renderMcpRuntime(result.mcpRuntime.servers);
  currentRestorePlanPath = result.restorePlanPath;
  document.querySelector("#snapshotPath").value = result.restorePlan.backup_snapshot;
}

function renderResultSummary(summary) {
  if (!summary) {
    resultSummaryGrid.innerHTML = "";
    return;
  }
  resultSummaryGrid.innerHTML = Object.entries(summary).map(([label, value]) =>
    `<div><strong>${label}</strong><span>${value}</span></div>`
  ).join("");
}

function renderPackagePreview(manifest) {
  packagePreview.innerHTML = [
    ["export_version", manifest.export_version],
    ["created_at", manifest.created_at],
    ["source_os", manifest.source_os],
    ["source_hostname", manifest.source_hostname],
    ["detected_agents", manifest.detected_agents.join(", ")],
    ["file_count", manifest.file_count],
    ["total_size", manifest.total_size],
    ["skipped_sensitive_files", manifest.skipped_sensitive_files.length]
  ].map(([label, value]) => `<div><strong>${label}</strong><span>${value}</span></div>`).join("");
}

function renderConfigReview(items) {
  configReviewList.innerHTML = items.length === 0 ? "No settings/config conflicts need review." : items.map((item) => `
    <div class="review-item">
      <strong>${item.agent} · ${item.category}</strong>
      <span>Source: ${item.source_file}</span>
      <span>Target: ${item.target_file}</span>
      <span>Target exists: ${item.target_exists}</span>
      <span>${item.diff_summary.preview}</span>
      <small>${formatDiffSummary(item.diff_summary)}</small>
      <div class="review-actions">
        <select data-config-choice="${item.id}">
          ${["skip", "backup_then_overwrite", "merge", "rename_imported"].map((action) =>
            `<option value="${action}" ${action === item.recommended_action ? "selected" : ""}>${action}</option>`
          ).join("")}
        </select>
        <button class="secondary" onclick="alert(${JSON.stringify(JSON.stringify(item.diff_summary, null, 2))})">view_diff</button>
      </div>
    </div>
  `).join("");
}

function renderMcpRuntime(servers) {
  mcpRuntimeList.innerHTML = servers.length === 0 ? "No MCP configs detected." : servers.map((server) => `
    <div class="review-item">
      <strong class="status-${server.status}">${server.status}</strong>
      <span>${server.agent} · ${server.server_name}</span>
      <span>command: ${server.command || "unknown"}</span>
      <span>args: ${server.args.join(" ")}</span>
      <span>env keys: ${server.env_keys.join(", ") || "none"}</span>
      <small>${server.details.join("; ")}</small>
      <small>suggestions: ${(server.suggestions || []).join("; ")}</small>
    </div>
  `).join("");
}

function renderSelfCheck(result) {
  selfCheckResult.innerHTML = `
    <div class="review-item">
      <strong class="status-${result.status === "Ready" ? "ready" : result.status === "Partial" ? "skipped_secret_env" : "missing_runtime"}">${result.status}</strong>
      <span>Report: ${result.reportPath}</span>
    </div>
    ${result.checks.map((check) => `
      <div class="review-item">
        <strong class="${check.ok ? "status-ready" : "status-missing_runtime"}">${check.ok ? "ready" : "not ready"} 路 ${check.name}</strong>
        <span>${check.details}</span>
      </div>
    `).join("")}
  `;
}

function formatDiffSummary(summary) {
  if (summary.type === "json") {
    return [
      `added keys: ${(summary.added || []).join(", ") || "none"}`,
      `removed keys: ${(summary.removed || []).join(", ") || "none"}`,
      `changed keys: ${(summary.changed || []).join(", ") || "none"}`,
      `conflict keys: ${(summary.conflicts || []).join(", ") || "none"}`
    ].join(" | ");
  }
  return `changed lines: ${summary.changed_line_count || 0} | added lines: ${summary.added_line_count || 0} | removed lines: ${summary.removed_line_count || 0}`;
}

function renderAgents(manifest) {
  const agents = Object.entries(manifest.summary.agents);
  agentGrid.innerHTML = agents.length === 0 ? `<div class="agent-card">No supported agent homes were found.</div>` : agents.map(([agent, stats]) => {
    const agentEntries = manifest.entries.filter((entry) => entry.agent_name === agent);
    const highestRisk = agentEntries.some((entry) => entry.risk_level === "high")
      ? "high"
      : agentEntries.some((entry) => entry.risk_level === "medium") ? "medium" : "low";
    const categories = [...new Set(agentEntries.map((entry) => entry.category))].slice(0, 4).join(", ");
    return `
      <div class="agent-card">
        <header>
          <strong>${agent}</strong>
          <span class="badge ${highestRisk}">${highestRisk}</span>
        </header>
        <span>${stats.file_count} files · ${stats.size} bytes</span>
        <small>${categories || "unknown"}</small>
      </div>
    `;
  }).join("");
}

window.addEventListener("error", (event) => {
  setStatus("Error", "error");
  log(event.message);
});
