#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

async function exists(filePath) { try { await access(filePath); return true; } catch { return false; } }

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") { options.dryRun = true; continue; }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (!options.task) throw new Error("--task is required");
  if (!options["working-directory"]) throw new Error("--working-directory is required");
  const workingDirectory = path.resolve(options["working-directory"]);
  const harnessRootValue = options["harness-root"] ?? process.env.DEEPSEEK_HARNESS_ROOT;
  if (!harnessRootValue) throw new Error("--harness-root or DEEPSEEK_HARNESS_ROOT is required");
  const harnessRoot = path.resolve(harnessRootValue);
  const binPath = path.join(harnessRoot, "apps", "cli", "lib", "bin.js");
  if (!(await exists(workingDirectory))) throw new Error(`Working directory does not exist: ${workingDirectory}`);
  if (!(await exists(binPath))) throw new Error(`DeepSeek Harness CLI is missing: ${binPath}`);
  const taskId = options["task-id"] ?? `dsh-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error("task-id contains unsafe characters");
  const profile = options.profile ?? "headless";
  const runDir = path.join(workingDirectory, ".multi-agent-router", "runs", taskId);
  const preview = { taskId, route: "deepseek-harness", profile, workingDirectory, harnessRoot, costSource: "DeepSeek API balance" };
  if (options.dryRun) { process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`); return preview; }
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [binPath, "--profile", profile, `[SOL-BRIDGE][${taskId}] ${options.task}`], {
    cwd: workingDirectory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = await collect(child);
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  await writeFile(stdoutPath, result.stdout, { encoding: "utf8", mode: 0o600 });
  await writeFile(stderrPath, result.stderr, { encoding: "utf8", mode: 0o600 });
  const meta = { ...preview, startedAt, endedAt: new Date().toISOString(), exitCode: result.code, stdoutPath, stderrPath };
  await writeFile(path.join(runDir, "run.json"), `${JSON.stringify(meta, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify(meta, null, 2)}\n`);
  if (result.code !== 0) process.exitCode = result.code ?? 1;
  return meta;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  try { await runCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
