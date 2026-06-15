import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { buildConfigReview, writeConfigDiffReport } from "./config-review.js";
import { exportMigrationPackage } from "./exporter.js";
import { exportToFolder } from "./export-to-folder.js";
import { importMigrationPackage, planImport, previewImportPackage, rollback, writeConfigReviewChoices } from "./importer.js";
import { checkMcpRuntimes } from "./mcp-runtime-checker.js";
import { scan } from "./scanner.js";
import { runSelfCheck } from "./self-check.js";
import type { RestorePlan } from "./types.js";

const appDir = process.env.SKILLS_MIGRATOR_APP_DIR ?? process.cwd();
const webRoot = path.resolve(appDir, "web");

export async function startServer(port = 5174): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname === "/api/scan") {
        const manifest = await scan({ includeSessions: url.searchParams.get("sessions") === "true" });
        return sendJson(res, manifest);
      }

      if (url.pathname === "/api/export" && req.method === "POST") {
        const outputDir = path.resolve(url.searchParams.get("output") ?? "exports");
        const result = await exportMigrationPackage({ outputDir });
        return sendJson(res, {
          exportDir: result.exportDir,
          zipPath: result.zipPath,
          reportPath: result.reportPath,
          fileCount: result.manifest.file_count,
          skippedSensitive: result.manifest.skipped_sensitive_files.length
        });
      }

      if (url.pathname === "/api/export/folder" && req.method === "POST") {
        const backupDir = path.resolve(url.searchParams.get("dir") ?? "local-backup");
        const result = await exportToFolder({
          backupDir,
          outputDir: backupDir,
          gitCommit: url.searchParams.get("git") === "true"
        });
        return sendJson(res, result);
      }

      if (url.pathname === "/api/import/upload" && req.method === "POST") {
        const fileName = url.searchParams.get("name") ?? "migration.zip";
        const target = path.join(os.tmpdir(), `skills-migration-upload-${Date.now()}-${path.basename(fileName)}`);
        await fs.writeFile(target, await readBody(req));
        return sendJson(res, { archivePath: target });
      }

      if (url.pathname === "/api/import/manifest") {
        const archivePath = path.resolve(url.searchParams.get("from") ?? "exports/latest.zip");
        const result = await previewImportPackage({ archivePath, dryRun: true });
        return sendJson(res, {
          manifest: result.manifest,
          extractDir: result.extractDir,
          restorePlanPath: result.restorePlanPath,
          restorePlan: result.restorePlan,
          configReview: result.configReview,
          mcpRuntime: result.mcpRuntime
        });
      }

      if (url.pathname === "/api/import/preview") {
        const archivePath = path.resolve(url.searchParams.get("from") ?? "exports/latest.zip");
        const result = await planImport({ archivePath, dryRun: true });
        return sendJson(res, result);
      }

      if (url.pathname === "/api/config-review/apply" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as {
          restorePlanPath: string;
          choices: Record<string, "skip" | "backup_then_overwrite" | "merge" | "rename_imported">;
        };
        const plan = await writeConfigReviewChoices(body.restorePlanPath, body.choices);
        return sendJson(res, { restorePlan: plan });
      }

      if (url.pathname === "/api/config-review/report" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { restorePlanPath: string };
        const restorePlanPath = path.resolve(body.restorePlanPath);
        const plan = JSON.parse(await fs.readFile(restorePlanPath, "utf8")) as RestorePlan;
        const items = await buildConfigReview(plan);
        const reportPath = await writeConfigDiffReport(items, path.dirname(restorePlanPath));
        return sendJson(res, { reportPath });
      }

      if (url.pathname === "/api/mcp-runtime/recheck") {
        const archivePath = path.resolve(url.searchParams.get("from") ?? "exports/latest.zip");
        const preview = await previewImportPackage({ archivePath, dryRun: true });
        const mcpRuntime = await checkMcpRuntimes(preview.extractDir, preview.manifest);
        return sendJson(res, mcpRuntime);
      }

      if (url.pathname === "/api/import/run" && req.method === "POST") {
        const archivePath = path.resolve(url.searchParams.get("from") ?? "exports/latest.zip");
        const restorePlanPath = url.searchParams.get("plan") ? path.resolve(url.searchParams.get("plan")!) : undefined;
        const result = await importMigrationPackage({ archivePath, restorePlanPath });
        return sendJson(res, {
          actions: result.restorePlan.actions,
          restorePlanPath: result.restorePlanPath,
          reportPath: result.restoreReportPath,
          snapshotDir: result.restorePlan.backup_snapshot,
          resultSummary: result.resultSummary,
          mcpRuntime: result.mcpRuntime
        });
      }

      if (url.pathname === "/api/rollback" && req.method === "POST") {
        const snapshotDir = path.resolve(url.searchParams.get("snapshot") ?? "");
        const result = await rollback({ snapshotDir });
        return sendJson(res, result);
      }

      if (url.pathname === "/api/self-check" && req.method === "POST") {
        const outputDir = path.resolve(url.searchParams.get("out") ?? "self-check");
        const result = await runSelfCheck(outputDir);
        return sendJson(res, result);
      }

      return serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Skills Migration WebUI: http://localhost:${actualPort}`);
  return server;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
