const scanRows = document.querySelector("#scanRows");
const conflictRows = document.querySelector("#conflictRows");
const logsBox = document.querySelector("#logsBox");
const statusPill = document.querySelector("#statusPill");
const agentGrid = document.querySelector("#agentGrid");
const restorePlanBox = document.querySelector("#restorePlanBox");
const packagePreview = document.querySelector("#packagePreview");
const configReviewList = document.querySelector("#configReviewList");
const mcpRuntimeList = document.querySelector("#mcpRuntimeList");
let currentRestorePlanPath = "";

document.querySelectorAll("nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll("nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
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

document.querySelector("#quickScanBtn").addEventListener("click", () => runScan());
document.querySelector("#scanBtn").addEventListener("click", () => runScan());

async function runScan() {
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
  const result = await getJson("/api/export", { method: "POST" });
  document.querySelector("#exportResult").textContent = `Exported ${result.fileCount} files to ${result.exportDir}; zip ${result.zipPath}`;
  document.querySelector("#archivePath").value = result.zipPath;
  log("Export complete", result);
});

document.querySelector("#exportFolderBtn").addEventListener("click", async () => {
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
  const archive = encodeURIComponent(document.querySelector("#archivePath").value || "exports/latest.zip");
  const plan = currentRestorePlanPath ? `&plan=${encodeURIComponent(currentRestorePlanPath)}` : "";
  const result = await getJson(`/api/import/run?from=${archive}${plan}`, { method: "POST" });
  renderActions(result.actions);
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

document.querySelector("#rollbackBtn").addEventListener("click", async () => {
  const snapshot = encodeURIComponent(document.querySelector("#snapshotPath").value);
  const result = await getJson(`/api/rollback?snapshot=${snapshot}`, { method: "POST" });
  log("Rollback complete", result);
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
  const result = await getJson(`/api/import/manifest?from=${encodeURIComponent(archivePath)}`);
  renderPackagePreview(result.manifest);
  renderRestorePlan(result.restorePlan);
  renderConfigReview(result.configReview);
  renderMcpRuntime(result.mcpRuntime.servers);
  currentRestorePlanPath = result.restorePlanPath;
  document.querySelector("#snapshotPath").value = result.restorePlan.backup_snapshot;
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
    </div>
  `).join("");
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
