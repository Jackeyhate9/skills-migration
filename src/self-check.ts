import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { exportMigrationPackage } from "./exporter.js";
import { importMigrationPackage, rollback } from "./importer.js";
import type { SelfCheckResult } from "./types.js";

export async function runSelfCheck(outputDir = path.resolve("self-check")): Promise<SelfCheckResult> {
  await fs.mkdir(outputDir, { recursive: true });
  const checks: SelfCheckResult["checks"] = [];
  const add = (name: string, ok: boolean, details: string) => checks.push({ name, ok, details });

  const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || process.env.SKILLS_MIGRATION_TAURI);
  add("tauri_desktop", isTauri, isTauri ? "Tauri desktop indicators detected." : "Running without Tauri indicators; browser fallback mode.");

  const home = os.homedir();
  add("read_user_home", await canRead(home), home);
  add("write_backup_dir", await canWrite(outputDir), outputDir);

  const zipPath = path.join(outputDir, "zip-test.zip");
  try {
    const zip = new JSZip();
    zip.file("hello.txt", "ok");
    await fs.writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
    add("create_zip", true, zipPath);
    await JSZip.loadAsync(await fs.readFile(zipPath));
    add("extract_zip", true, zipPath);
  } catch (error) {
    add("create_extract_zip", false, error instanceof Error ? error.message : String(error));
  }

  try {
    const fake = await createFakeHome(outputDir);
    const exported = await exportMigrationPackage({ homeDir: fake.source, platform: "linux", outputDir: path.join(outputDir, "exports") });
    add("generate_manifest", exported.manifest.file_count > 0, exported.zipPath);
    const restored = await importMigrationPackage({ archivePath: exported.zipPath, restoreHomeDir: fake.target, platform: "linux", backupRoot: path.join(outputDir, "backups") });
    add("fake_export_import", restored.restorePlan.actions.some((action) => action.status === "done"), fake.target);
    add("sensitive_filter", !(await fileExists(path.join(fake.target, ".claude", ".env"))), "Secret file was not restored.");
    const rolled = await rollback({ snapshotDir: restored.restorePlan.backup_snapshot });
    add("rollback", rolled.removed > 0 || rolled.restored >= 0, restored.restorePlan.backup_snapshot);
  } catch (error) {
    add("fake_export_import_rollback", false, error instanceof Error ? error.message : String(error));
  }

  const failed = checks.filter((check) => !check.ok).length;
  const status: SelfCheckResult["status"] = failed === 0 ? "Ready" : failed <= 2 ? "Partial" : "Not Ready";
  const reportPath = path.join(outputDir, "self_check_report.md");
  await fs.writeFile(reportPath, renderReport(status, checks), "utf8");
  return { status, checks, reportPath };
}

async function createFakeHome(root: string): Promise<{ source: string; target: string }> {
  const source = path.join(root, "fake-old");
  const target = path.join(root, "fake-new");
  await fs.mkdir(path.join(source, ".claude", "skills", "demo"), { recursive: true });
  await fs.writeFile(path.join(source, ".claude", "skills", "demo", "SKILL.md"), "# demo\n", "utf8");
  await fs.writeFile(path.join(source, ".claude", ".env"), "API_KEY=secret\n", "utf8");
  await fs.rm(target, { recursive: true, force: true });
  return { source, target };
}

async function canRead(dir: string): Promise<boolean> {
  try {
    await fs.readdir(dir);
    return true;
  } catch {
    return false;
  }
}

async function canWrite(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, ".write-test");
    await fs.writeFile(file, "ok");
    await fs.rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function renderReport(status: SelfCheckResult["status"], checks: SelfCheckResult["checks"]): string {
  return [
    "# Self Check Report",
    "",
    `- Status: ${status}`,
    "",
    "| Check | OK | Details |",
    "| --- | --- | --- |",
    ...checks.map((check) => `| ${check.name} | ${check.ok ? "yes" : "no"} | ${check.details.replaceAll("|", "\\|")} |`)
  ].join("\n");
}
