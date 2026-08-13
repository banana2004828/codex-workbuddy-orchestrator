#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const validator = path.join(codexHome, "skills", ".system", "skill-creator", "scripts", "quick_validate.py");
const skill = path.resolve("skill", "workbuddy-orchestrator");

if (!(await exists(validator))) {
  process.stderr.write(`skill-creator validator was not found at ${validator}\n`);
  process.stderr.write("Install or enable the built-in skill-creator, then run npm run validate-skill again.\n");
  process.exit(1);
}

const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
let lastError = null;
for (const executable of candidates) {
  const args = executable === "py" ? ["-3", validator, skill] : [validator, skill];
  const result = spawnSync(executable, args, { stdio: "inherit", windowsHide: true });
  if (!result.error) process.exit(result.status ?? 1);
  lastError = result.error;
}

process.stderr.write(`Python 3 could not be started: ${lastError?.message ?? "unknown error"}\n`);
process.exit(1);
