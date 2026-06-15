import type { ExportManifest, McpRuntimeServer, MigrationResultSummary, RestorePlan } from "./types.js";

export function buildMigrationResultSummary(
  manifest: ExportManifest,
  plan: RestorePlan,
  restoreReportPath: string,
  mcpServers: McpRuntimeServer[] = []
): MigrationResultSummary {
  return {
    migrated_files: plan.actions.filter((action) => action.status === "done").length,
    skipped_sensitive_files: manifest.skipped_sensitive_files.length,
    renamed_conflicts: plan.actions.filter((action) => action.action === "rename" || action.action === "rename_imported").length,
    config_pending_review: plan.actions.filter((action) => action.action === "confirm").length,
    config_merged: plan.actions.filter((action) => action.action === "merge" && action.status === "done").length,
    config_overwritten_after_backup: plan.actions.filter((action) => action.action === "backup_then_overwrite" && action.status === "done").length,
    mcp_ready: mcpServers.filter((server) => server.status === "ready").length,
    mcp_missing_runtime: mcpServers.filter((server) => server.status === "missing_runtime").length,
    mcp_missing_path: mcpServers.filter((server) => server.status === "missing_path").length,
    backup_snapshot_path: plan.backup_snapshot,
    rollback_available: true,
    restore_report_path: restoreReportPath
  };
}
