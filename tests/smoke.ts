import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildConfigReview, writeConfigDiffReport } from "../src/config-review.js";
import { writeConfigReviewChoices, importMigrationPackage, previewImportPackage, rollback } from "../src/importer.js";
import { checkMcpRuntimes } from "../src/mcp-runtime-checker.js";
import { exportMigrationPackage } from "../src/exporter.js";
import { exportToFolder } from "../src/export-to-folder.js";
import { scan } from "../src/scanner.js";
import { runSelfCheck } from "../src/self-check.js";
import { startServer } from "../src/server.js";

const exec = promisify(execFile);

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skills-migration-"));
  const sourceHome = path.join(tmp, "source");
  const targetHome = path.join(tmp, "target");
  const exportsDir = path.join(tmp, "exports");
  const backupRoot = path.join(tmp, "backups");

  await seedAgent(sourceHome, ".config", "opencode", "opencode-skill");
  await seedAgent(sourceHome, ".hermes", "", "hermes-skill");
  await seedAgent(sourceHome, ".claude", "", "claude-skill");
  await seedAgent(sourceHome, ".codex", "", "codex-skill");
  await fs.writeFile(path.join(sourceHome, ".claude", ".env"), "API_KEY=secret\n", "utf8");
  await fs.writeFile(path.join(sourceHome, ".codex", "token.json"), JSON.stringify({ token: "secret" }), "utf8");
  await fs.writeFile(path.join(sourceHome, ".claude", ".mcp.json"), JSON.stringify({
    mcpServers: {
      web: { command: "uvx", args: ["C:\\definitely\\missing\\server.py"], env: { API_TOKEN: "hidden" } },
      boxed: { command: "docker", args: ["run", "/definitely/missing"] },
      localPath: { command: "custom-runtime", args: ["/definitely/missing/local/path"] }
    }
  }, null, 2), "utf8");

  const scanManifest = await scan({ homeDir: sourceHome, platform: "linux" });
  assert(scanManifest.entries.some((entry) => entry.agent_name === "opencode" && entry.category === "skills"));

  const exported = await exportMigrationPackage({ homeDir: sourceHome, platform: "linux", outputDir: exportsDir });
  assert.equal(await fileExists(exported.zipPath), true);
  assert.equal(exported.manifest.skipped_sensitive_files.length, 2);

  const server = await startServer(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://localhost:${port}`;
  const zipPreview = await fetchJson(`${baseUrl}/api/import/manifest?from=${encodeURIComponent(exported.zipPath)}`);
  const dirPreview = await fetchJson(`${baseUrl}/api/import/manifest?from=${encodeURIComponent(exported.exportDir)}`);
  server.close();
  assert.equal(zipPreview.manifest.file_count, exported.manifest.file_count);
  assert.equal(dirPreview.manifest.file_count, exported.manifest.file_count);

  await fs.rm(targetHome, { recursive: true, force: true });
  await fs.mkdir(path.join(targetHome, ".claude", "skills", "claude-skill"), { recursive: true });
  await fs.mkdir(path.join(targetHome, ".claude", "settings"), { recursive: true });
  const existingSkill = path.join(targetHome, ".claude", "skills", "claude-skill", "SKILL.md");
  const existingSettings = path.join(targetHome, ".claude", "settings", "settings.json");
  await fs.writeFile(existingSkill, "# Existing Claude Skill\n", "utf8");
  await fs.writeFile(existingSettings, JSON.stringify({ theme: "old", keep: true }, null, 2), "utf8");

  const preview = await previewImportPackage({
    archivePath: exported.zipPath,
    restoreHomeDir: targetHome,
    platform: "linux",
    backupRoot
  });
  const review = await buildConfigReview(preview.restorePlan);
  const settingsReview = review.find((item) => item.target_file.endsWith(path.join(".claude", "settings", "settings.json")));
  assert(settingsReview);
  assert.equal(settingsReview.diff_summary.type, "json");
  assert(settingsReview.diff_summary.changed.includes("theme"));
  assert(settingsReview.diff_summary.conflicts?.includes("theme"));
  assert(preview.restorePlan.actions.some((action) => action.action === "confirm" && action.category === "settings"));
  const diffReport = await writeConfigDiffReport(review, preview.extractDir);
  assert.equal(await fileExists(diffReport), true);

  const choices: Record<string, "rename_imported"> = {};
  choices[settingsReview.id] = "rename_imported";
  const updatedPlan = await writeConfigReviewChoices(preview.restorePlanPath, choices);
  assert(updatedPlan.actions.some((action) => action.id === settingsReview.id && action.action === "rename_imported"));

  const oldPath = process.env.PATH;
  process.env.PATH = tmp;
  const mcpRuntime = await checkMcpRuntimes(preview.extractDir, preview.manifest);
  process.env.PATH = oldPath;
  assert(mcpRuntime.servers.some((server) => server.command === "uvx" && server.status === "missing_runtime"));
  assert(mcpRuntime.servers.some((server) => server.command === "docker" && (server.status === "missing_runtime" || server.status === "missing_path")));
  assert(mcpRuntime.servers.some((server) => server.server_name === "localPath" && server.status === "missing_path"));
  assert(mcpRuntime.servers.some((server) => server.command === "uvx" && server.suggestions.some((suggestion) => suggestion.includes("uv"))));

  const restored = await importMigrationPackage({
    archivePath: exported.zipPath,
    restoreHomeDir: targetHome,
    platform: "linux",
    backupRoot,
    restorePlanPath: preview.restorePlanPath
  });
  assert.equal(await fs.readFile(existingSkill, "utf8"), "# Existing Claude Skill\n");
  assert.equal(await fs.readFile(path.join(targetHome, ".claude", "skills", "claude-skill", "SKILL_imported.md"), "utf8"), "# claude-skill\n");
  assert.equal(await fs.readFile(path.join(targetHome, ".claude", "settings", "settings_imported.json"), "utf8"), JSON.stringify({ theme: "claude-skill" }, null, 2));
  assert.equal(await fileExists(path.join(targetHome, ".claude", ".env")), false);
  assert.equal(await fileExists(path.join(targetHome, ".codex", "token.json")), false);
  assert((await fs.readFile(restored.restoreReportPath, "utf8")).includes("rename_imported"));
  assert(restored.resultSummary.migrated_files > 0);
  assert.equal(restored.resultSummary.renamed_conflicts >= 1, true);
  assert.equal(restored.resultSummary.rollback_available, true);

  await rollback({ snapshotDir: restored.restorePlan.backup_snapshot });
  assert.equal(await fs.readFile(existingSkill, "utf8"), "# Existing Claude Skill\n");
  assert.equal(await fileExists(path.join(targetHome, ".claude", "skills", "claude-skill", "SKILL_imported.md")), false);

  const localBackup = path.join(tmp, "local-backup");
  await fs.mkdir(localBackup, { recursive: true });
  await exec("git", ["init"], { cwd: localBackup });
  await exec("git", ["config", "user.email", "smoke@example.test"], { cwd: localBackup });
  await exec("git", ["config", "user.name", "Smoke Test"], { cwd: localBackup });
  const folderExport = await exportToFolder({
    backupDir: localBackup,
    outputDir: localBackup,
    homeDir: sourceHome,
    platform: "linux",
    gitCommit: true
  });
  assert.equal(await fileExists(folderExport.latestZip), true);
  assert.equal(await fileExists(folderExport.manifestLatest), true);
  assert.equal(await fileExists(folderExport.historyPath), true);
  const remotes = await exec("git", ["remote"], { cwd: localBackup });
  assert.equal(remotes.stdout.trim(), "");
  assert(folderExport.gitCommit);

  const selfCheck = await runSelfCheck(path.join(tmp, "self-check"));
  assert(["Ready", "Partial", "Not Ready"].includes(selfCheck.status));
  assert.equal(await fileExists(selfCheck.reportPath), true);
  assert(selfCheck.checks.some((check) => check.name === "sensitive_filter" && check.ok));

  console.log(`Smoke test passed: ${tmp}`);
}

async function seedAgent(home: string, rootA: string, rootB: string, skillName: string): Promise<void> {
  const root = rootB ? path.join(home, rootA, rootB) : path.join(home, rootA);
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.mkdir(path.join(root, "prompts"), { recursive: true });
  await fs.mkdir(path.join(root, "settings"), { recursive: true });
  await fs.writeFile(path.join(root, "skills", skillName, "SKILL.md"), `# ${skillName}\n`, "utf8");
  await fs.writeFile(path.join(root, "prompts", "default.prompt"), `Prompt for ${skillName}\n`, "utf8");
  await fs.writeFile(path.join(root, "settings", "settings.json"), JSON.stringify({ theme: skillName }, null, 2), "utf8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
