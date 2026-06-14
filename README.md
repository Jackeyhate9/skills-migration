# AI Agent Skills Migrator

Windows-first, cross-platform migrator for AI coding agent skills, agents, commands, prompts, MCP configs, settings, memories, and optional sessions.

The goal is simple: scan one machine, export a safe migration bundle, copy it to another machine, preview the restore, and apply it with conflict handling and rollback snapshots.

![Dashboard screenshot](docs/screenshots/dashboard.png)

## Why This Exists

AI coding agents are becoming personal workbenches. Over time they collect skills, command snippets, MCP server configs, project prompts, memories, and agent-specific settings. Those files are scattered across different home directories and app data folders, especially on Windows.

This MVP gives you a single tool to:

- detect installed agent configuration files,
- classify them into portable migration categories,
- exclude secrets by default,
- generate a `manifest.json`,
- export a zip and local backup folder,
- preview restore actions on a new machine,
- resolve conflicts with `skip`, `overwrite`, or `rename`,
- create restore snapshots before overwriting anything.

## Agent Compatibility

| Agent or tool | Windows paths | macOS/Linux paths | MVP status |
| --- | --- | --- | --- |
| Codex | `%USERPROFILE%\.codex` | `~/.codex` | Supported |
| OpenClaw / `.agents` skills | `%USERPROFILE%\.agents` | `~/.agents` | Supported |
| Claude Code | `%USERPROFILE%\.claude` | `~/.claude` | Supported |
| opencode | `%APPDATA%\opencode`, `%LOCALAPPDATA%\opencode`, `%USERPROFILE%\.config\opencode` | `~/.config/opencode` | Supported |
| Hermes | `%USERPROFILE%\.hermes` | `~/.hermes` | Supported |
| Cursor | `%USERPROFILE%\.cursor` | `~/.cursor` | Supported |
| Gemini CLI | `%USERPROFILE%\.gemini` | `~/.gemini` | Supported |

Detected categories:

- `skills`
- `agents`
- `commands`
- `prompts`
- `mcp_configs`
- `settings`
- `memories`
- `sessions`, optional
- `secrets`, detected and excluded by default

## One-Command Migration

On the source machine, create a portable backup:

```powershell
ai-agent-skills-migrator.exe backup --out backups/latest --zip export.zip
```

Copy `export.zip` or the `backups/latest` folder to the target machine.

On the target machine, preview restore:

```powershell
ai-agent-skills-migrator.exe restore --from backups/latest --preview --strategy skip
```

Apply restore:

```powershell
ai-agent-skills-migrator.exe restore --from backups/latest --strategy skip
```

Conflict strategies:

- `skip`: keep existing target files
- `overwrite`: snapshot existing target files, then replace them
- `rename`: write migrated files as `*.migrated-N.*`

## Windows EXE Package

Build the runnable Windows package:

```powershell
npm install
npm run package:win
```

The output is:

```text
outputs\win-x64\ai-agent-skills-migrator.exe
```

`outputs\win-x64` is the portable release folder. It includes:

- `ai-agent-skills-migrator.exe`, a small Windows launcher,
- `node.exe`, the bundled Node runtime,
- `app\cli.cjs`, the bundled migrator code,
- `app\web`, the WebUI assets,
- `app\docs`, schema and docs assets.

Run the WebUI:

```powershell
outputs\win-x64\ai-agent-skills-migrator.exe web
```

Run CLI commands:

```powershell
outputs\win-x64\ai-agent-skills-migrator.exe scan --out manifest.json
outputs\win-x64\ai-agent-skills-migrator.exe backup --out backups/latest --zip export.zip
outputs\win-x64\ai-agent-skills-migrator.exe restore --from backups/latest --preview
```

There is also an experimental Node SEA single-exe script:

```powershell
npm run package:win:sea
```

On Windows, SEA injection may require Windows SDK `signtool` to remove and reapply the Node executable signature.

## Development

```powershell
npm install
npm run smoke
npm run typecheck
npm run dev
```

Open the WebUI at:

```text
http://localhost:5174
```

## CLI

Scan and print a manifest:

```powershell
npm run cli -- scan
```

Scan to a file:

```powershell
npm run cli -- scan --out outputs/manifest.json
```

Export a local backup directory and zip:

```powershell
npm run cli -- backup --out backups/latest --zip outputs/export.zip
```

Preview restore:

```powershell
npm run cli -- restore --from backups/latest --preview --strategy skip
```

Restore:

```powershell
npm run cli -- restore --from backups/latest --strategy skip
```

## WebUI

The WebUI includes:

- Dashboard
- Scan
- Export
- Import
- Conflicts
- Logs
- Settings

It is intentionally simple: no cloud account, no hidden upload, no background sync. The local API is served by the same CLI process.

## Manifest

The manifest schema is in `docs/manifest.schema.json`.

Each manifest entry includes:

- `agent_name`
- `detected_paths`
- `file_count`
- `size`
- `category`
- `checksum`
- `target_restore_path`
- `risk_level`
- `included`

## Safety Model

Defaults are conservative:

- API keys, tokens, `.env`, credentials, and secret-like files are excluded.
- Detected sensitive previews are redacted in `manifest.json`.
- Sessions are skipped unless `--include-sessions` is passed.
- Imports default to `skip` for conflicts.
- Overwrite restores create a backup snapshot before replacing files.
- `restore_report.md` is generated after restore.
- Locked or unreadable files are skipped instead of aborting the whole scan.

## Optional GitHub Private Repo Backup

GitHub sync is optional in the MVP. The recommended private-repo workflow is:

```powershell
npm run cli -- backup --out backups/latest --zip outputs/export.zip
gh repo create my-agent-skills-backup --private
git init backups/latest
git -C backups/latest add .
git -C backups/latest commit -m "Backup AI agent skills"
git -C backups/latest remote add origin https://github.com/YOUR_NAME/my-agent-skills-backup.git
git -C backups/latest push -u origin main
```

Keep the repository private. Do not use `--include-secrets` unless you have audited the archive.

## Smoke Test

```powershell
npm run smoke
```

The smoke test creates a fake Windows-style source home, adds Claude, Codex, and OpenClaw files plus a secret `.env`, exports a backup, previews import into a fake target home, restores included files, and verifies the secret was not restored.

## Local Detection Result

On the maintainer machine used for this MVP, the packaged exe successfully detected real skills:

```text
skills category files: 13,109
SKILL.md files: 1,735
```

Detected `SKILL.md` files by agent:

```text
claude: 26
codex: 1559
openclaw: 46
cursor: 1
opencode: 27
hermes: 74
gemini: 2
```

The exact numbers depend on your local agent installations.

## Reference Alignment

This MVP borrows the product shape from the requested references:

- opencode-style local config sync, with a manifest-first backup directory.
- Hermes-like migration flow: scan, map, preview, restore.
- Claude Code backup style: global/project config discovery and private GitHub option.
- Multi-agent backup scripts: one scanner covering several agent homes.
- Cross-tool skills conversion groundwork: category inference and portable manifest entries.
- `npx skills` style package-manager ergonomics: small commands that can later become install/publish flows.
