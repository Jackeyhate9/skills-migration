const scanRows = document.querySelector("#scanRows");
const conflictRows = document.querySelector("#conflictRows");
const logsBox = document.querySelector("#logsBox");
const statusPill = document.querySelector("#statusPill");
const agentGrid = document.querySelector("#agentGrid");

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
  document.querySelector("#exportResult").textContent = `Exported to ${result.outputDir}; zip ${result.zipPath}`;
  log("Export complete", result);
});

document.querySelector("#previewBtn").addEventListener("click", async () => {
  const strategy = document.querySelector("#strategy").value;
  const result = await getJson(`/api/import/preview?strategy=${strategy}`);
  renderActions(result.actions);
  log("Import preview ready", { actions: result.actions.length, snapshotDir: result.snapshotDir });
});

document.querySelector("#restoreBtn").addEventListener("click", async () => {
  const result = await getJson("/api/import/run", { method: "POST" });
  renderActions(result.actions);
  log("Restore complete", result);
});

function renderActions(actions) {
  conflictRows.innerHTML = actions.length === 0 ? `<tr><td colspan="4" class="empty">No actions planned.</td></tr>` : actions.map((action) => `
    <tr>
      <td>${action.action}</td>
      <td>${action.status}</td>
      <td>${action.target}</td>
      <td>${action.reason || ""}</td>
    </tr>
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
