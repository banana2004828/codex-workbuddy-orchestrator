# Headless CodeBuddy transport

The installer writes a version-2 workers file with named `codebuddy-cli` profiles. The stable transport invokes the bundled CLI through the configured Node executable:

```text
nodePath + cliPath --print --output-format json
```

`CODEBUDDY_CONFIG_DIR` is set to the selected account directory for the child process. The workers file stores only executable paths, `configDir`, a model name, bounded turns, and an allowlist such as `Read,Write,Edit,Glob,Grep`; it never stores tokens, cookies, API keys, or session contents. Do not use `--dangerously-skip-permissions` or `bypassPermissions`.

The WorkBuddy account is required. A CodeBuddy profile is optional and is generated only when its client/CLI and config directory are detected. TRAE is intentionally unsupported by this distribution and must not be added as a default or fallback worker.

For non-ASCII workspaces on Windows, `taskctl.mjs` creates and verifies a junction under `%TEMP%/codex-worker-workspaces`. On macOS it uses a verified temporary directory symlink. The source workspace is not copied or moved.

Headless dispatch is only a candidate result. Require a terminal task state, an actual `result.json`, path-safe changed files, independent tests, and a successful `taskctl validate` before Codex marks `accepted`.
