#!/usr/bin/env node
import path from "node:path";
import { exportBackup } from "./exporter.js";
import { runImport, planImport } from "./importer.js";
import { scan } from "./scanner.js";
import { startServer } from "./server.js";
import type { ConflictStrategy } from "./types.js";

function argValue(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const [, , command = "help", ...args] = process.argv;

  if (command === "scan") {
    const manifest = await scan({
      includeSessions: hasFlag(args, "--include-sessions"),
      includeSecrets: hasFlag(args, "--include-secrets")
    });
    const out = argValue(args, "--out");
    const json = JSON.stringify(manifest, null, 2);
    if (out) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
      await fs.writeFile(out, json, "utf8");
      console.log(`Wrote manifest: ${path.resolve(out)}`);
    } else {
      console.log(json);
    }
    return;
  }

  if (command === "export" || command === "backup") {
    const outputDir = path.resolve(argValue(args, "--out", "backups/latest")!);
    const zipPath = argValue(args, "--zip", "outputs/export.zip");
    const result = await exportBackup({
      outputDir,
      zipPath: zipPath ? path.resolve(zipPath) : undefined,
      includeSessions: hasFlag(args, "--include-sessions"),
      includeSecrets: hasFlag(args, "--include-secrets")
    });
    console.log(`Exported ${result.manifest.summary.included_files} files to ${result.outputDir}`);
    if (result.zipPath) console.log(`Zip: ${result.zipPath}`);
    if (result.manifest.excluded_secrets.length > 0) {
      console.log(`Excluded sensitive files: ${result.manifest.excluded_secrets.length}`);
    }
    return;
  }

  if (command === "import" || command === "restore") {
    const archiveDir = path.resolve(argValue(args, "--from", "backups/latest")!);
    const strategy = (argValue(args, "--strategy", "skip") ?? "skip") as ConflictStrategy;
    const dryRun = hasFlag(args, "--dry-run") || hasFlag(args, "--preview");
    const restoreHomeDir = argValue(args, "--home");
    const result = dryRun
      ? await planImport({ archiveDir, strategy, dryRun, restoreHomeDir })
      : await runImport({ archiveDir, strategy, dryRun, restoreHomeDir });
    console.log(`${dryRun ? "Previewed" : "Restored"} ${result.actions.length} actions from ${archiveDir}`);
    console.table(result.actions.map((action) => ({
      action: action.action,
      status: action.status,
      target: action.target,
      reason: action.reason ?? ""
    })));
    if ("reportPath" in result) console.log(`Report: ${result.reportPath}`);
    return;
  }

  if (command === "web") {
    const port = Number(argValue(args, "--port", "5174"));
    await startServer(port);
    return;
  }

  printHelp();
}

function printHelp(): void {
  console.log(`AI Agent Skills Migrator

Usage:
  npm run cli -- scan [--out manifest.json] [--include-sessions] [--include-secrets]
  npm run cli -- backup [--out backups/latest] [--zip outputs/export.zip]
  npm run cli -- restore --from backups/latest [--preview] [--strategy skip|overwrite|rename] [--home C:\\Users\\you]
  npm run dev

Safety defaults:
  - sessions are skipped unless --include-sessions is set
  - secret-like files and API keys are excluded unless --include-secrets is set
  - import uses --strategy skip unless changed
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
