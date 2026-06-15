import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { checksumFile, copyFileEnsuringDir, ensureDir, exists, timestampSlug } from "./fs-utils.js";
import { getRestoreRoot } from "./scan-config.js";
import { applyConfigReviewChoices, buildConfigReview } from "./config-review.js";
import { checkMcpRuntimes } from "./mcp-runtime-checker.js";
import { buildMigrationResultSummary } from "./result-summary.js";
import type { ExportManifest, ImportOptions, MigrationResultSummary, RestorePlan, RestorePlanAction, RollbackOptions } from "./types.js";

export async function importMigrationPackage(options: ImportOptions): Promise<{
  manifest: ExportManifest;
  extractDir: string;
  restorePlan: RestorePlan;
  restorePlanPath: string;
  restoreReportPath: string;
  resultSummary: MigrationResultSummary;
  mcpRuntime: Awaited<ReturnType<typeof checkMcpRuntimes>>;
}> {
  const extractDir = await extractArchive(options.archivePath);
  const manifest = await readExportManifest(extractDir);
  validateManifest(manifest);
  await verifyChecksums(extractDir, manifest);

  const restorePlan = await buildRestorePlan(extractDir, manifest, options);
  const restorePlanPath = path.join(extractDir, "restore_plan.json");
  const planToApply = options.restorePlanPath ? JSON.parse(await fs.readFile(options.restorePlanPath, "utf8")) as RestorePlan : restorePlan;
  await fs.writeFile(restorePlanPath, JSON.stringify(planToApply, null, 2), "utf8");

  if (!options.dryRun) {
    await applyRestorePlan(planToApply, options);
  }

  const restoreReportPath = path.join(extractDir, "restore_report.md");
  await writeRestoreReport(restoreReportPath, planToApply, options.dryRun === true);
  const mcpRuntime = await checkMcpRuntimes(extractDir, manifest);
  const resultSummary = buildMigrationResultSummary(manifest, planToApply, restoreReportPath, mcpRuntime.servers);
  return { manifest, extractDir, restorePlan: planToApply, restorePlanPath, restoreReportPath, resultSummary, mcpRuntime };
}

export const runImport = importMigrationPackage;

export async function planImport(options: ImportOptions): Promise<{
  manifest: ExportManifest;
  actions: RestorePlanAction[];
  snapshotDir: string;
  restorePlan: RestorePlan;
}> {
  const result = await importMigrationPackage({ ...options, dryRun: true });
  return {
    manifest: result.manifest,
    actions: result.restorePlan.actions,
    snapshotDir: result.restorePlan.backup_snapshot,
    restorePlan: result.restorePlan
  };
}

export async function previewImportPackage(options: ImportOptions): Promise<{
  manifest: ExportManifest;
  extractDir: string;
  restorePlan: RestorePlan;
  restorePlanPath: string;
  configReview: Awaited<ReturnType<typeof buildConfigReview>>;
  mcpRuntime: Awaited<ReturnType<typeof checkMcpRuntimes>>;
}> {
  const extractDir = await extractArchive(options.archivePath);
  const manifest = await readExportManifest(extractDir);
  validateManifest(manifest);
  await verifyChecksums(extractDir, manifest);
  const restorePlan = await buildRestorePlan(extractDir, manifest, { ...options, dryRun: true });
  const restorePlanPath = path.join(extractDir, "restore_plan.json");
  await fs.writeFile(restorePlanPath, JSON.stringify(restorePlan, null, 2), "utf8");
  return {
    manifest,
    extractDir,
    restorePlan,
    restorePlanPath,
    configReview: await buildConfigReview(restorePlan),
    mcpRuntime: await checkMcpRuntimes(extractDir, manifest)
  };
}

export async function writeConfigReviewChoices(
  restorePlanPath: string,
  choices: Record<string, "skip" | "backup_then_overwrite" | "merge" | "rename_imported">
): Promise<RestorePlan> {
  const plan = JSON.parse(await fs.readFile(restorePlanPath, "utf8")) as RestorePlan;
  const next = await applyConfigReviewChoices(plan, choices);
  await fs.writeFile(restorePlanPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function rollback(options: RollbackOptions): Promise<{ restored: number; removed: number; reportPath: string }> {
  const manifestPath = path.join(options.snapshotDir, "rollback_manifest.json");
  const rollbackManifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    items: Array<{ target_path: string; backup_path?: string; existed_before: boolean }>;
  };
  let restored = 0;
  let removed = 0;

  for (const item of rollbackManifest.items.reverse()) {
    if (item.existed_before && item.backup_path) {
      await copyFileEnsuringDir(path.join(options.snapshotDir, item.backup_path), item.target_path);
      restored += 1;
    } else if (!item.existed_before && await exists(item.target_path)) {
      await fs.rm(item.target_path, { force: true });
      removed += 1;
    }
  }

  const reportPath = path.join(options.snapshotDir, "rollback_report.md");
  await fs.writeFile(reportPath, [`# Rollback Report`, "", `- Restored: ${restored}`, `- Removed: ${removed}`].join("\n"), "utf8");
  return { restored, removed, reportPath };
}

async function extractArchive(archivePath: string): Promise<string> {
  const absolute = path.resolve(archivePath);
  const stat = await fs.stat(absolute);
  if (stat.isDirectory()) return absolute;

  const zip = await JSZip.loadAsync(await fs.readFile(absolute));
  const extractDir = path.join(os.tmpdir(), `skills-migration-import-${timestampSlug()}`);
  await ensureDir(extractDir);

  for (const [zipName, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const target = path.resolve(extractDir, zipName);
    if (!target.startsWith(extractDir)) throw new Error(`Unsafe zip entry: ${zipName}`);
    await ensureDir(path.dirname(target));
    await fs.writeFile(target, await file.async("nodebuffer"));
  }
  return singleRootOrSelf(extractDir);
}

async function singleRootOrSelf(extractDir: string): Promise<string> {
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name);
  }
  return extractDir;
}

async function readExportManifest(exportDir: string): Promise<ExportManifest> {
  return JSON.parse(await fs.readFile(path.join(exportDir, "manifest.json"), "utf8")) as ExportManifest;
}

function validateManifest(manifest: ExportManifest): void {
  if (manifest.export_version !== "1.0.0") throw new Error(`Unsupported export_version: ${manifest.export_version}`);
  if (!Array.isArray(manifest.files)) throw new Error("Invalid manifest: files must be an array.");
}

async function verifyChecksums(exportDir: string, manifest: ExportManifest): Promise<void> {
  for (const file of manifest.files) {
    const source = path.join(exportDir, file.portable_target_path);
    const checksum = await checksumFile(source);
    if (checksum !== file.checksum) {
      throw new Error(`Checksum mismatch for ${file.portable_target_path}`);
    }
  }
}

async function buildRestorePlan(exportDir: string, manifest: ExportManifest, options: ImportOptions): Promise<RestorePlan> {
  const backupSnapshot = path.join(options.backupRoot ?? path.resolve("backups"), `${formatTimestamp(new Date())}-before-restore`);
  const actions: RestorePlanAction[] = [];

  for (const file of manifest.files) {
    const sourcePath = path.join(exportDir, file.portable_target_path);
    const targetPath = mapPortableTarget(file.agent_name, file.relative_path, options);
    const targetExists = await exists(targetPath);
    const baseAction = {
      id: file.id,
      agent_name: file.agent_name,
      category: file.category,
      source_path: sourcePath,
      target_path: targetPath,
      status: "planned" as const,
      checksum: file.checksum
    };

    if (file.category === "secrets") {
      actions.push({ ...baseAction, action: "skip", status: "skipped", reason: "Secrets are always skipped." });
    } else if (!targetExists) {
      actions.push({ ...baseAction, action: "create" });
    } else if (file.category === "settings" || file.category === "unknown") {
      actions.push(options.confirmSettings
        ? { ...baseAction, action: "overwrite", reason: "Settings overwrite explicitly confirmed." }
        : { ...baseAction, action: "confirm", reason: "Settings/config require user confirmation before overwrite." });
    } else if (file.category === "mcp_configs" && isJsonFile(targetPath)) {
      actions.push({ ...baseAction, action: "merge", reason: "MCP/config JSON will be merged." });
    } else if (["skills", "prompts", "commands", "agents", "memories"].includes(file.category)) {
      actions.push({ ...baseAction, target_path: await importedPath(targetPath), action: "rename", reason: "Conflict: imported file renamed." });
    } else {
      actions.push({ ...baseAction, target_path: await importedPath(targetPath), action: "rename", reason: "Conflict: imported file renamed." });
    }
  }

  return {
    created_at: new Date().toISOString(),
    source_export: path.basename(exportDir),
    target_os: options.platform ?? process.platform,
    target_home: options.restoreHomeDir ?? os.homedir(),
    backup_snapshot: backupSnapshot,
    actions
  };
}

async function applyRestorePlan(plan: RestorePlan, options: ImportOptions): Promise<void> {
  await ensureDir(plan.backup_snapshot);
  const rollbackItems: Array<{ target_path: string; backup_path?: string; existed_before: boolean }> = [];

  for (const action of plan.actions) {
    if (action.action === "skip" || action.action === "confirm") {
      action.status = "skipped";
      continue;
    }

    const existedBefore = await exists(action.target_path);
    let backupPath: string | undefined;
    if (existedBefore) {
      backupPath = path.join("files", action.id, path.basename(action.target_path));
      await copyFileEnsuringDir(action.target_path, path.join(plan.backup_snapshot, backupPath));
    }

    if (action.action === "merge" && existedBefore && isJsonFile(action.target_path)) {
      await mergeJsonFiles(action.target_path, action.source_path);
    } else if (action.action === "rename_imported") {
      await copyFileEnsuringDir(action.source_path, action.target_path);
    } else if (action.action === "backup_then_overwrite") {
      await copyFileEnsuringDir(action.source_path, action.target_path);
    } else {
      await copyFileEnsuringDir(action.source_path, action.target_path);
    }
    action.status = "done";
    rollbackItems.push({ target_path: action.target_path, backup_path: backupPath, existed_before: existedBefore });
  }

  await fs.writeFile(
    path.join(plan.backup_snapshot, "rollback_manifest.json"),
    JSON.stringify({ created_at: new Date().toISOString(), items: rollbackItems }, null, 2),
    "utf8"
  );
}

function mapPortableTarget(agentName: ExportManifest["files"][number]["agent_name"], relativePath: string, options: ImportOptions): string {
  return path.join(getRestoreRoot(agentName, {
    homeDir: options.restoreHomeDir,
    appData: options.restoreAppData,
    localAppData: options.restoreLocalAppData,
    platform: options.platform
  }), relativePath);
}

async function importedPath(targetPath: string): Promise<string> {
  const parsed = path.parse(targetPath);
  let candidate = path.join(parsed.dir, `${parsed.name}_imported${parsed.ext}`);
  let index = 2;
  while (await exists(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}_imported_${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function isJsonFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".json";
}

async function mergeJsonFiles(targetPath: string, sourcePath: string): Promise<void> {
  const target = JSON.parse(await fs.readFile(targetPath, "utf8")) as Record<string, unknown>;
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8")) as Record<string, unknown>;
  await fs.writeFile(targetPath, JSON.stringify(deepMerge(target, source), null, 2), "utf8");
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function writeRestoreReport(reportPath: string, plan: RestorePlan, dryRun: boolean): Promise<void> {
  const lines = [
    "# Restore Report",
    "",
    `- Mode: ${dryRun ? "preview" : "restore"}`,
    `- Created at: ${new Date().toISOString()}`,
    `- Source export: ${plan.source_export}`,
    `- Target OS: ${plan.target_os}`,
    `- Target home: ${plan.target_home}`,
    `- Backup snapshot: ${plan.backup_snapshot}`,
    "",
    "## Summary",
    "",
    `- Create: ${plan.actions.filter((action) => action.action === "create").length}`,
    `- Merge: ${plan.actions.filter((action) => action.action === "merge").length}`,
    `- Rename: ${plan.actions.filter((action) => action.action === "rename").length}`,
    `- Backup then overwrite: ${plan.actions.filter((action) => action.action === "backup_then_overwrite").length}`,
    `- Skipped/needs confirmation: ${plan.actions.filter((action) => action.action === "skip" || action.action === "confirm").length}`,
    "",
    "## Actions",
    "",
    "| Action | Status | Category | Target | Reason |",
    "| --- | --- | --- | --- | --- |",
    ...plan.actions.map((action) =>
      `| ${action.action} | ${action.status} | ${action.category} | \`${action.target_path.replaceAll("|", "\\|")}\` | ${action.reason ?? ""} |`
    )
  ];
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}
