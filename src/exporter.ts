import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { copyFileEnsuringDir, ensureDir, timestampSlug } from "./fs-utils.js";
import { scan } from "./scanner.js";
import type { ExportManifest, ExportOptions, RestorePlan, ScanEntry } from "./types.js";

export async function exportMigrationPackage(options: ExportOptions): Promise<{
  manifest: ExportManifest;
  exportDir: string;
  zipPath: string;
  reportPath: string;
}> {
  const createdAt = new Date();
  const exportName = `agent-skills-export-${formatExportTimestamp(createdAt)}`;
  const exportRoot = path.resolve(options.outputDir);
  const exportDir = path.join(exportRoot, exportName);
  const agentsDir = path.join(exportDir, "agents");
  const logsDir = path.join(exportDir, "logs");
  await ensureDir(agentsDir);
  await ensureDir(logsDir);

  const scanManifest = await scan(options);
  const included = scanManifest.entries.filter((entry) => entry.included);
  const files = included.map(toExportFile);
  const manifest: ExportManifest = {
    export_version: "1.0.0",
    created_at: createdAt.toISOString(),
    source_os: options.platform ?? process.platform,
    source_hostname: os.hostname(),
    detected_agents: [...new Set(files.map((file) => file.agent_name))],
    categories: [...new Set(files.map((file) => file.category))],
    file_count: files.length,
    total_size: files.reduce((sum, file) => sum + file.size, 0),
    checksums: Object.fromEntries(files.map((file) => [file.portable_target_path, file.checksum])),
    files,
    skipped_sensitive_files: scanManifest.excluded_secrets
  };

  for (const file of files) {
    const source = file.original_path;
    const target = path.join(exportDir, file.portable_target_path);
    await copyFileEnsuringDir(source, target);
  }

  const restorePlanTemplate: RestorePlan = {
    created_at: new Date().toISOString(),
    source_export: exportName,
    target_os: process.platform,
    target_home: "",
    backup_snapshot: "",
    actions: []
  };

  const manifestPath = path.join(exportDir, "manifest.json");
  const templatePath = path.join(exportDir, "restore_plan.template.json");
  const reportPath = path.join(logsDir, "export_report.md");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(templatePath, JSON.stringify(restorePlanTemplate, null, 2), "utf8");
  await writeExportReport(reportPath, manifest);

  const zipPath = path.join(exportRoot, `${exportName}.zip`);
  await zipDirectory(exportDir, zipPath);
  return { manifest, exportDir, zipPath, reportPath };
}

export const exportBackup = exportMigrationPackage;

function toExportFile(entry: ScanEntry) {
  return {
    id: entry.id,
    agent_name: entry.agent_name,
    category: entry.category,
    original_path: entry.detected_paths[0],
    portable_target_path: path.posix.join("agents", entry.agent_name, entry.relative_path.replaceAll("\\", "/")),
    relative_path: entry.relative_path,
    size: entry.size,
    checksum: entry.checksum,
    risk_level: entry.risk_level
  };
}

async function writeExportReport(reportPath: string, manifest: ExportManifest): Promise<void> {
  const lines = [
    "# Export Report",
    "",
    `- Export version: ${manifest.export_version}`,
    `- Created at: ${manifest.created_at}`,
    `- Source OS: ${manifest.source_os}`,
    `- Source hostname: ${manifest.source_hostname}`,
    `- Detected agents: ${manifest.detected_agents.join(", ") || "none"}`,
    `- Categories: ${manifest.categories.join(", ") || "none"}`,
    `- File count: ${manifest.file_count}`,
    `- Total size: ${manifest.total_size}`,
    `- Skipped sensitive files: ${manifest.skipped_sensitive_files.length}`,
    "",
    "## Files",
    "",
    "| Agent | Category | Portable path | Size |",
    "| --- | --- | --- | --- |",
    ...manifest.files.map((file) =>
      `| ${file.agent_name} | ${file.category} | \`${file.portable_target_path.replaceAll("|", "\\|")}\` | ${file.size} |`
    )
  ];
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
}

async function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  const zip = new JSZip();

  async function addDir(current: string, zipPrefix = ""): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const zipName = path.posix.join(zipPrefix, entry.name);
      if (entry.isDirectory()) {
        await addDir(full, zipName);
      } else if (entry.isFile()) {
        zip.file(zipName, await fs.readFile(full));
      }
    }
  }

  await addDir(sourceDir);
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await ensureDir(path.dirname(zipPath));
  await fs.writeFile(zipPath, data);
}

function formatExportTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}
