import path from "node:path";
import type { McpAnalysis, McpServerRef } from "./types.js";

const ABSOLUTE_PATH_PATTERN = /([A-Za-z]:\\|\/Users\/|\/home\/|\/opt\/|\/usr\/local\/|~[\\/])/;

export function looksLikeMcpConfig(filePath: string, contentSample = ""): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const name = path.basename(normalized);
  return (
    name === ".mcp.json" ||
    name === "mcp.json" ||
    name === "mcp_servers.json" ||
    name.includes("mcp") ||
    normalized.includes("/mcp/") ||
    /"mcpServers"\s*:/.test(contentSample) ||
    /"mcp_servers"\s*:/.test(contentSample) ||
    /\[mcp/i.test(contentSample)
  );
}

export function analyzeMcpConfig(content: string): McpAnalysis | undefined {
  const parsed = parseJson(content);
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const serversObject = findServersObject(parsed);
  if (!serversObject) {
    return undefined;
  }

  const servers: McpServerRef[] = Object.entries(serversObject).map(([name, value]) => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const command = asString(record.command);
    const cwd = asString(record.cwd);
    const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === "string") : [];
    const hints = machineBoundHints(command, cwd, args);

    if (record.env && typeof record.env === "object") {
      hints.push("contains env block; secret values are excluded/redacted by global secret detection if stored separately");
    }

    return {
      name,
      command,
      cwd,
      has_env: Boolean(record.env),
      machine_bound_hints: hints
    };
  });

  const warnings = [
    ...new Set(servers.flatMap((server) => server.machine_bound_hints))
  ];

  return {
    server_count: servers.length,
    servers,
    warnings
  };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function machineBoundHints(command: string | undefined, cwd: string | undefined, args: string[]): string[] {
  const hints: string[] = [];
  if (command && ABSOLUTE_PATH_PATTERN.test(command)) {
    hints.push(`command uses machine-local path: ${command}`);
  }
  if (cwd && ABSOLUTE_PATH_PATTERN.test(cwd)) {
    hints.push(`cwd uses machine-local path: ${cwd}`);
  }
  for (const arg of args) {
    if (ABSOLUTE_PATH_PATTERN.test(arg)) {
      hints.push(`arg uses machine-local path: ${arg}`);
    }
  }
  return hints;
}
