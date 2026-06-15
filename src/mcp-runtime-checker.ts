import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "./fs-utils.js";
import type { ExportManifest, McpRuntimeServer } from "./types.js";

const KNOWN_RUNTIMES = new Set(["node", "npx", "npm", "pnpm", "bun", "python", "python3", "uv", "uvx", "docker"]);
const SECRET_ENV_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD)/i;
const LOCAL_PATH_PATTERN = /^(?:[A-Za-z]:\\|\/|~[\\/])/;

export async function checkMcpRuntimes(exportDir: string, manifest: ExportManifest): Promise<{ servers: McpRuntimeServer[]; reportPath: string }> {
  const servers: McpRuntimeServer[] = [];
  for (const file of manifest.files.filter((entry) => entry.category === "mcp_configs")) {
    const sourcePath = path.join(exportDir, file.portable_target_path);
    const parsed = parseMcpConfig(await fs.readFile(sourcePath, "utf8").catch(() => ""));
    for (const server of parsed) {
      const runtimeStatus = await runtimeStatusFor(server.command);
      const missingPaths = await missingLocalPaths(server.args);
      const secretEnv = server.env_keys.filter((key) => SECRET_ENV_PATTERN.test(key));
      const status = chooseStatus(runtimeStatus, missingPaths, secretEnv);
      servers.push({
        agent: file.agent_name,
        source_file: sourcePath,
        server_name: server.name,
        command: server.command,
        args: server.args,
        env_keys: server.env_keys,
        status,
        details: [
          ...runtimeStatus.details,
          ...missingPaths.map((item) => `missing path: ${item}`),
          ...secretEnv.map((item) => `secret-like env key skipped: ${item}`)
        ],
        suggestions: suggestionsFor(server.command, missingPaths, secretEnv)
      });
    }
  }
  const reportPath = path.join(exportDir, "mcp_runtime_report.md");
  await fs.writeFile(reportPath, renderReport(servers), "utf8");
  return { servers, reportPath };
}

export function parseMcpConfig(text: string): Array<{ name: string; command?: string; args: string[]; env_keys: string[] }> {
  const parsed = safeJson(text);
  if (!parsed || typeof parsed !== "object") return [];
  const serversObject = findServersObject(parsed);
  if (!serversObject) return [];
  return Object.entries(serversObject).map(([name, value]) => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      name,
      command: typeof record.command === "string" ? record.command : undefined,
      args: Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === "string") : [],
      env_keys: record.env && typeof record.env === "object" ? Object.keys(record.env as Record<string, unknown>) : []
    };
  });
}

async function runtimeStatusFor(command: string | undefined): Promise<{ ok: boolean | undefined; details: string[] }> {
  if (!command) return { ok: undefined, details: ["unknown command"] };
  const executable = path.basename(command).replace(/\.(cmd|exe|bat)$/i, "");
  if (!KNOWN_RUNTIMES.has(executable)) return { ok: undefined, details: [`unknown runtime: ${command}`] };
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      if (await exists(path.join(dir, `${executable}${ext}`))) return { ok: true, details: [`runtime found: ${executable}`] };
    }
  }
  return { ok: false, details: [`missing runtime: ${executable}`] };
}

async function missingLocalPaths(args: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const arg of args) {
    if (LOCAL_PATH_PATTERN.test(arg) && !(await exists(arg.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE ?? process.env.HOME ?? "")))) {
      missing.push(arg);
    }
  }
  return missing;
}

function chooseStatus(
  runtimeStatus: { ok: boolean | undefined },
  missingPaths: string[],
  secretEnv: string[]
): McpRuntimeServer["status"] {
  if (runtimeStatus.ok === false) return "missing_runtime";
  if (missingPaths.length > 0) return "missing_path";
  if (secretEnv.length > 0) return "skipped_secret_env";
  if (runtimeStatus.ok === undefined) return "unknown";
  return "ready";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function findServersObject(parsed: unknown): Record<string, unknown> | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const direct = record.mcpServers ?? record.mcp_servers;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as Record<string, unknown>;
  for (const value of Object.values(record)) {
    const nested = findServersObject(value);
    if (nested) return nested;
  }
  return undefined;
}

function renderReport(servers: McpRuntimeServer[]): string {
  return [
    "# MCP Runtime Report",
    "",
    "| Status | Agent | Server | Command | Args | Env keys | Details | Suggestions |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...servers.map((server) =>
      `| ${server.status} | ${server.agent} | ${server.server_name} | ${server.command ?? ""} | ${server.args.join(" ")} | ${server.env_keys.join(", ")} | ${server.details.join("; ")} | ${server.suggestions.join("; ")} |`
    )
  ].join("\n");
}

function suggestionsFor(command: string | undefined, missingPaths: string[], secretEnv: string[]): string[] {
  const suggestions: string[] = [];
  const executable = command ? path.basename(command).replace(/\.(cmd|exe|bat)$/i, "") : "";
  if (["node", "npm", "npx"].includes(executable)) suggestions.push("Install Node.js LTS: https://nodejs.org/");
  if (["uv", "uvx"].includes(executable)) suggestions.push("Install uv: https://docs.astral.sh/uv/getting-started/installation/");
  if (executable === "docker") suggestions.push("Install Docker Desktop: https://www.docker.com/products/docker-desktop/");
  if (["python", "python3"].includes(executable)) suggestions.push("Install Python 3: https://www.python.org/downloads/");
  if (missingPaths.length > 0) suggestions.push("Copy the missing local file/folder from the old computer or edit the MCP config path.");
  if (secretEnv.length > 0) suggestions.push("Recreate secret environment values on this computer; values are not migrated.");
  if (suggestions.length === 0) suggestions.push("No automatic fix required.");
  return suggestions;
}
