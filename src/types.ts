export type AgentName =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "openclaw"
  | "hermes"
  | "gemini";

export type Category =
  | "skills"
  | "agents"
  | "commands"
  | "prompts"
  | "mcp_configs"
  | "settings"
  | "memories"
  | "sessions"
  | "secrets"
  | "unknown";

export type RiskLevel = "low" | "medium" | "high";

export type ConflictStrategy = "merge" | "skip" | "overwrite" | "rename";

export interface AgentRoot {
  agentName: AgentName;
  displayName: string;
  path: string;
  platform: NodeJS.Platform | "all";
}

export interface ScanEntry {
  id: string;
  agent_name: AgentName;
  category: Category;
  detected_paths: string[];
  relative_path: string;
  file_count: 1;
  size: number;
  checksum: string;
  target_restore_path: string;
  risk_level: RiskLevel;
  included: boolean;
  redacted_preview?: string;
  reason?: string;
}

export interface SecretFinding {
  agent_name: AgentName;
  path: string;
  category: Category;
  reason: string;
  redacted_preview?: string;
}

export interface ScanManifest {
  schema_version: "1.0.0";
  created_at: string;
  source_platform: NodeJS.Platform;
  source_home: string;
  include_sessions: boolean;
  include_secrets: boolean;
  entries: ScanEntry[];
  excluded_secrets: SecretFinding[];
  summary: {
    agents: Record<string, { file_count: number; size: number }>;
    total_files: number;
    included_files: number;
    total_size: number;
  };
}

export interface ExportManifestFile {
  id: string;
  agent_name: AgentName;
  category: Category;
  original_path: string;
  portable_target_path: string;
  relative_path: string;
  size: number;
  checksum: string;
  risk_level: RiskLevel;
}

export interface ExportManifest {
  export_version: "1.0.0";
  created_at: string;
  source_os: NodeJS.Platform;
  source_hostname: string;
  detected_agents: AgentName[];
  categories: Category[];
  file_count: number;
  total_size: number;
  checksums: Record<string, string>;
  files: ExportManifestFile[];
  skipped_sensitive_files: SecretFinding[];
}

export interface RestorePlanAction {
  id: string;
  agent_name: AgentName;
  category: Category;
  source_path: string;
  target_path: string;
  action: "create" | "merge" | "rename" | "skip" | "confirm" | "overwrite";
  status: "planned" | "done" | "skipped";
  reason?: string;
  backup_path?: string;
  checksum?: string;
}

export interface RestorePlan {
  created_at: string;
  source_export: string;
  target_os: NodeJS.Platform;
  target_home: string;
  backup_snapshot: string;
  actions: RestorePlanAction[];
}

export interface ScanOptions {
  homeDir?: string;
  appData?: string;
  localAppData?: string;
  platform?: NodeJS.Platform;
  includeSessions?: boolean;
  includeSecrets?: boolean;
}

export interface ExportOptions extends ScanOptions {
  outputDir: string;
  zipPath?: string;
}

export interface ImportOptions {
  archivePath: string;
  dryRun?: boolean;
  restoreHomeDir?: string;
  restoreAppData?: string;
  restoreLocalAppData?: string;
  platform?: NodeJS.Platform;
  backupRoot?: string;
  confirmSettings?: boolean;
}

export interface RollbackOptions {
  snapshotDir: string;
}
