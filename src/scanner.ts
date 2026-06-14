import fs from "node:fs/promises";
import path from "node:path";
import { getAgentRoots, getRestoreRoot, inferCategory, redactSecrets, riskFor, SKIP_DIR_NAMES } from "./scan-config.js";
import { checksumFile, exists, portableId, readTextSample, safeRelative } from "./fs-utils.js";
import type { AgentRoot, Manifest, ManifestEntry, ScanOptions, SecretFinding } from "./types.js";

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

async function scanRoot(root: AgentRoot, options: ScanOptions): Promise<{ entries: ManifestEntry[]; secrets: SecretFinding[] }> {
  const entries: ManifestEntry[] = [];
  const secrets: SecretFinding[] = [];
  if (!(await exists(root.path))) return { entries, secrets };

  for await (const filePath of walkFiles(root.path)) {
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat) continue;
    const sample = await readTextSample(filePath).catch(() => "");
    const category = inferCategory(filePath, sample);
    if (category === "sessions" && !options.includeSessions) continue;

    const risk = riskFor(category, filePath, sample);
    const relativePath = safeRelative(root.path, filePath);
    const targetRestorePath = path.join(getRestoreRoot(root.agentName, options), relativePath);
    const isSecret = category === "secrets" || risk === "high";
    const included = !isSecret || options.includeSecrets === true;
    const checksum = await checksumFile(filePath).catch(() => undefined);
    if (!checksum) continue;
    const id = portableId(`${root.agentName}:${root.path}:${relativePath}`);
    const redactedPreview = isSecret ? redactSecrets(sample.slice(0, 500)) : undefined;

    const manifestEntry: ManifestEntry = {
      id,
      agent_name: root.agentName,
      category,
      detected_paths: [filePath],
      relative_path: relativePath,
      file_count: 1,
      size: stat.size,
      checksum,
      target_restore_path: targetRestorePath,
      risk_level: risk,
      included,
      redacted_preview: redactedPreview,
      reason: included ? undefined : "Sensitive file or secret-like content detected; excluded by default."
    };

    entries.push(manifestEntry);
    if (isSecret && !options.includeSecrets) {
      secrets.push({
        agent_name: root.agentName,
        path: filePath,
        category,
        reason: manifestEntry.reason ?? "Sensitive content detected.",
        redacted_preview: redactedPreview
      });
    }
  }

  return { entries, secrets };
}

export async function scan(options: ScanOptions = {}): Promise<Manifest> {
  const roots = getAgentRoots(options);
  const allEntries: ManifestEntry[] = [];
  const excludedSecrets: SecretFinding[] = [];

  for (const root of roots) {
    const result = await scanRoot(root, options);
    allEntries.push(...result.entries);
    excludedSecrets.push(...result.secrets);
  }

  const summary = allEntries.reduce<Manifest["summary"]>(
    (acc, entry) => {
      const agent = acc.agents[entry.agent_name] ?? { file_count: 0, size: 0 };
      agent.file_count += 1;
      agent.size += entry.size;
      acc.agents[entry.agent_name] = agent;
      acc.total_files += 1;
      acc.total_size += entry.size;
      if (entry.included) acc.included_files += 1;
      return acc;
    },
    { agents: {}, total_files: 0, included_files: 0, total_size: 0 }
  );

  return {
    schema_version: "1.0.0",
    created_at: new Date().toISOString(),
    source_platform: options.platform ?? process.platform,
    source_home: options.homeDir ?? process.env.USERPROFILE ?? process.env.HOME ?? "",
    include_sessions: options.includeSessions === true,
    include_secrets: options.includeSecrets === true,
    entries: allEntries,
    excluded_secrets: excludedSecrets,
    summary
  };
}
