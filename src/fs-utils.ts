import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function checksumFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

export async function copyFileEnsuringDir(source: string, target: string): Promise<void> {
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
}

export async function readTextSample(filePath: string, maxBytes = 8192): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const result = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function safeRelative(base: string, target: string): string {
  const relative = path.relative(base, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside base: ${target}`);
  }
  return relative;
}

export function portableId(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
