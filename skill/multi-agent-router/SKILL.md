---
name: multi-agent-router
description: Route work between Sol, native spark_worker and luna_worker child agents, DeepSeek Harness, and WorkBuddy while Sol retains planning, risk control, and final acceptance. Use when the user says "子代理模式", asks for automatic agent selection, names Spark, Luna, DeepSeek, or WorkBuddy as an executor, or asks which quota or API balance should be consumed.
---

# Multi-Agent Router

Keep Sol as controller. Read [references/routing-policy.md](references/routing-policy.md), then read the saved mode with `node scripts/router-mode.mjs --read-current` before routing a task.

## Overrides

- `子代理模式` means `auto`.
- `Spark 子代理模式`, `Luna 子代理模式`, `DeepSeek 子代理模式`, and `WorkBuddy 子代理模式` select one route for the current task.
- `这次只用 Sol` and `这次不用 <route>` are current-task exclusions only.
- Never persist a mode unless the user explicitly asks to change the default.

## Routes

- `sol`: requirements, architecture, unclear scope, credentials, destructive or external actions, integration, acceptance, and final answers.
- `spark`: spawn exactly `spark_worker` for a small, isolated code patch or focused test. Do not set a model override.
- `luna`: spawn exactly `luna_worker` for a broader bounded, independent low- or medium-risk task. Never use `model=luna`.
- `deepseek`: run `scripts/invoke-deepseek-harness.mjs` only with an explicit Harness root and isolated working directory. Treat output as a candidate.
- `workbuddy`: use `$workbuddy-orchestrator`, its file protocol, a real headless dispatch, and independent evidence checks.
- `auto`: select by risk, independence, worker health, capability, and cost source. Qwen vision is an adjunct observation route, not a general executor.

Show this chooser when requested:

1. 自动判断（推荐）
2. WorkBuddy
3. DeepSeek Harness
4. Spark（小型快速编码）
5. Luna（通用边界任务）
6. 仅 Sol

Before any paid external request, name the route and cost source. Never purchase, subscribe, renew, expose credentials, or claim savings without measured evidence. Every delegated result remains unaccepted until Sol inspects artifacts and reruns proportionate checks.
