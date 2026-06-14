import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile);
const root = process.cwd();
const outputDir = path.join(root, "outputs", "win-x64");
const appDir = path.join(outputDir, "app");
const bundlePath = path.join(appDir, "cli.cjs");

await rm(outputDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: bundlePath
});

await cp(path.join(root, "web"), path.join(appDir, "web"), { recursive: true });
await cp(path.join(root, "docs"), path.join(appDir, "docs"), { recursive: true });
await copyFile(process.execPath, path.join(outputDir, "node.exe"));

await exec(
  "dotnet",
  [
    "publish",
    "launcher/AiAgentSkillsMigrator.Launcher.csproj",
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:DebugType=None",
    "-p:DebugSymbols=false",
    "-o",
    outputDir
  ],
  { cwd: root }
);

console.log(`Created Windows executable package: ${outputDir}`);
console.log(`Run: ${path.join(outputDir, "ai-agent-skills-migrator.exe")}`);
