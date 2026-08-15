# Routing policy

## Auto priority

1. Keep planning, architecture, ambiguity, secrets, payment, publication, deletion, permission changes, integration, and final acceptance with Sol.
2. Prefer a healthy, explicitly authorized WorkBuddy route for bounded, independently testable execution when its current entitlement or per-run cost is acceptable.
3. Prefer DeepSeek Harness for substantial isolated coding when its API cost is acceptable.
4. Prefer `spark_worker` for a small code patch, targeted fix, or focused test with explicit file ownership and low latency value.
5. Prefer `luna_worker` for broader bounded Codex-native implementation, investigation, or preparation.
6. Use Qwen only when real image understanding matters. Pass concise observations to the selected executor and label them as indirect evidence.

## Cost labels

| Route | Cost source |
|---|---|
| Sol | current Codex task/quota |
| Spark | Codex child-agent quota |
| Luna | Codex child-agent quota |
| DeepSeek Harness | configured DeepSeek API balance |
| WorkBuddy | WorkBuddy entitlement or credits |
| Qwen vision | configured Qwen provider balance |

Do not call a route free without current evidence. The WorkBuddy headless CLI may expose per-run consumption but not a supported remaining-balance command.

## Vision boundary

DeepSeek does not receive image bytes merely because Qwen is listed in this router. A verified local-path design requires a Harness preset with a one-shot `qwen_vision` tool, Qwen `read_image`, text-only return, no write or shell tools, and an actual image-call smoke. Automatic pasted-attachment routing is a separate bridge and remains experimental until independently accepted on the target Harness revision.

## Acceptance

Report route, scope, artifact paths, tests, target-environment evidence, final Sol status, and observed cost source. Dispatch, process exit, UI visibility, or a worker's success claim is not final acceptance.
