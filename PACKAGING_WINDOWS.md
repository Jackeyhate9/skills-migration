# Windows Packaging

This project is a Windows-first practical release. The verified packaging path is the bundled Node launcher in `outputs/win-x64`. Tauri desktop packaging is the intended full desktop direction, but this checkout does not yet include a complete `src-tauri` scaffold.

## Current Machine Check

- Rust: installed (`rustc 1.91.0`)
- Cargo: installed (`cargo 1.91.0`)
- Visual Studio Build Tools: installed (`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`)
- `tauri` CLI: not found on PATH
- Tauri scaffold: not present yet (`src-tauri` is required for a real Tauri installer)

## Development

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5174
```

## Verified Windows Folder Package

```powershell
npm run package:win
```

Output:

```text
outputs\win-x64\skills-migration.exe
outputs\win-x64\app\
outputs\win-x64\node.exe
```

Run:

```powershell
outputs\win-x64\skills-migration.exe web
outputs\win-x64\skills-migration.exe self-check
outputs\win-x64\skills-migration.exe export --output ./exports
```

## Tauri Build Command

The npm script is available:

```powershell
npm run tauri:build
```

For this command to produce a real desktop installer, add a valid Tauri app scaffold:

```text
src-tauri\
  Cargo.toml
  tauri.conf.json
  src\main.rs
```

Common failure causes:

- Rust or Cargo is missing.
- Visual Studio C++ Build Tools are missing.
- `@tauri-apps/cli` or the `tauri` command is not installed.
- `src-tauri` is missing.
- The WebUI dev/build path in `tauri.conf.json` points to the wrong folder.

## Practical Release Position

For v0.3, use `npm run package:win` for a working Windows executable folder. Use Tauri for the full desktop migration experience once the `src-tauri` shell is added.
