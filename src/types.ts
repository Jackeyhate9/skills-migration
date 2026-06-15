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

export type ConflictStrategy = "skip" | "overwrite" | "rename";

export interface AgentRoot {
  agentName: AgentName;
  displayName: string;
  path: string;
  platform: NodeJS.Platform | "all";
}

export interface ManifestEntry {
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
  mcp?: McpAnalysis;
  migration_notes?: string[];
  redacted_preview?: string;
  reason?: string;
}

export interface McpServerRef {
  name: string;
  command?: string;
  cwd?: string;
  has_env?: boolean;
  machine_bound_hints: string[];
}

export interface McpAnalysis {
  server_count: number;
  servers: McpServerRef[];
  warnings: string[];
}

export interface SecretFinding {
  agent_name: AgentName;
  path: string;
  category: Category;
  reason: string;
  redacted_preview?: string;
}

export interface Manifest {
  schema_version: "1.0.0";
  created_at: string;
  source_platform: NodeJS.Platform;
  source_home: string;
  source_machine: MachineProfile;
  include_sessions: boolean;
  include_secrets: boolean;
  entries: ManifestEntry[];
  excluded_secrets: SecretFinding[];
  summary: {
    agents: Record<string, { file_count: number; size: number }>;
    total_files: number;
    included_files: number;
    total_size: number;
  };
}

export interface MachineProfile {
  machine_id: string;
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  username: string;
  home_dir: string;
  generated_at: string;
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
  archiveDir: string;
  dryRun?: boolean;
  strategy?: ConflictStrategy;
  restoreHomeDir?: string;
  restoreAppData?: string;
  restoreLocalAppData?: string;
  platform?: NodeJS.Platform;
}

export interface RestoreAction {
  entry_id: string;
  source: string;
  target: string;
  action: "create" | "overwrite" | "skip" | "rename";
  status: "planned" | "done" | "skipped";
  reason?: string;
}
