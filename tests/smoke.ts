import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { exportMigrationPackage } from "../src/exporter.js";
import { importMigrationPackage, rollback } from "../src/importer.js";
import { scan } from "../src/scanner.js";

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

  const scanManifest = await scan({ homeDir: sourceHome, platform: "linux" });
  assert(scanManifest.entries.some((entry) => entry.agent_name === "opencode" && entry.category === "skills"));
  assert(scanManifest.entries.some((entry) => entry.agent_name === "hermes" && entry.category === "prompts"));

  const exported = await exportMigrationPackage({ homeDir: sourceHome, platform: "linux", outputDir: exportsDir });
  assert.equal(await fileExists(exported.zipPath), true);
  assert.equal(exported.manifest.skipped_sensitive_files.length, 2);
  assert(exported.manifest.files.some((file) => file.portable_target_path.startsWith("agents/claude/")));

  await fs.rm(targetHome, { recursive: true, force: true });
  await fs.mkdir(path.join(targetHome, ".claude", "skills", "claude-skill"), { recursive: true });
  const existingSkill = path.join(targetHome, ".claude", "skills", "claude-skill", "SKILL.md");
  await fs.writeFile(existingSkill, "# Existing Claude Skill\n", "utf8");

  const restored = await importMigrationPackage({
    archivePath: exported.zipPath,
    restoreHomeDir: targetHome,
    platform: "linux",
    backupRoot
  });

  assert.equal(await fs.readFile(existingSkill, "utf8"), "# Existing Claude Skill\n");
  assert.equal(await fs.readFile(path.join(targetHome, ".claude", "skills", "claude-skill", "SKILL_imported.md"), "utf8"), "# claude-skill\n");
  assert.equal(await fs.readFile(path.join(targetHome, ".config", "opencode", "skills", "opencode-skill", "SKILL.md"), "utf8"), "# opencode-skill\n");
  assert.equal(await fs.readFile(path.join(targetHome, ".hermes", "prompts", "default.prompt"), "utf8"), "Prompt for hermes-skill\n");
  assert.equal(await fileExists(path.join(targetHome, ".claude", ".env")), false);
  assert.equal(await fileExists(path.join(targetHome, ".codex", "token.json")), false);
  assert(restored.restorePlan.actions.some((action) => action.action === "rename" && action.target_path.endsWith("SKILL_imported.md")));

  await rollback({ snapshotDir: restored.restorePlan.backup_snapshot });
  assert.equal(await fs.readFile(existingSkill, "utf8"), "# Existing Claude Skill\n");
  assert.equal(await fileExists(path.join(targetHome, ".claude", "skills", "claude-skill", "SKILL_imported.md")), false);
  assert.equal(await fileExists(path.join(targetHome, ".config", "opencode", "skills", "opencode-skill", "SKILL.md")), false);

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
