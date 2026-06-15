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

export async function diffFiles(sourcePath: string, targetPath: string): Promise<DiffSummary> {
  if (!(await exists(targetPath))) {
    return { type: "missing_target", added: [], changed: [], removed: [], preview: "Target file does not exist." };
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
    return {
      type: "json",
      added,
      changed,
      removed,
      preview: `JSON diff: +${added.length} ~${changed.length} -${removed.length}`
    };
  } catch {
    return textDiff(sourceText, targetText);
  }
}

function textDiff(sourceText: string, targetText: string): DiffSummary {
  const sourceLines = new Set(sourceText.split(/\r?\n/));
  const targetLines = new Set(targetText.split(/\r?\n/));
  const added = [...sourceLines].filter((line) => line && !targetLines.has(line)).slice(0, 20);
  const removed = [...targetLines].filter((line) => line && !sourceLines.has(line)).slice(0, 20);
  return {
    type: "text",
    added,
    changed: [],
    removed,
    preview: `Text diff: +${added.length} -${removed.length}`
  };
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
