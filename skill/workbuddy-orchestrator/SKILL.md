---
name: workbuddy-orchestrator
description: Coordinate bounded, independently verifiable tasks through a signed-in WorkBuddy headless CodeBuddy CLI while Codex retains planning, safety, integration, and final acceptance. Use only when a user explicitly asks to teach, install, migrate to, test, run through, or make a WorkBuddy-usable version, including installing the optional Sol/Spark/Luna/DeepSeek/WorkBuddy agent stack.
---

# WorkBuddy Orchestrator

Keep Codex as the primary planner and reviewer. Use the bundled `scripts/taskctl.mjs` file protocol and a generated workers configuration; never treat a dispatch, a client window, or an assistant message as completion.

## Trigger boundary

Activate the full WorkBuddy loop only when the user explicitly asks to teach/install/migrate/test/run through WorkBuddy or to produce a WorkBuddy-usable version. Otherwise keep the work in Codex. Do not add TRAE to configuration or workflow. A detected CodeBuddy profile is optional and may be selected only when the installer found its executable and config directory.

## Dispatch

1. Preserve Codex ownership of requirements, architecture, credentials, destructive or external actions, publishing, conflicts, and final conclusions.
2. Choose one independent low or medium risk lane. Do not delegate high-risk, ambiguous, credential-handling, or overlapping writes.
3. Write a task spec with `title`, `objective`, `acceptanceCriteria`, `allowedPaths`, `forbiddenPaths`, `workingDirectory`, `canUseSubagents`, `maxDelegationDepth`, and `risk`.
4. Create and dispatch it with `taskctl.mjs`. Read [references/protocol.md](references/protocol.md) before the first task and [references/direct-transport.md](references/direct-transport.md) before the first headless dispatch.
5. Keep the task workspace isolated. Never let Codex and WorkBuddy edit the same file concurrently. Keep `maxDelegationDepth` at `0` unless the task packet explicitly permits a bounded child.

When installing or explaining the optional multi-agent stack, read [references/agent-stack.md](references/agent-stack.md). Keep Spark and Luna as native Codex child agents, DeepSeek Harness and WorkBuddy as external executors, Qwen as a vision adjunct, and Sol as final acceptor.

Example:

```sh
node skill/workbuddy-orchestrator/scripts/taskctl.mjs create --workspace /path/to/workspace --spec /path/to/spec.json
node skill/workbuddy-orchestrator/scripts/taskctl.mjs dispatch-worker --workspace /path/to/workspace --id TASK_ID --worker workbuddy-account --config ~/.codex/workbuddy-orchestrator/workers.json
node skill/workbuddy-orchestrator/scripts/taskctl.mjs show --workspace /path/to/workspace --id TASK_ID
```

## Acceptance

Poll `show` until the worker is terminal, then independently inspect the changed files and `result.json`. Run:

```sh
node skill/workbuddy-orchestrator/scripts/taskctl.mjs validate --workspace /path/to/workspace --id TASK_ID
node skill/workbuddy-orchestrator/scripts/taskctl.mjs set-status --workspace /path/to/workspace --id TASK_ID --status accepted --actor codex
```

Run the second command only after every acceptance criterion, path boundary, test, and artifact check passes. A failed, missing, malformed, or out-of-scope result must remain failed/rejected and be reported honestly. Never expose credentials or internal prompts in the final response.
