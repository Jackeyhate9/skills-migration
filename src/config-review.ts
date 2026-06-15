import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "./fs-utils.js";
import type { ConfigReviewItem, DiffSummary, RestorePlan, RestorePlanAction } from "./types.js";

const CONFIG_CATEGORIES = new Set(["settings", "mcp_configs", "unknown"]);

export async function buildConfigReview(plan: RestorePlan): Promise<ConfigReviewItem[]> {
  const items: ConfigReviewItem[] = [];
  for (const action of plan.actions) {
    if (!CONFIG_CATEGORIES.has(action.category)) continue;
    const targetExists = await exists(action.target_path);
    items.push({
      id: action.id,
      agent: action.agent_name,
      category: action.category,
      source_file: action.source_path,
      target_file: action.target_path,
      target_exists: targetExists,
      diff_summary: await diffFiles(action.source_path, action.target_path),
      recommended_action: recommendedAction(action, targetExists),
      selected_action: action.action === "confirm" ? undefined : normalizeAction(action.action)
    });
  }
  return items;
}

export async function applyConfigReviewChoices(
  plan: RestorePlan,
  choices: Record<string, ConfigReviewItem["recommended_action"]>
): Promise<RestorePlan> {
  const next: RestorePlan = { ...plan, actions: [...plan.actions] };
  for (const action of next.actions) {
    const choice = choices[action.id];
    if (!choice) continue;
    if (choice === "skip") {
      action.action = "skip";
      action.status = "skipped";
      action.reason = "User selected skip in Config Review.";
    } else if (choice === "backup_then_overwrite") {
      action.action = "backup_then_overwrite";
      action.status = "planned";
      action.reason = "User selected backup then overwrite in Config Review.";
    } else if (choice === "merge") {
      action.action = "merge";
      action.status = "planned";
      action.reason = "User selected merge in Config Review.";
    } else {
      action.action = "rename_imported";
      action.status = "planned";
      action.target_path = await importedPath(action.target_path);
      action.reason = "User selected rename imported in Config Review.";
    }
  }
  return next;
}

export async function writeConfigDiffReport(items: ConfigReviewItem[], outputDir: string): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "config_diff_report.md");
  const lines = [
    "# Config Diff Report",
    "",
    `- Created at: ${new Date().toISOString()}`,
    `- Items: ${items.length}`,
    "",
    "| Agent | Category | Target exists | Recommended | Source | Target | Summary |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...items.map((item) => [
      item.agent,
      item.category,
      String(item.target_exists),
      item.recommended_action,
      `\`${escapeCell(item.source_file)}\``,
      `\`${escapeCell(item.target_file)}\``,
      escapeCell(item.diff_summary.preview)
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Details",
    "",
    ...items.flatMap((item) => [
      `### ${item.agent} / ${item.category}`,
      "",
      `- Source: \`${item.source_file}\``,
      `- Target: \`${item.target_file}\``,
      `- Target exists: ${item.target_exists}`,
      `- Recommended action: ${item.recommended_action}`,
      `- Summary: ${item.diff_summary.preview}`,
      item.diff_summary.type === "json"
        ? `- Added keys: ${item.diff_summary.added.join(", ") || "none"}\n- Removed keys: ${item.diff_summary.removed.join(", ") || "none"}\n- Changed keys: ${item.diff_summary.changed.join(", ") || "none"}\n- Conflict keys: ${item.diff_summary.conflicts?.join(", ") || "none"}`
        : `- Added lines: ${item.diff_summary.added_line_count ?? item.diff_summary.added.length}\n- Removed lines: ${item.diff_summary.removed_line_count ?? item.diff_summary.removed.length}\n- Changed lines: ${item.diff_summary.changed_line_count ?? item.diff_summary.changed.length}`,
      ""
    ])
  ];
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

export async function diffFiles(sourcePath: string, targetPath: string): Promise<DiffSummary> {
  if (!(await exists(targetPath))) {
    return { type: "missing_target", added: [], changed: [], removed: [], conflicts: [], preview: "Target file does not exist." };
  }
  const source = await fs.readFile(sourcePath, "utf8").catch(() => "");
  const target = await fs.readFile(targetPath, "utf8").catch(() => "");
  if (isJson(sourcePath) && isJson(targetPath)) {
    return jsonDiff(source, target);
  }
  return textDiff(source, target);
}

function jsonDiff(sourceText: string, targetText: string): DiffSummary {
  try {
    const source = flattenJson(JSON.parse(sourceText));
    const target = flattenJson(JSON.parse(targetText));
    const added = Object.keys(source).filter((key) => !(key in target)).sort();
    const removed = Object.keys(target).filter((key) => !(key in source)).sort();
    const changed = Object.keys(source).filter((key) => key in target && JSON.stringify(source[key]) !== JSON.stringify(target[key])).sort();
    const conflicts = changed.filter((key) => key in target && key in source);
    return {
      type: "json",
      added,
      changed,
      removed,
      conflicts,
      preview: `JSON diff: added keys ${added.length}, removed keys ${removed.length}, changed keys ${changed.length}, conflict keys ${conflicts.length}`
    };
  } catch {
    return textDiff(sourceText, targetText);
  }
}

function textDiff(sourceText: string, targetText: string): DiffSummary {
  const sourceLines = new Set(sourceText.split(/\r?\n/));
  const targetLines = new Set(targetText.split(/\r?\n/));
  const allAdded = [...sourceLines].filter((line) => line && !targetLines.has(line));
  const allRemoved = [...targetLines].filter((line) => line && !sourceLines.has(line));
  const changedLineCount = Math.min(allAdded.length, allRemoved.length);
  const added = allAdded.slice(0, 20);
  const removed = allRemoved.slice(0, 20);
  return {
    type: "text",
    added,
    changed: [],
    removed,
    added_line_count: allAdded.length,
    removed_line_count: allRemoved.length,
    changed_line_count: changedLineCount,
    preview: `Text diff: changed lines ${changedLineCount}, added lines ${allAdded.length}, removed lines ${allRemoved.length}`
  };
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function flattenJson(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function recommendedAction(action: RestorePlanAction, targetExists: boolean): ConfigReviewItem["recommended_action"] {
  if (!targetExists) return "backup_then_overwrite";
  if (isJson(action.source_path) && isJson(action.target_path)) return "merge";
  if (action.category === "settings" || action.category === "unknown") return "skip";
  return "rename_imported";
}

function normalizeAction(action: RestorePlanAction["action"]): ConfigReviewItem["recommended_action"] | undefined {
  if (action === "merge" || action === "skip" || action === "backup_then_overwrite" || action === "rename_imported") return action;
  if (action === "overwrite") return "backup_then_overwrite";
  if (action === "rename") return "rename_imported";
  return undefined;
}

function isJson(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".json";
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
