import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFileEnsuringDir, ensureDir, exists } from "./fs-utils.js";
import { exportMigrationPackage } from "./exporter.js";
import type { ExportOptions, ExportToFolderResult } from "./types.js";

const exec = promisify(execFile);

export async function exportToFolder(options: ExportOptions & { backupDir: string; gitCommit?: boolean }): Promise<ExportToFolderResult> {
  const backupDir = path.resolve(options.backupDir);
  const archiveDir = path.join(backupDir, "exports");
  await ensureDir(archiveDir);
  const exported = await exportMigrationPackage({ ...options, outputDir: archiveDir });
  const latestZip = path.join(backupDir, "latest.zip");
  const manifestLatest = path.join(backupDir, "manifest-latest.json");
  const historyPath = path.join(backupDir, "history.json");

  await copyFileEnsuringDir(exported.zipPath, latestZip);
  await fs.writeFile(manifestLatest, JSON.stringify(exported.manifest, null, 2), "utf8");
  const history = await readHistory(historyPath);
  history.unshift({
    created_at: exported.manifest.created_at,
    archive: path.relative(backupDir, exported.zipPath),
    latest_zip: "latest.zip",
    file_count: exported.manifest.file_count,
    total_size: exported.manifest.total_size
  });
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf8");

  let gitCommit: string | undefined;
  if (options.gitCommit && await exists(path.join(backupDir, ".git"))) {
    await exec("git", ["add", "latest.zip", "manifest-latest.json", "history.json", "exports"], { cwd: backupDir });
    await exec("git", ["commit", "-m", `Export skills migration ${exported.manifest.created_at}`], { cwd: backupDir }).catch(() => undefined);
    gitCommit = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: backupDir })).stdout.trim();
  }

  return {
    exportDir: exported.exportDir,
    archivePath: exported.zipPath,
    latestZip,
    manifestLatest,
    historyPath,
    gitCommit
  };
}

async function readHistory(historyPath: string): Promise<unknown[]> {
  try {
    return JSON.parse(await fs.readFile(historyPath, "utf8")) as unknown[];
  } catch {
    return [];
  }
}
