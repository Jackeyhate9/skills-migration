import fs from "node:fs/promises";
import path from "node:path";
import { copyFileEnsuringDir, ensureDir, exists, timestampSlug } from "./fs-utils.js";
import type { ConflictStrategy, ImportOptions, Manifest, RestoreAction } from "./types.js";

export async function readManifest(archiveDir: string): Promise<Manifest> {
  const manifestPath = path.join(archiveDir, "manifest.json");
  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
}

export async function planImport(options: ImportOptions): Promise<{ manifest: Manifest; actions: RestoreAction[]; snapshotDir: string }> {
  const manifest = await readManifest(options.archiveDir);
  const strategy: ConflictStrategy = options.strategy ?? "skip";
  const snapshotDir = path.join(options.archiveDir, "restore-snapshots", timestampSlug());
  const actions: RestoreAction[] = [];

  for (const entry of manifest.entries) {
    if (!entry.included) continue;
    const source = path.join(options.archiveDir, "files", entry.id, entry.relative_path);
    let target = entry.target_restore_path;
    if (options.restoreHomeDir) {
      target = target.replace(manifest.source_home, options.restoreHomeDir);
    }

    const targetExists = await exists(target);
    if (!targetExists) {
      actions.push({ entry_id: entry.id, source, target, action: "create", status: "planned" });
    } else if (strategy === "skip") {
      actions.push({ entry_id: entry.id, source, target, action: "skip", status: "planned", reason: "Target exists." });
    } else if (strategy === "overwrite") {
      actions.push({ entry_id: entry.id, source, target, action: "overwrite", status: "planned" });
    } else {
      actions.push({ entry_id: entry.id, source, target: await renamedPath(target), action: "rename", status: "planned" });
    }
  }

  return { manifest, actions, snapshotDir };
}

export async function runImport(options: ImportOptions): Promise<{ manifest: Manifest; actions: RestoreAction[]; reportPath: string; snapshotDir: string }> {
  const planned = await planImport(options);
  const actions: RestoreAction[] = [];
  const dryRun = options.dryRun === true;

  if (!dryRun) {
    await ensureDir(planned.snapshotDir);
  }

  for (const action of planned.actions) {
    const next = { ...action };
    if (action.action === "skip") {
      next.status = "skipped";
      actions.push(next);
      continue;
    }

    if (!dryRun) {
      if (action.action === "overwrite" && await exists(action.target)) {
        const snapshotTarget = path.join(planned.snapshotDir, action.entry_id, path.basename(action.target));
        await copyFileEnsuringDir(action.target, snapshotTarget);
      }
      await copyFileEnsuringDir(action.source, action.target);
      next.status = "done";
    }
    actions.push(next);
  }

  const reportPath = path.join(options.archiveDir, "restore_report.md");
  await writeRestoreReport(reportPath, planned.manifest, actions, dryRun, planned.snapshotDir);
  return { manifest: planned.manifest, actions, reportPath, snapshotDir: planned.snapshotDir };
}

async function renamedPath(target: string): Promise<string> {
  const parsed = path.parse(target);
  let index = 1;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}.migrated-${index}${parsed.ext}`);
    if (!(await exists(candidate))) return candidate;
    index += 1;
  }
}

async function writeRestoreReport(
  reportPath: string,
  manifest: Manifest,
  actions: RestoreAction[],
  dryRun: boolean,
  snapshotDir: string
): Promise<void> {
  const lines = [
    "# Restore Report",
    "",
    `- Mode: ${dryRun ? "preview" : "restore"}`,
    `- Manifest created: ${manifest.created_at}`,
    `- Files considered: ${actions.length}`,
    `- Backup snapshot: ${snapshotDir}`,
    "",
    "## Actions",
    "",
    "| Action | Status | Target | Reason |",
    "| --- | --- | --- | --- |",
    ...actions.map((action) =>
      `| ${action.action} | ${action.status} | \`${action.target.replaceAll("|", "\\|")}\` | ${action.reason ?? ""} |`
    )
  ];
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
}
