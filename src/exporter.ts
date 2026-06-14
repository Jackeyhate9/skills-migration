import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { copyFileEnsuringDir, ensureDir } from "./fs-utils.js";
import { scan } from "./scanner.js";
import type { ExportOptions, Manifest } from "./types.js";

export async function writeManifest(manifest: Manifest, outputDir: string): Promise<string> {
  await ensureDir(outputDir);
  const manifestPath = path.join(outputDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

export async function exportBackup(options: ExportOptions): Promise<{ manifest: Manifest; outputDir: string; zipPath?: string }> {
  const manifest = await scan(options);
  const filesDir = path.join(options.outputDir, "files");
  await ensureDir(filesDir);
  await writeManifest(manifest, options.outputDir);

  for (const entry of manifest.entries) {
    if (!entry.included) continue;
    const source = entry.detected_paths[0];
    const target = path.join(filesDir, entry.id, entry.relative_path);
    await copyFileEnsuringDir(source, target);
  }

  if (options.zipPath) {
    await zipDirectory(options.outputDir, options.zipPath);
  }

  return { manifest, outputDir: options.outputDir, zipPath: options.zipPath };
}

async function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  const zip = new JSZip();

  async function addDir(current: string, zipPrefix = ""): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const zipName = path.posix.join(zipPrefix, entry.name);
      if (entry.isDirectory()) {
        await addDir(full, zipName);
      } else if (entry.isFile()) {
        zip.file(zipName, await fs.readFile(full));
      }
    }
  }

  await addDir(sourceDir);
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await ensureDir(path.dirname(zipPath));
  await fs.writeFile(zipPath, data);
}
