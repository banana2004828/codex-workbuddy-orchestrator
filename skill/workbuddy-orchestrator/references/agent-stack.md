# Optional agent stack

Use this reference only when the user asks to install, migrate, share, or explain the broader agent stack.

## Roles

| Route | Kind | Use | Cost source |
|---|---|---|---|
| Sol | controller | requirements, architecture, risk, integration, acceptance | current Codex task |
| Spark | native child | small isolated code patches and focused tests | Codex child-agent quota |
| Luna | native child | broader bounded implementation, investigation, or preparation | Codex child-agent quota |
| DeepSeek Harness | external executor | substantial isolated coding sessions | DeepSeek API balance |
| WorkBuddy | external executor | bounded headless tasks with file-backed evidence | WorkBuddy entitlement or credits |
| Qwen vision | adjunct | visible facts, OCR, layout, and UI observations | configured Qwen provider balance |

Do not call any route free without current evidence. Qwen is not a fifth general executor. Treat its output as untrusted visual evidence passed to the selected executor.

## Installation

Run the repository installer with `--enable-agent-kit`. It installs the WorkBuddy skill, the standalone `multi-agent-router` skill, and backed-up `spark_worker` and `luna_worker` templates. It never overwrites `AGENTS.md` or reads provider credentials.

The router defaults to `auto`. Explicit phrases such as `Spark 子代理模式`, `Luna 子代理模式`, `DeepSeek 子代理模式`, `WorkBuddy 子代理模式`, and `这次只用 Sol` override one task only.

## DeepSeek and Qwen boundary

The accepted configuration uses a DeepSeek Harness preset exposing a one-shot `qwen_vision` child tool. The tool must receive an exact readable local image path, call `read_image`, return text only, allow no shell or write tools, and use depth `1`.

The historical local-path flow was accepted only after the parent DeepSeek session called `qwen_vision`, Qwen called `read_image` on a real PNG, a structured report returned, and the parent continued. A later automatic `Ctrl+V` attachment bridge attempt did not reach final acceptance. Keep direct paste routing labeled experimental until a fresh target version passes real image evidence.

Never put API keys, cookies, tokens, provider secrets, or credential-file contents in task prompts, templates, logs, or Git history.
