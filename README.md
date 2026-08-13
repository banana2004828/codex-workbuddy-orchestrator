# Codex WorkBuddy Orchestrator

Portable, local-first distribution of the `workbuddy-orchestrator` Codex skill. Codex remains the planner, safety reviewer, integrator, and final acceptor; WorkBuddy performs only bounded tasks through its headless CodeBuddy CLI.

## Installer behavior

Run `node bootstrap.mjs install` from a checkout or extracted ZIP. The installer:

1. Checks Node 20+, detects WorkBuddy.app/WorkBuddy.exe and its bundled `codebuddy` CLI, and accepts explicit flags or `WB_*` environment overrides.
2. Requires WorkBuddy. It adds a CodeBuddy profile only when its CLI and config directory are both detected. It never reads token, cookie, API key, or account-file contents.
3. Backs up an existing `~/.codex/skills/workbuddy-orchestrator` target and an existing workers config before writing. Generated config contains only executable paths, config directories, model, bounded turns, and tool allowlists.
4. Creates an isolated smoke workspace, dispatches a real WorkBuddy headless task, polls it, checks exact proof content, validates `result.json`, checks `allowedPaths` with `taskctl validate`, and marks accepted only after all evidence passes. The smoke directory is retained on both success and failure.

TRAE is never enabled. Sol/Luna guidance is copied only with `--enable-sol-luna`; it is an optional fragment and never overwrites an existing `AGENTS.md`. `--skip-smoke` is for offline packaging only and is reported as skipped, never passed.

## Requirements

- Node.js 20+ on PATH (the current `process.execPath` is used by default).
- A signed-in WorkBuddy desktop installation with its internal headless CodeBuddy CLI. macOS Apple Silicon and Intel are both supported without hard-coded architecture.
- No npm package download is performed by this repository. WorkBuddy may use its own account/network while executing the smoke.

## Install

```sh
node bootstrap.mjs install
```

Example overrides:

```sh
node bootstrap.mjs install \
  --workbuddy-app "/Applications/WorkBuddy.app" \
  --workbuddy-cli "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy.js" \
  --workbuddy-config-dir "$HOME/.workbuddy"
```

Windows uses the same Node command. Supported environment overrides include `WB_WORKBUDDY_APP`, `WB_WORKBUDDY_CLI`, `WB_WORKBUDDY_CONFIG_DIR`, `WB_CODEBUDDY_APP`, `WB_CODEBUDDY_CLI`, `WB_CODEBUDDY_CONFIG_DIR`, `WB_TARGET`, and `WB_CONFIG_OUT`.

## One-line prompt for a colleague's Codex

```text
请让 Codex 从 GitHub 仓库 https://github.com/wjx040828-stack/codex-workbuddy-orchestrator 获取项目，先阅读 README 和 Skill 说明，再运行 `node bootstrap.mjs install`；自动检测已登录 WorkBuddy（若检测到 CodeBuddy 的真实 Node CLI 再启用），把 Skill 安装到 `~/.codex/skills/workbuddy-orchestrator`，完成真实 WorkBuddy proof smoke，并且只有 proof、result.json、allowedPaths、工作区文件审计与 `taskctl validate` 全部独立通过后才报告 accepted，同时保留测试目录路径；遇到登录、权限或检测阻塞时如实停止，不要改用界面手动冒烟。
```

## Repository layout

The reusable skill is under `skill/workbuddy-orchestrator/`:

- `SKILL.md` contains the concise operating rules.
- `scripts/taskctl.mjs` implements the file-backed task contract and headless dispatch.
- `references/` documents the protocol and direct transport boundaries.
- `assets/sol-luna/AGENTS.optional.md` is opt-in guidance only.

Run local tests with `npm test`; validate the skill with the skill-creator `quick_validate.py` script. This repository does not commit, push, create a GitHub repository, or include local worker credentials.

## ZIP distribution

Run `npm run package` to create `dist/codex-workbuddy-orchestrator-0.1.0.zip`. The pure-Node packager excludes `.git`, `node_modules`, `dist`, `.workbuddy-orchestrator`, `.trae-bridge`, `workers.local.json`, logs, test fixtures/output, and existing ZIP files. It writes only repository files and reports the archive SHA-256.
