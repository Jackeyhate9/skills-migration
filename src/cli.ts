#!/usr/bin/env node
import path from "node:path";
import { exportToFolder } from "./export-to-folder.js";
import { exportMigrationPackage } from "./exporter.js";
import { importMigrationPackage, planImport, rollback } from "./importer.js";
import { scan } from "./scanner.js";
import { startServer } from "./server.js";

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
    const outputDir = path.resolve(argValue(args, "--output", argValue(args, "--out", "exports"))!);
    const result = await exportMigrationPackage({
      outputDir,
      includeSessions: hasFlag(args, "--include-sessions"),
      includeSecrets: hasFlag(args, "--include-secrets")
    });
    console.log(`Exported ${result.manifest.file_count} files`);
    console.log(`Directory: ${result.exportDir}`);
    console.log(`Zip: ${result.zipPath}`);
    console.log(`Report: ${result.reportPath}`);
    if (result.manifest.skipped_sensitive_files.length > 0) {
      console.log(`Skipped sensitive files: ${result.manifest.skipped_sensitive_files.length}`);
    }
    return;
  }

  if (command === "export-folder") {
    const backupDir = path.resolve(argValue(args, "--dir", argValue(args, "--output", "local-backup"))!);
    const result = await exportToFolder({
      backupDir,
      outputDir: backupDir,
      gitCommit: hasFlag(args, "--git-commit"),
      includeSessions: hasFlag(args, "--include-sessions"),
      includeSecrets: hasFlag(args, "--include-secrets")
    });
    console.log(`Exported to folder: ${backupDir}`);
    console.log(`Latest zip: ${result.latestZip}`);
    console.log(`Manifest latest: ${result.manifestLatest}`);
    console.log(`History: ${result.historyPath}`);
    if (result.gitCommit) console.log(`Git commit: ${result.gitCommit}`);
    return;
  }

  if (command === "import" || command === "restore") {
    const archivePath = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? argValue(args, "--from", "backups/latest")!);
    const dryRun = hasFlag(args, "--dry-run") || hasFlag(args, "--preview");
    const restoreHomeDir = argValue(args, "--home");
    const confirmSettings = hasFlag(args, "--confirm-settings");

    if (dryRun) {
      const result = await planImport({ archivePath, dryRun, restoreHomeDir, confirmSettings });
      console.log(`Previewed ${result.actions.length} actions from ${archivePath}`);
      printActionTable(result.actions);
    } else {
      const result = await importMigrationPackage({ archivePath, dryRun, restoreHomeDir, confirmSettings });
      console.log(`Restored ${result.restorePlan.actions.length} actions from ${archivePath}`);
      printActionTable(result.restorePlan.actions);
      console.log(`Restore plan: ${result.restorePlanPath}`);
      console.log(`Report: ${result.restoreReportPath}`);
    }
    return;
  }

  if (command === "rollback") {
    const snapshotDir = path.resolve(argValue(args, "--snapshot", "")!);
    if (!snapshotDir) throw new Error("Missing --snapshot backups/YYYYMMDD-HHMMSS-before-restore");
    const result = await rollback({ snapshotDir });
    console.log(`Rollback complete. Restored=${result.restored} Removed=${result.removed}`);
    console.log(`Report: ${result.reportPath}`);
    return;
  }

  if (command === "web") {
    const port = Number(argValue(args, "--port", "5174"));
    await startServer(port);
    return;
  }

  if (command === "features") {
    printFeatures();
    return;
  }

  printHelp();
}

function printActionTable(actions: Array<{ action: string; status: string; target_path: string; reason?: string }>): void {
  console.table(actions.map((action) => ({
    action: action.action,
    status: action.status,
    target: action.target_path,
    reason: action.reason ?? ""
  })));
}

function printHelp(): void {
  console.log(`Skills Migration

Usage:
  skills-migration.exe features
  skills-migration.exe web [--port 5174]
  skills-migration.exe scan [--out manifest.json] [--include-sessions] [--include-secrets]
  skills-migration.exe export --output ./exports
  skills-migration.exe export-folder --dir ./local-backup [--git-commit]
  skills-migration.exe import ./exports/agent-skills-export-YYYYMMDD-HHMMSS.zip [--preview] [--home C:\\Users\\you]
  skills-migration.exe rollback --snapshot backups/YYYYMMDD-HHMMSS-before-restore

Basic features:
  - Detect Codex, OpenClaw, Claude Code, opencode, Hermes, Cursor, Gemini CLI
  - Migrate skills, agents, commands, prompts, settings, memories
  - Build a portable zip migration package and restore it on another machine
  - Exclude secrets/API keys by default
  - Create restore snapshots before writing files
`);
}

function printFeatures(): void {
  console.log(`Skills Migration Features

Supported agents:
  - Codex: .codex
  - OpenClaw: .agents
  - Claude Code: .claude
  - opencode: AppData/opencode, .config/opencode
  - Hermes: .hermes
  - Cursor: .cursor
  - Gemini CLI: .gemini

Portable content:
  - skills / agents / commands / prompts
  - settings / memories
  - sessions are optional
  - MCP/config files are treated as ordinary config files, not product-level MCP migration

Cross-machine flow:
  - export creates agent-skills-export-YYYYMMDD-HHMMSS.zip
  - import validates manifest and checksums
  - import creates backups/YYYYMMDD-HHMMSS-before-restore before writing
  - conflicting files are renamed to *_imported
  - .env, tokens, keys, and secret-like files are skipped by default

Commands:
  skills-migration.exe export --output ./exports
  skills-migration.exe import ./exports/agent-skills-export-YYYYMMDD-HHMMSS.zip --preview
  skills-migration.exe import ./exports/agent-skills-export-YYYYMMDD-HHMMSS.zip
  skills-migration.exe rollback --snapshot backups/YYYYMMDD-HHMMSS-before-restore
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
