import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { exportBackup } from "./exporter.js";
import { planImport, runImport } from "./importer.js";
import { scan } from "./scanner.js";
import type { ConflictStrategy } from "./types.js";

const appDir = process.env.SKILLS_MIGRATOR_APP_DIR ?? process.cwd();
const webRoot = path.resolve(appDir, "web");

export async function startServer(port = 5174): Promise<void> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname === "/api/scan") {
        const manifest = await scan({ includeSessions: url.searchParams.get("sessions") === "true" });
        return sendJson(res, manifest);
      }

      if (url.pathname === "/api/export" && req.method === "POST") {
        const outputDir = path.resolve("backups", "latest");
        const result = await exportBackup({ outputDir, zipPath: path.resolve("outputs", "export.zip") });
        return sendJson(res, {
          outputDir: result.outputDir,
          zipPath: result.zipPath,
          summary: result.manifest.summary,
          excludedSecrets: result.manifest.excluded_secrets.length
        });
      }

      if (url.pathname === "/api/import/preview") {
        const archiveDir = path.resolve(url.searchParams.get("from") ?? "backups/latest");
        const strategy = (url.searchParams.get("strategy") ?? "skip") as ConflictStrategy;
        const result = await planImport({ archiveDir, strategy, dryRun: true });
        return sendJson(res, result);
      }

      if (url.pathname === "/api/import/run" && req.method === "POST") {
        const result = await runImport({ archiveDir: path.resolve("backups/latest"), strategy: "skip" });
        return sendJson(res, { actions: result.actions, reportPath: result.reportPath });
      }

      return serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`AI Agent Skills Migrator WebUI: http://localhost:${port}`);
}

async function serveStatic(urlPath: string, res: http.ServerResponse): Promise<void> {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const assetKey = `web${safePath.replaceAll("\\", "/")}`;
  const seaAsset = readSeaAsset(assetKey);
  if (seaAsset) {
    res.writeHead(200, { "content-type": contentType(safePath) });
    res.end(seaAsset);
    return;
  }

  const target = path.resolve(webRoot, `.${safePath}`);
  if (!target.startsWith(webRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const data = await fs.readFile(target);
  res.writeHead(200, { "content-type": contentType(target) });
  res.end(data);
}

function readSeaAsset(assetKey: string): Buffer | undefined {
  try {
    const req = Function("return require")() as NodeRequire;
    const sea = req("node:sea") as { isSea: () => boolean; getAsset: (key: string) => ArrayBuffer };
    if (!sea.isSea()) return undefined;
    return Buffer.from(sea.getAsset(assetKey));
  } catch {
    return undefined;
  }
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".json") return "application/json";
  return "text/html";
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg === -1 ? 5174 : Number(process.argv[portArg + 1]);
  startServer(port).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
