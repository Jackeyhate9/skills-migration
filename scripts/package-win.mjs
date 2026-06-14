import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile);
const root = process.cwd();
const seaDir = path.join(root, "dist", "sea");
const bundlePath = path.join(seaDir, "cli.cjs");
const blobPath = path.join(seaDir, "sea-prep.blob");
const configPath = path.join(seaDir, "sea-config.json");
const exePath = path.join(root, "outputs", "skills-migration.exe");
const postjectCli = path.join(root, "node_modules", "postject", "dist", "cli.js");

await rm(seaDir, { recursive: true, force: true });
await mkdir(seaDir, { recursive: true });
await mkdir(path.dirname(exePath), { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: bundlePath
});

await writeFile(
  configPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      assets: {
        "web/index.html": "web/index.html",
        "web/styles.css": "web/styles.css",
        "web/app.js": "web/app.js",
        "docs/manifest.schema.json": "docs/manifest.schema.json"
      }
    },
    null,
    2
  ),
  "utf8"
);

await exec(process.execPath, ["--experimental-sea-config", configPath], { cwd: root });
await copyFile(process.execPath, exePath);
await exec(
  process.execPath,
  [
    postjectCli,
    exePath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    "--overwrite"
  ],
  { cwd: root }
);

console.log(`Created ${exePath}`);
