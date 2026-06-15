# Skills Migration

Skills Migration 是一个 Windows 优先、跨平台可扩展的 AI Agent Skills 迁移工具。它可以扫描本机常见 AI coding agent 配置目录，识别 skills、agents、commands、prompts、MCP configs、settings、memories，并导出为可恢复的迁移包。

English summary: **Skills Migration** backs up and restores AI coding agent skills, prompts, MCP configs, settings, and memories across machines.

![Dashboard screenshot](docs/screenshots/dashboard.png)

## 项目目标

当你更换电脑、重装系统、切换工作环境时，AI Agent 的技能和配置往往散落在多个目录里。Skills Migration 的目标是：

- 一键扫描本机 AI Agent 配置；
- 自动分类 skills、prompts、MCP、settings、memories；
- 默认排除 API key、token、`.env` 和 secret-like 文件；
- 生成 `manifest.json`，记录 checksum、目标恢复路径和风险级别；
- 导出本地备份目录和 zip；
- 在新机器上预览恢复内容；
- 冲突时支持 `skip`、`overwrite`、`rename`；
- 覆盖前自动创建 backup snapshot，支持回滚依据。

## 适配的 Agent

| Agent / Tool | Windows 扫描路径 | macOS / Linux 扫描路径 | 状态 |
| --- | --- | --- | --- |
| Codex | `%USERPROFILE%\.codex` | `~/.codex` | 已支持 |
| OpenClaw / `.agents` skills | `%USERPROFILE%\.agents` | `~/.agents` | 已支持 |
| Claude Code | `%USERPROFILE%\.claude` | `~/.claude` | 已支持 |
| opencode | `%APPDATA%\opencode`, `%LOCALAPPDATA%\opencode`, `%USERPROFILE%\.config\opencode` | `~/.config/opencode` | 已支持 |
| Hermes | `%USERPROFILE%\.hermes` | `~/.hermes` | 已支持 |
| Cursor | `%USERPROFILE%\.cursor` | `~/.cursor` | 已支持 |
| Gemini CLI | `%USERPROFILE%\.gemini` | `~/.gemini` | 已支持 |

识别类别：

- `skills`
- `agents`
- `commands`
- `prompts`
- `mcp_configs`
- `settings`
- `memories`
- `sessions`，默认不迁移，可选开启
- `secrets`，默认不迁移，只提示和打码

## 一键导出迁移

源机器执行：

```powershell
skills-migration.exe backup --out backups/latest --zip export.zip
```

把 `export.zip` 或 `backups/latest` 复制到目标机器。

目标机器先预览：

```powershell
skills-migration.exe restore --from backups/latest --preview --strategy skip
```

确认后恢复：

```powershell
skills-migration.exe restore --from backups/latest --strategy skip
```

冲突策略：

- `skip`：目标文件已存在时跳过；
- `overwrite`：先备份目标原文件，再覆盖；
- `rename`：写入为 `*.migrated-N.*`。

## MCP 产品如何迁移

Skills Migration 会迁移 MCP 配置文件本身，例如 `.mcp.json`、`mcp.json`、包含 `mcpServers` 的 settings/config 文件。

迁移时会额外分析：

- MCP server 名称；
- `command`；
- `cwd`；
- `args` 中的本机路径；
- 是否存在 `env` 配置块；
- 源机器 `machine_id`、hostname、platform、arch、username。

重要说明：

- 当前不会做 DRM 式“绑定机器码后禁止恢复”。这样做会让跨电脑迁移失去意义。
- manifest 会记录 `source_machine.machine_id`，用于恢复报告中校验“这个包来自哪台机器”。
- 如果 MCP server 的 `command`、`cwd`、`args` 里出现 `C:\...`、`/Users/...`、`/home/...` 等机器本地路径，会在 `manifest.json` 和 `restore_report.md` 中提示需要在目标机器重绑。
- API key、token、`.env` 和 secret-like 文件默认不迁移。目标机器应重新配置这些凭据。

也就是说：MCP 配置会被迁移，机器相关路径和凭据会被提示重绑，而不是静默复制后假装可用。

## Windows 可运行包

构建 Windows 便携包：

```powershell
npm install
npm run package:win
```

输出目录：

```text
outputs\win-x64
```

可执行文件：

```text
outputs\win-x64\skills-migration.exe
```

启动 WebUI：

```powershell
outputs\win-x64\skills-migration.exe web
```

运行 CLI：

```powershell
outputs\win-x64\skills-migration.exe scan --out manifest.json
outputs\win-x64\skills-migration.exe backup --out backups/latest --zip export.zip
outputs\win-x64\skills-migration.exe restore --from backups/latest --preview
```

`outputs\win-x64` 是可复制的发布目录，包含：

- `skills-migration.exe`：Windows launcher；
- `node.exe`：随包携带的 Node runtime；
- `app\cli.cjs`：打包后的迁移逻辑；
- `app\web`：前端界面；
- `app\docs`：manifest schema 等文档资源。

## 本地开发

```powershell
npm install
npm run smoke
npm run typecheck
npm run dev
```

打开：

```text
http://localhost:5174
```

## CLI 命令

扫描并输出 manifest：

```powershell
npm run cli -- scan
```

扫描到文件：

```powershell
npm run cli -- scan --out outputs/manifest.json
```

导出备份目录和 zip：

```powershell
npm run cli -- backup --out backups/latest --zip outputs/export.zip
```

预览恢复：

```powershell
npm run cli -- restore --from backups/latest --preview --strategy skip
```

执行恢复：

```powershell
npm run cli -- restore --from backups/latest --strategy skip
```

## WebUI

WebUI 页面包括：

- Dashboard
- Scan
- Export
- Import
- Conflicts
- Logs
- Settings

当前 WebUI 是本地优先设计：没有云账号，没有隐式上传，所有 API 都由本地 CLI 进程提供。

## Manifest

schema 文件：

```text
docs/manifest.schema.json
```

每条 manifest entry 包含：

- `agent_name`
- `detected_paths`
- `file_count`
- `size`
- `category`
- `checksum`
- `target_restore_path`
- `risk_level`
- `included`
- `mcp`，当识别到 MCP config 时包含 server 详情
- `migration_notes`，迁移到另一台机器时需要注意的事项

manifest 顶层还包含：

- `source_machine.machine_id`
- `source_machine.hostname`
- `source_machine.platform`
- `source_machine.arch`
- `source_machine.username`

## 安全默认值

- 默认排除 API keys、tokens、`.env`、credentials 和 secret-like 文件；
- manifest 中的敏感预览会打码；
- sessions 默认不迁移，除非显式传入 `--include-sessions`；
- import 默认使用 `skip` 冲突策略；
- overwrite 前会创建 backup snapshot；
- 恢复完成后生成 `restore_report.md`；
- 被占用或不可读文件会跳过，不会中断整个扫描。
- MCP 配置中的机器本地路径会被标注为重绑提示。

## 可选 GitHub 私有仓库备份

GitHub 同步不是默认功能。推荐把迁移包放到 private repo：

```powershell
npm run cli -- backup --out backups/latest --zip outputs/export.zip
gh repo create my-agent-skills-backup --private
git init backups/latest
git -C backups/latest add .
git -C backups/latest commit -m "Backup AI agent skills"
git -C backups/latest remote add origin https://github.com/YOUR_NAME/my-agent-skills-backup.git
git -C backups/latest push -u origin main
```

请保持仓库为 private。除非你已经审计过迁移包，否则不要使用 `--include-secrets`。

## Smoke Test

```powershell
npm run smoke
```

测试会创建一个假的 Windows home，写入 Claude、Codex、OpenClaw 配置和一个 secret `.env`，然后验证导出、预览、恢复流程，并确认 secret 不会被恢复。

## 本机识别测试

在 MVP 开发机器上，发布版 exe 已成功识别真实 skills：

```text
skills category files: 13,109
SKILL.md files: 1,735
```

按 Agent 统计的 `SKILL.md`：

```text
claude: 26
codex: 1559
openclaw: 46
cursor: 1
opencode: 27
hermes: 74
gemini: 2
```

实际数字取决于你的本机安装情况。

## English Quick Start

Build:

```powershell
npm install
npm run package:win
```

Backup on the source machine:

```powershell
skills-migration.exe backup --out backups/latest --zip export.zip
```

Preview and restore on the target machine:

```powershell
skills-migration.exe restore --from backups/latest --preview --strategy skip
skills-migration.exe restore --from backups/latest --strategy skip
```

## Reference Alignment

This MVP borrows the product shape from:

- opencode-style local config sync with a manifest-first backup directory;
- Hermes-like scan, map, preview, restore flow;
- Claude Code backup style global/project config discovery;
- multi-agent backup scripts covering several agent homes;
- cross-tool skills conversion groundwork;
- `npx skills` style package-manager ergonomics.
