# Windows Hermes Qwen vision handoff

Use the maintained public project at <https://github.com/banana2004828/qwen-vision-workflow> when WorkBuddy must install, repair, share, verify, or roll back Qwen vision for Hermes on Windows 10/11. The workflow keeps Hermes's existing primary text model, configures the native auxiliary-vision path, offers a pinned optional Qwen-MM layer, and blocks unknown or locally modified DeepSeek Harness versions instead of overwriting them.

This target is Windows-only. A Codex/WorkBuddy controller running on macOS may prepare or dispatch the task, but the CMD installer and target-environment acceptance must run on the intended Windows Hermes computer.

## Handoff contract

1. Obtain a tagged release ZIP and its `.sha256` sidecar from the public repository. Verify the SHA-256 before extraction. A source checkout is acceptable for development, but a release handoff should use the published artifact.
2. Keep the extracted folder isolated. Give WorkBuddy write access only to that folder and the explicitly selected Hermes target; do not allow unrelated account, browser, project, or home-directory paths.
3. Run `安装千问视觉.cmd` for the ordinary interactive Windows path. For a headless WorkBuddy task, call `qvw.ps1` directly so its JSON result and exit code can be captured:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qvw.ps1 -Action doctor -Json -NonInteractive
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qvw.ps1 -Action install -Json -NonInteractive
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qvw.ps1 -Action status -Json -NonInteractive
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qvw.ps1 -Action verify -Json -NonInteractive
   ```

4. Treat `installed` as configuration readback only. WorkBuddy must return the command exits, structured JSON, receipt path, before/after hashes for protected configuration, and any blocker. Codex then independently checks those artifacts on the Windows target before accepting the task.
5. A real image call may consume provider balance. Run it only after the user explicitly authorizes that paid call, using a non-sensitive local PNG:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qvw.ps1 -Action verify -ConfirmPaidCalls -ImagePath <png> -Json -NonInteractive
   ```

6. If Qwen-MM OCR, grounding, or explicit vision chat is required, install it separately with `-Action qwen-mm`. Its connection and tool-count check is not a substitute for a real image result.
7. For rollback, use the exact receipt returned by installation and require a verified result:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\qvw.ps1 -Action rollback -Receipt <receipt-path> -Json -NonInteractive
   ```

## Acceptance boundary

WorkBuddy完成派发、下载、安装或返回消息，都不等于目标环境验收。Codex must independently verify the selected Hermes version and capability, unchanged primary model, protected configuration readback, Qwen-MM connection when requested, exact rollback receipt, and the real image evidence only when its paid call was authorized. A blocked DeepSeek Harness adapter may coexist with an accepted Hermes native path; report the two components separately.

不得把 API Key、密钥、Cookie、Token、密码、`.env` 内容或业务图片写入任务提示词、命令行、日志、收据、诊断包或 Git。Let the workflow read an already supported secure credential source; if credentials, login, authorization, or paid-call consent are missing, stop and report the blocker instead of asking WorkBuddy to reveal them.
