import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { exportBackup } from "../src/exporter.js";
import { planImport, runImport } from "../src/importer.js";
import { scan } from "../src/scanner.js";

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skills-migrator-"));
  const sourceHome = path.join(tmp, "source");
  const targetHome = path.join(tmp, "target");
  const archiveDir = path.join(tmp, "archive");
  const zipPath = path.join(tmp, "export.zip");

  await fs.mkdir(path.join(sourceHome, ".claude", "skills", "reviewer"), { recursive: true });
  await fs.mkdir(path.join(sourceHome, ".codex", "memories"), { recursive: true });
  await fs.mkdir(path.join(sourceHome, ".agents", "skills", "openclaw-demo"), { recursive: true });
  await fs.writeFile(path.join(sourceHome, ".claude", "skills", "reviewer", "SKILL.md"), "# Reviewer\n", "utf8");
  await fs.writeFile(path.join(sourceHome, ".claude", ".env"), "OPENAI_API_KEY=sk-testsecretvalue1234567890\n", "utf8");
  await fs.writeFile(path.join(sourceHome, ".codex", "memories", "MEMORY.md"), "remember this\n", "utf8");
  await fs.writeFile(path.join(sourceHome, ".agents", "skills", "openclaw-demo", "SKILL.md"), "# OpenClaw Demo\n", "utf8");

  const manifest = await scan({ homeDir: sourceHome, platform: "win32" });
  assert.equal(manifest.summary.total_files, 4);
  assert.equal(manifest.summary.included_files, 3);
  assert.equal(manifest.excluded_secrets.length, 1);

  await exportBackup({ homeDir: sourceHome, platform: "win32", outputDir: archiveDir, zipPath });
  const preview = await planImport({ archiveDir, dryRun: true, restoreHomeDir: targetHome });
  assert.equal(preview.actions.length, 3);
  assert(preview.actions.every((action) => action.target.startsWith(targetHome)));

  const restored = await runImport({ archiveDir, restoreHomeDir: targetHome, strategy: "skip" });
  assert.equal(restored.actions.filter((action) => action.status === "done").length, 3);
  assert.equal(
    await fs.readFile(path.join(targetHome, ".claude", "skills", "reviewer", "SKILL.md"), "utf8"),
    "# Reviewer\n"
  );
  assert.equal(await fileExists(path.join(targetHome, ".claude", ".env")), false);
  assert.equal(await fs.readFile(path.join(targetHome, ".agents", "skills", "openclaw-demo", "SKILL.md"), "utf8"), "# OpenClaw Demo\n");

  console.log(`Smoke test passed: ${tmp}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
