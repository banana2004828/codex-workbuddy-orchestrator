# WorkBuddy task protocol

Each task is stored below `<workspace>/.workbuddy-orchestrator/tasks/<task-id>/`:

```text
request.json
TASK.md
state.json
result-template.json
result.json                 # written by the worker
direct-process.json          # transport evidence
direct.stdout.json
direct.stderr.log
direct-exit.json
```

## Contract

Required spec fields are `title`, `objective`, a non-empty `acceptanceCriteria` list, and a non-empty `allowedPaths` list. Paths are workspace-relative and may not escape with `..`. Optional `forbiddenPaths`, `workingDirectory`, `canUseSubagents`, `maxDelegationDepth` (0-2), `risk` (`low`/`medium`), and `notes` are normalized by `taskctl.mjs`; high-risk work is rejected before dispatch.

Valid states are `queued`, `dispatched`, `running`, `completed`, `failed`, `accepted`, and `rejected`. Only Codex may move a completed task to `accepted`.

`result.json` must contain:

```json
{
  "taskId": "wb-20260813000000-abcdef",
  "status": "completed",
  "summary": "What was delivered",
  "filesChanged": ["relative/path"],
  "commandsRun": ["test command"],
  "tests": [{"name": "test", "status": "passed"}],
  "blockers": [],
  "followUps": []
}
```

The worker must fill the result even on failure, must not modify `request.json`, `TASK.md`, or `state.json`, and must stop when the scope needs expansion. Codex independently checks every file, criterion, test, and path before acceptance.
