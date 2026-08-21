# Codex WorkBuddy Orchestrator

Portable, local-first distribution of the `workbuddy-orchestrator` Codex skill. Codex remains the planner, safety reviewer, integrator, and final acceptor; WorkBuddy performs only bounded tasks through its headless CodeBuddy CLI. Version 0.2.0 also includes an optional Sol/Spark/Luna/DeepSeek/WorkBuddy routing kit, a credential-free Qwen vision template for DeepSeek Harness, and a maintained handoff to the complete Windows Hermes Qwen workflow.

## Installer behavior

Run `node bootstrap.mjs install` from a checkout or extracted ZIP. The installer:

1. Checks Node 20+, detects WorkBuddy.app/WorkBuddy.exe and its bundled `codebuddy` CLI, and accepts explicit flags or `WB_*` environment overrides.
2. Requires WorkBuddy. It adds a CodeBuddy profile only when its CLI and config directory are both detected. It never reads token, cookie, API key, or account-file contents.
3. Backs up an existing `~/.codex/skills/workbuddy-orchestrator` target and an existing workers config before writing. Generated config contains only executable paths, config directories, model, bounded turns, and tool allowlists.
4. Creates an isolated smoke workspace, dispatches a real WorkBuddy headless task, polls it, checks exact proof content, validates `result.json`, checks `allowedPaths` with `taskctl validate`, and marks accepted only after all evidence passes. The smoke directory is retained on both success and failure.

TRAE is never enabled. `--enable-agent-kit` installs backed-up `spark_worker` and `luna_worker` templates plus a standalone `multi-agent-router` Skill; it never edits `AGENTS.md`. The older `--enable-sol-luna` flag only copies an optional guidance fragment. `--skip-smoke` is for offline packaging only and is reported as skipped, never passed.

## Requirements

- Node.js 20+ on PATH (the current `process.execPath` is used by default).
- A signed-in WorkBuddy desktop installation with its internal headless CodeBuddy CLI. macOS Apple Silicon and Intel are both supported without hard-coded architecture.
- No npm package download is performed by this repository. WorkBuddy may use its own account/network while executing the smoke.

## Install

```sh
node bootstrap.mjs install
```

Install WorkBuddy plus the optional native child-agent router:

```sh
node bootstrap.mjs install --enable-agent-kit
```

The agent-kit flag installs these user-scoped components with reversible backups:

- `~/.codex/agents/spark-worker.toml`
- `~/.codex/agents/luna-worker.toml`
- `~/.codex/skills/multi-agent-router/`
- `~/.codex/multi-agent-router.json`

Start a new Codex task after installation so the new agent and Skill catalog is loaded. The default remains `auto`; no child agent starts merely because the files were installed.

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
请让 Codex 从 GitHub 仓库 https://github.com/banana2004828/codex-workbuddy-orchestrator 获取项目，先阅读 README 和两个 Skill 说明，再运行 `node bootstrap.mjs install --enable-agent-kit`；自动检测已登录 WorkBuddy（若检测到 CodeBuddy 的真实 Node CLI 再启用），安装 WorkBuddy Skill、Spark/Luna 子代理模板和 Multi-Agent Router，完成真实 WorkBuddy proof smoke，并且只有 proof、result.json、allowedPaths、工作区文件审计与 `taskctl validate` 全部独立通过后才报告 accepted；不得读取或输出任何 API Key，不得使用 computer use 代替无头验收，遇到登录、权限、模型或 CLI 阻塞时如实停止。
```

## Agent routing

The optional router keeps Sol in control and adds these explicit routes:

| Phrase | Route |
|---|---|
| `子代理模式` | auto-select an eligible executor |
| `Spark 子代理模式` | small isolated coding or focused tests through `spark_worker` |
| `Luna 子代理模式` | broader bounded work through `luna_worker` |
| `DeepSeek 子代理模式` | isolated DeepSeek Harness execution |
| `WorkBuddy 子代理模式` | real WorkBuddy headless task protocol |
| `这次只用 Sol` | no delegation for this task |

Spark and Luna consume Codex child-agent quota. DeepSeek uses the configured DeepSeek API balance. WorkBuddy uses its current entitlement or credits. Qwen vision uses the configured Qwen provider balance. Do not label any route free without current evidence.

The routing implementation is under `skill/multi-agent-router/`; the reusable native-agent definitions are under `agent-templates/`.

## DeepSeek Harness and Qwen vision

For the complete Windows Hermes path, use [qwen-vision-workflow](https://github.com/banana2004828/qwen-vision-workflow). It provides the one-click CMD entry, machine-readable PowerShell router, protected backups and receipts, verified rollback, optional pinned Qwen-MM support, a version-gated Harness adapter, dual-PowerShell tests, and a deterministic release ZIP. The installed WorkBuddy skill links to the exact handoff and acceptance rules in [qwen-vision-workflow.md](skill/workbuddy-orchestrator/references/qwen-vision-workflow.md).

The workflow is Windows-only. WorkBuddy on macOS can coordinate a bounded handoff, but installation and target acceptance must occur on the intended Windows Hermes machine. Real image verification may consume Qwen/DashScope balance and remains blocked until the user explicitly authorizes `-ConfirmPaidCalls`.

The repository includes [a version-sensitive Qwen child-tool fragment](templates/deepseek-harness/qwen-vision.fragment.yml). It represents the accepted design for an explicit local image path:

```text
DeepSeek parent
  -> qwen_vision one-shot child
  -> Qwen calls read_image on a real local image
  -> structured text report
  -> DeepSeek continues
  -> Sol verifies the result
```

Before using the fragment:

1. Pin and build a compatible official `deepseek-ai/deepseek-harness` revision.
2. Configure the DeepSeek and Qwen providers through Harness's credential system; never place keys in this repository or preset YAML.
3. Copy an existing coding preset and merge the fragment inside its delegation group.
4. Validate the composed profile before starting a real session.
5. Run a real PNG test and verify the parent called `qwen_vision`, the child called `read_image`, the report returned, and the parent continued.

The explicit local-path flow was previously accepted on one Windows installation. It is not proof for another Harness revision or computer. The later automatic `Ctrl+V` attachment bridge attempt ended without final acceptance, so this repository intentionally does **not** claim pasted-image routing is installed or working. See [the installed agent-stack boundary](skill/workbuddy-orchestrator/references/agent-stack.md).

## Repository layout

The reusable skill is under `skill/workbuddy-orchestrator/`:

- `SKILL.md` contains the concise operating rules.
- `scripts/taskctl.mjs` implements the file-backed task contract and headless dispatch.
- `references/` documents the protocol and direct transport boundaries.
- `assets/sol-luna/AGENTS.optional.md` is opt-in guidance only.
- `skill/multi-agent-router/` provides the optional cross-platform router Skill.
- `agent-templates/` contains credential-free Spark and Luna definitions.
- `templates/deepseek-harness/` contains a review-first Qwen vision fragment.

Run local tests with `npm test`; validate the skill with the skill-creator `quick_validate.py` script. This repository does not commit, push, create a GitHub repository, or include local worker credentials.

## ZIP distribution

Run `npm run package` to create `dist/codex-workbuddy-orchestrator-0.2.0.zip`. The pure-Node packager excludes `.git`, `node_modules`, `dist`, `.workbuddy-orchestrator`, `.trae-bridge`, `workers.local.json`, logs, test fixtures/output, and existing ZIP files. It writes only repository files and reports the archive SHA-256.
