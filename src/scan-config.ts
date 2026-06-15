import os from "node:os";
import path from "node:path";
import { looksLikeMcpConfig } from "./mcp.js";
import type { AgentName, AgentRoot, Category, RiskLevel, ScanOptions } from "./types.js";

export const WINDOWS_SCAN_PATHS: Array<{ agentName: AgentName; displayName: string; template: string }> = [
  { agentName: "claude", displayName: "Claude Code", template: "%USERPROFILE%\\.claude" },
  { agentName: "codex", displayName: "Codex", template: "%USERPROFILE%\\.codex" },
  { agentName: "openclaw", displayName: "OpenClaw", template: "%USERPROFILE%\\.agents" },
  { agentName: "cursor", displayName: "Cursor", template: "%USERPROFILE%\\.cursor" },
  { agentName: "opencode", displayName: "opencode", template: "%APPDATA%\\opencode" },
  { agentName: "opencode", displayName: "opencode", template: "%LOCALAPPDATA%\\opencode" },
  { agentName: "opencode", displayName: "opencode", template: "%USERPROFILE%\\.config\\opencode" },
  { agentName: "hermes", displayName: "Hermes", template: "%USERPROFILE%\\.hermes" },
  { agentName: "gemini", displayName: "Gemini CLI", template: "%USERPROFILE%\\.gemini" }
];

export const POSIX_SCAN_PATHS: Array<{ agentName: AgentName; displayName: string; template: string }> = [
  { agentName: "claude", displayName: "Claude Code", template: "~/.claude" },
  { agentName: "codex", displayName: "Codex", template: "~/.codex" },
  { agentName: "openclaw", displayName: "OpenClaw", template: "~/.agents" },
  { agentName: "cursor", displayName: "Cursor", template: "~/.cursor" },
  { agentName: "opencode", displayName: "opencode", template: "~/.config/opencode" },
  { agentName: "hermes", displayName: "Hermes", template: "~/.hermes" },
  { agentName: "gemini", displayName: "Gemini CLI", template: "~/.gemini" }
];

export const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "Cache",
  "GPUCache",
  "logs",
  "tmp",
  "temp"
]);

export const SECRET_FILE_PATTERNS = [
  /\.env(\..*)?$/i,
  /secret/i,
  /token/i,
  /credential/i,
  /apikey/i,
  /api[-_]?key/i,
  /keyring/i
];

export const SECRET_CONTENT_PATTERNS = [
  /\b(api[_-]?key|token|secret|password|authorization|bearer)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{12,})/i,
  /\b(sk-[A-Za-z0-9]{20,})\b/,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/,
  /\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/
];

export function resolveTemplate(template: string, options: ScanOptions = {}): string {
  const homeDir = options.homeDir ?? os.homedir();
  const useSyntheticWindowsProfile = options.homeDir !== undefined;
  const appData = options.appData ??
    (useSyntheticWindowsProfile ? path.join(homeDir, "AppData", "Roaming") : process.env.APPDATA) ??
    path.join(homeDir, "AppData", "Roaming");
  const localAppData = options.localAppData ??
    (useSyntheticWindowsProfile ? path.join(homeDir, "AppData", "Local") : process.env.LOCALAPPDATA) ??
    path.join(homeDir, "AppData", "Local");

  return template
    .replace(/^~(?=$|[\\/])/, homeDir)
    .replaceAll("%USERPROFILE%", homeDir)
    .replaceAll("%APPDATA%", appData)
    .replaceAll("%LOCALAPPDATA%", localAppData);
}

export function getAgentRoots(options: ScanOptions = {}): AgentRoot[] {
  const platform = options.platform ?? process.platform;
  const templates = platform === "win32" ? WINDOWS_SCAN_PATHS : POSIX_SCAN_PATHS;
  return templates.map((candidate) => ({
    ...candidate,
    platform,
    path: path.resolve(resolveTemplate(candidate.template, options))
  }));
}

export function getRestoreRoot(agentName: AgentName, options: ScanOptions = {}): string {
  const roots = getAgentRoots(options).filter((root) => root.agentName === agentName);
  return roots[0]?.path ?? path.join(options.homeDir ?? os.homedir(), `.${agentName}`);
}

export function inferCategory(filePath: string, contentSample = ""): Category {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const name = path.basename(normalized);

  if (isSecretLike(filePath, contentSample)) return "secrets";
  if (normalized.includes("/skills/") || normalized.includes("/skill/")) return "skills";
  if (normalized.includes("/agents/") || normalized.includes("/agent/")) return "agents";
  if (normalized.includes("/commands/") || normalized.includes("/command/")) return "commands";
  if (normalized.includes("/prompts/") || normalized.includes("/prompt/")) return "prompts";
  if (normalized.includes("/memories/") || normalized.includes("/memory/") || name === "memory.md") return "memories";
  if (normalized.includes("/sessions/") || normalized.includes("/session/") || normalized.includes("/conversations/")) return "sessions";
  if (looksLikeMcpConfig(filePath, contentSample)) return "mcp_configs";
  if (["settings.json", "config.json", "config.toml", "settings.toml", "preferences.json"].includes(name)) return "settings";
  if (/\.(md|mdx|prompt|txt)$/i.test(name)) return "prompts";
  return "unknown";
}

export function riskFor(category: Category, filePath: string, contentSample = ""): RiskLevel {
  if (category === "secrets" || isSecretLike(filePath, contentSample)) return "high";
  if (category === "mcp_configs" || category === "settings" || category === "sessions") return "medium";
  return "low";
}

export function isSecretLike(filePath: string, contentSample = ""): boolean {
  const name = path.basename(filePath);
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name)) ||
    SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(contentSample));
}

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const visible = match.slice(0, Math.min(10, match.length));
      return `${visible}...[REDACTED]`;
    });
  }
  return redacted;
}
