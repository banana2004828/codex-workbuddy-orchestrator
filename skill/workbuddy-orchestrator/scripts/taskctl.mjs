#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  realpath,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_CONFIG = path.join(os.homedir(), ".codex", "workbuddy-orchestrator", "workers.json");
const WORKER_TYPES = new Set(["codebuddy-cli"]);
const STATUSES = new Set([
  "queued",
  "dispatched",
  "running",
  "completed",
  "failed",
  "accepted",
  "rejected",
]);
const TRANSITIONS = {
  queued: new Set(["dispatched", "failed"]),
  dispatched: new Set(["running", "failed"]),
  running: new Set(["completed", "failed"]),
  completed: new Set(["accepted", "rejected"]),
  rejected: new Set(["running", "failed"]),
  failed: new Set([]),
  accepted: new Set([]),
};

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function normalizeRelativePath(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`${label} must stay inside the workspace: ${value}`);
  }
  return normalized || ".";
}

function validateSpec(input) {
  const spec = structuredClone(input);
  if (typeof spec.title !== "string" || !spec.title.trim()) throw new Error("title is required");
  if (typeof spec.objective !== "string" || !spec.objective.trim()) throw new Error("objective is required");
  if (!Array.isArray(spec.acceptanceCriteria) || spec.acceptanceCriteria.length === 0) {
    throw new Error("acceptanceCriteria must be a non-empty array");
  }
  if (!Array.isArray(spec.allowedPaths) || spec.allowedPaths.length === 0) {
    throw new Error("allowedPaths must be a non-empty array");
  }
  spec.acceptanceCriteria = spec.acceptanceCriteria.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`acceptanceCriteria[${index}] must be a non-empty string`);
    return item.trim();
  });
  spec.allowedPaths = spec.allowedPaths.map((item, index) => normalizeRelativePath(item, `allowedPaths[${index}]`));
  spec.forbiddenPaths = (spec.forbiddenPaths ?? []).map((item, index) => normalizeRelativePath(item, `forbiddenPaths[${index}]`));
  spec.workingDirectory = normalizeRelativePath(spec.workingDirectory ?? ".", "workingDirectory");
  spec.canUseSubagents = spec.canUseSubagents === true;
  spec.maxDelegationDepth = Number(spec.maxDelegationDepth ?? 0);
  if (!Number.isInteger(spec.maxDelegationDepth) || spec.maxDelegationDepth < 0 || spec.maxDelegationDepth > 2) {
    throw new Error("maxDelegationDepth must be an integer from 0 to 2");
  }
  spec.risk = spec.risk ?? "low";
  if (!["low", "medium", "high"].includes(spec.risk)) throw new Error("risk must be low, medium, or high");
  if (spec.risk === "high") throw new Error("high-risk tasks cannot be delegated");
  spec.title = spec.title.trim();
  spec.objective = spec.objective.trim();
  spec.notes = typeof spec.notes === "string" ? spec.notes.trim() : "";
  return spec;
}

function makeTaskId(now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `wb-${stamp}-${randomBytes(3).toString("hex")}`;
}

function taskRoot(workspace) {
  return path.join(workspace, ".workbuddy-orchestrator", "tasks");
}

function taskDirectory(workspace, id) {
  if (!/^wb-\d{14}-[a-f0-9]{6}$/.test(id)) throw new Error(`Invalid task id: ${id}`);
  return path.join(taskRoot(workspace), id);
}

async function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function executionWorkspaceFor(workspace) {
  const resolved = path.resolve(workspace);
  if (!/[^\x00-\x7F]/.test(resolved)) return resolved;
  const aliasesRoot = path.join(os.tmpdir(), "codex-worker-workspaces");
  const digest = createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  const alias = path.join(aliasesRoot, `ws-${digest}`);
  await mkdir(aliasesRoot, { recursive: true });
  try {
    const [actualTarget, expectedTarget] = await Promise.all([realpath(alias), realpath(resolved)]);
    if (actualTarget.toLowerCase() !== expectedTarget.toLowerCase()) throw new Error(`Workspace alias points elsewhere: ${alias}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await symlink(resolved, alias, process.platform === "win32" ? "junction" : "dir");
  }
  return alias;
}

function markdownList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

function renderTaskMarkdown(request) {
  const spec = request.spec;
  return `# ${spec.title}\n\nTask ID: \`${request.id}\`\n\n## Objective\n\n${spec.objective}\n\n## Acceptance criteria\n\n${markdownList(spec.acceptanceCriteria)}\n\n## Allowed paths\n\n${markdownList(spec.allowedPaths)}\n\n## Forbidden paths\n\n${markdownList(spec.forbiddenPaths)}\n\n## Execution boundary\n\n- Working directory: \`${spec.workingDirectory}\`\n- Risk: \`${spec.risk}\`\n- Subagents allowed: \`${spec.canUseSubagents}\`\n- Maximum delegation depth: \`${spec.maxDelegationDepth}\`\n- Never delete data, send external messages, publish, change permissions, or handle credentials. Stop when scope must expand.\n\n## Notes\n\n${spec.notes || "(none)"}\n\n## Deliverable\n\nCopy \`result-template.json\` to \`result.json\` and fill it with the real result. Keep all paths relative to the workspace.\n`;
}

function resultTemplate(id) {
  return {
    taskId: id,
    status: "completed",
    summary: "",
    filesChanged: [],
    commandsRun: [],
    tests: [],
    blockers: [],
    followUps: [],
  };
}

export async function createTask(workspace, specPath) {
  const resolvedWorkspace = path.resolve(workspace);
  const spec = validateSpec(await readJson(path.resolve(specPath)));
  const id = makeTaskId();
  const directory = taskDirectory(resolvedWorkspace, id);
  await mkdir(directory, { recursive: false });
  const now = new Date().toISOString();
  const request = { protocolVersion: "1.0", id, createdAt: now, workspace: resolvedWorkspace, spec };
  await atomicWriteJson(path.join(directory, "request.json"), request);
  await atomicWriteJson(path.join(directory, "state.json"), {
    taskId: id,
    status: "queued",
    updatedAt: now,
    history: [{ status: "queued", at: now, actor: "codex" }],
  });
  await atomicWriteJson(path.join(directory, "result-template.json"), resultTemplate(id));
  await writeFile(path.join(directory, "TASK.md"), renderTaskMarkdown(request), "utf8");
  return { id, directory, status: "queued" };
}

export async function setStatus(workspace, id, nextStatus, actor = "codex") {
  if (!STATUSES.has(nextStatus)) throw new Error(`Invalid status: ${nextStatus}`);
  const directory = taskDirectory(path.resolve(workspace), id);
  const statePath = path.join(directory, "state.json");
  const state = await readJson(statePath);
  if (state.status !== nextStatus && !TRANSITIONS[state.status]?.has(nextStatus)) throw new Error(`Invalid transition: ${state.status} -> ${nextStatus}`);
  if (nextStatus === "accepted" && actor !== "codex") throw new Error("Only Codex may accept a task");
  const now = new Date().toISOString();
  state.status = nextStatus;
  state.updatedAt = now;
  state.history.push({ status: nextStatus, at: now, actor });
  await atomicWriteJson(statePath, state);
  return state;
}

export async function showTask(workspace, id) {
  const directory = taskDirectory(path.resolve(workspace), id);
  const [request, state] = await Promise.all([
    readJson(path.join(directory, "request.json")),
    readJson(path.join(directory, "state.json")),
  ]);
  const resultPath = path.join(directory, "result.json");
  return {
    request,
    state,
    result: (await fileExists(resultPath)) ? await readJson(resultPath) : null,
    directory,
  };
}

async function listTasks(workspace) {
  const root = taskRoot(path.resolve(workspace));
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    try {
      const state = await readJson(path.join(root, entry.name, "state.json"));
      const request = await readJson(path.join(root, entry.name, "request.json"));
      tasks.push({ id: entry.name, status: state.status, title: request.spec.title, updatedAt: state.updatedAt });
    } catch {
      tasks.push({ id: entry.name, status: "invalid", title: "", updatedAt: "" });
    }
  }
  return tasks;
}

function globToRegExp(pattern) {
  const normalized = pattern.replaceAll("\\", "/");
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else {
      expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  if (normalized.endsWith("/")) expression += ".*";
  return new RegExp(`^${expression}$`);
}

function matchesAny(filePath, patterns) {
  const normalized = normalizeRelativePath(filePath, "filesChanged entry");
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export async function validateResult(workspace, id) {
  const task = await showTask(workspace, id);
  const errors = [];
  const warnings = [];
  const result = task.result;
  if (!result) return { valid: false, errors: ["result.json does not exist"], warnings, taskId: id };
  if (result.taskId !== id) errors.push("result.taskId does not match");
  if (!["completed", "failed"].includes(result.status)) errors.push("result.status must be completed or failed");
  if (typeof result.summary !== "string" || !result.summary.trim()) errors.push("result.summary is required");
  for (const key of ["filesChanged", "commandsRun", "tests", "blockers", "followUps"]) {
    if (!Array.isArray(result[key])) errors.push(`result.${key} must be an array`);
  }
  if (Array.isArray(result.filesChanged)) {
    for (const file of result.filesChanged) {
      let normalized;
      try {
        normalized = normalizeRelativePath(file, "filesChanged entry");
      } catch (error) {
        errors.push(error.message);
        continue;
      }
      if (!matchesAny(normalized, task.request.spec.allowedPaths)) errors.push(`out-of-scope file: ${normalized}`);
      if (matchesAny(normalized, task.request.spec.forbiddenPaths)) errors.push(`forbidden file: ${normalized}`);
    }
  }
  if (task.state.status !== result.status) warnings.push(`state is ${task.state.status} but result reports ${result.status}`);
  if (result.status === "completed" && result.blockers?.length) warnings.push("completed result contains blockers");
  return { valid: errors.length === 0, errors, warnings, taskId: id };
}

function expandConfigPath(value) {
  if (typeof value !== "string") return value;
  const expanded = value
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/%([^%]+)%/g, (match, key) => process.env[key] ?? match)
    .replace(/\$\{([^}]+)\}/g, (match, key) => process.env[key] ?? match);
  return path.resolve(expanded);
}

async function validateWorker(worker, name, defaults = {}) {
  const normalized = { ...defaults, ...worker, name };
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error(`Invalid worker name: ${name}`);
  if (!WORKER_TYPES.has(normalized.type)) throw new Error(`Worker ${name} has unsupported type: ${normalized.type}`);
  normalized.enabled = normalized.enabled !== false;
  normalized.maxConcurrent = Number(normalized.maxConcurrent ?? 1);
  if (!Number.isInteger(normalized.maxConcurrent) || normalized.maxConcurrent < 1 || normalized.maxConcurrent > 8) throw new Error(`Worker ${name} maxConcurrent must be an integer from 1 to 8`);
  normalized.nodePath = expandConfigPath(normalized.nodePath);
  normalized.cliPath = expandConfigPath(normalized.cliPath);
  if (!normalized.nodePath || !(await fileExists(normalized.nodePath))) throw new Error(`Worker ${name} nodePath does not exist: ${normalized.nodePath ?? ""}`);
  if (!normalized.cliPath || !(await fileExists(normalized.cliPath))) throw new Error(`Worker ${name} cliPath does not exist: ${normalized.cliPath ?? ""}`);
  if (normalized.configDir) normalized.configDir = expandConfigPath(normalized.configDir);
  normalized.model = normalized.model ?? "auto";
  normalized.permissionMode = normalized.permissionMode ?? "acceptEdits";
  normalized.maxTurns = Number(normalized.maxTurns ?? 20);
  normalized.tools = normalized.tools ?? ["Read", "Write", "Edit", "Glob", "Grep"];
  if (!Number.isInteger(normalized.maxTurns) || normalized.maxTurns < 1 || normalized.maxTurns > 100) throw new Error(`Worker ${name} maxTurns must be an integer from 1 to 100`);
  if (!Array.isArray(normalized.tools) || normalized.tools.some((tool) => typeof tool !== "string")) throw new Error(`Worker ${name} tools must be an array of strings`);
  if (normalized.permissionMode === "bypassPermissions") throw new Error(`Worker ${name} may not use bypassPermissions`);
  return normalized;
}

async function loadWorkersConfig(configPath = DEFAULT_CONFIG) {
  const resolved = path.resolve(configPath);
  const raw = await readJson(resolved);
  if (!raw.workers || typeof raw.workers !== "object" || Array.isArray(raw.workers)) throw new Error(`workers config must contain a workers object: ${resolved}`);
  const defaults = raw.defaults && typeof raw.defaults === "object" ? raw.defaults : {};
  const workers = {};
  for (const [name, value] of Object.entries(raw.workers)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Worker ${name} must be an object`);
    workers[name] = await validateWorker(value, name, defaults);
  }
  if (!Object.keys(workers).length) throw new Error("workers config must not be empty");
  return { version: Number(raw.version ?? 2), configPath: resolved, workers };
}

async function getWorker(configPath, workerName) {
  const config = await loadWorkersConfig(configPath);
  const worker = config.workers[workerName];
  if (!worker) throw new Error(`Unknown worker: ${workerName}`);
  if (!worker.enabled) throw new Error(`Worker is disabled: ${workerName}`);
  return { config, worker };
}

export async function doctorWorkers(configPath = DEFAULT_CONFIG) {
  const config = await loadWorkersConfig(configPath);
  return {
    available: true,
    configPath: config.configPath,
    workers: Object.values(config.workers).map((worker) => ({
      name: worker.name,
      type: worker.type,
      enabled: worker.enabled,
      maxConcurrent: worker.maxConcurrent,
      model: worker.model,
      configDir: worker.configDir,
    })),
  };
}

function renderDirectPrompt(workspace, id, executionWorkspace) {
  const directory = taskDirectory(executionWorkspace, id);
  return `You are an external execution agent for a bounded task delegated by Codex.\n\nRead these files before acting:\n1. ${path.join(directory, "TASK.md")}\n2. ${path.join(directory, "request.json")}\n\nWorkspace: ${executionWorkspace}\nTask ID: ${id}\n\nFollow allowed paths, forbidden paths, acceptance criteria, and delegation depth exactly. Do not alter the task contract. Do not delete data, send external messages, publish content, change permissions, or handle credentials. Stop and report a blocker if scope must expand.\n\nRun the task directly without asking the user. Do not modify request.json, TASK.md, or state.json. On completion create result.json in the task directory using result-template.json; on failure create result.json with status failed.`;
}

function collectProcess(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function failTask(workspace, id, summary, details, actor) {
  const directory = taskDirectory(workspace, id);
  const resultPath = path.join(directory, "result.json");
  if (!(await fileExists(resultPath))) {
    await atomicWriteJson(resultPath, {
      taskId: id,
      status: "failed",
      summary,
      filesChanged: [],
      commandsRun: [],
      tests: [],
      blockers: [details],
      followUps: [],
    });
  }
  const task = await showTask(workspace, id);
  if (task.state.status === "running") await setStatus(workspace, id, "failed", actor);
}

async function runDirectWorker(workspace, id, configPath, workerName) {
  const directory = taskDirectory(workspace, id);
  const executionWorkspace = await executionWorkspaceFor(workspace);
  const { worker } = await getWorker(configPath, workerName);
  const actor = `worker:${workerName}`;
  const task = await showTask(workspace, id);
  if (task.state.status !== "dispatched") throw new Error(`Worker expected dispatched state, found ${task.state.status}`);
  await setStatus(workspace, id, "running", actor);
  const prompt = renderDirectPrompt(workspace, id, executionWorkspace);
  const args = [
    worker.cliPath,
    "--print",
    "--output-format",
    "json",
    "--permission-mode",
    worker.permissionMode,
    "--tools",
    worker.tools.join(","),
    "--allowedTools",
    worker.tools.join(","),
    "--max-turns",
    String(worker.maxTurns),
    "--model",
    worker.model,
    prompt,
  ];
  const startedAt = new Date().toISOString();
  const child = spawn(worker.nodePath, args, {
    cwd: executionWorkspace,
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(worker.configDir ? { CODEBUDDY_CONFIG_DIR: worker.configDir } : {}) },
  });
  await atomicWriteJson(path.join(directory, "direct-process.json"), {
    taskId: id,
    workerPid: process.pid,
    agentPid: child.pid,
    executionWorkspace,
    startedAt,
  });
  let execution;
  try {
    execution = await collectProcess(child);
  } catch (error) {
    await failTask(workspace, id, "Worker process failed to start.", error.message, actor);
    throw error;
  }
  await writeFile(path.join(directory, "direct.stdout.json"), execution.stdout, "utf8");
  await writeFile(path.join(directory, "direct.stderr.log"), execution.stderr, "utf8");
  await atomicWriteJson(path.join(directory, "direct-exit.json"), {
    taskId: id,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: execution.code,
    signal: execution.signal,
  });
  if (execution.code !== 0) {
    await failTask(workspace, id, `Worker process exited with code ${execution.code}.`, execution.stderr.trim() || "No stderr was returned.", actor);
    return;
  }
  const resultPath = path.join(directory, "result.json");
  if (!(await fileExists(resultPath))) {
    await failTask(workspace, id, "Worker returned without result.json.", "Inspect direct.stdout.json for the agent response.", actor);
    return;
  }
  const result = await readJson(resultPath);
  const current = await showTask(workspace, id);
  if (current.state.status === "running") await setStatus(workspace, id, result.status === "completed" ? "completed" : "failed", actor);
}

async function activeAssignments(workspace, workerName) {
  const entries = await listTasks(workspace);
  const active = [];
  for (const entry of entries) {
    if (!["dispatched", "running"].includes(entry.status)) continue;
    const dispatchPath = path.join(taskDirectory(workspace, entry.id), "dispatch.json");
    if (!(await fileExists(dispatchPath))) continue;
    const dispatch = await readJson(dispatchPath);
    if (dispatch.worker === workerName) active.push({ id: entry.id, status: entry.status, title: entry.title });
  }
  return active;
}

async function dispatchCliWorker(workspace, id, config, worker) {
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [scriptPath, "_worker-cli", "--workspace", workspace, "--id", id, "--config", config.configPath, "--worker", worker.name], {
    cwd: workspace,
    // Keep the launcher independent of the caller's event loop without putting
    // it in a detached Windows process group (which can be reaped by test
    // runners or short-lived parent shells before the task starts).
    detached: false,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
  return {
    taskId: id,
    worker: worker.name,
    transport: "codebuddy-headless-cli",
    workerPid: child.pid,
    dispatchedAt: new Date().toISOString(),
    configPath: config.configPath,
  };
}

async function dispatchWorker(workspace, id, configPath, workerName) {
  const resolvedWorkspace = path.resolve(workspace);
  const { config, worker } = await getWorker(configPath, workerName);
  const task = await showTask(resolvedWorkspace, id);
  if (task.state.status !== "queued") throw new Error(`Worker dispatch expected queued state, found ${task.state.status}`);
  const active = await activeAssignments(resolvedWorkspace, worker.name);
  if (active.length >= worker.maxConcurrent) throw new Error(`Worker ${worker.name} is at capacity (${active.length}/${worker.maxConcurrent})`);
  await setStatus(resolvedWorkspace, id, "dispatched", "codex");
  let dispatch;
  try {
    dispatch = await dispatchCliWorker(resolvedWorkspace, id, config, worker);
  } catch (error) {
    await setStatus(resolvedWorkspace, id, "failed", `worker:${worker.name}`);
    throw error;
  }
  await atomicWriteJson(path.join(taskDirectory(resolvedWorkspace, id), "dispatch.json"), dispatch);
  return dispatch;
}

async function reconcileTask(workspace, id) {
  let task = await showTask(workspace, id);
  if (!task.result) return { taskId: id, reconciled: false, reason: "result.json does not exist", status: task.state.status };
  if (!["completed", "failed"].includes(task.result.status)) throw new Error(`result.status must be completed or failed, found ${task.result.status}`);
  let reconciled = false;
  if (task.state.status === "dispatched") {
    await setStatus(workspace, id, "running", "codex:reconcile");
    task = await showTask(workspace, id);
    reconciled = true;
  }
  if (task.state.status === "running") {
    await setStatus(workspace, id, task.result.status, "codex:reconcile");
    reconciled = true;
  }
  task = await showTask(workspace, id);
  return { taskId: id, reconciled, status: task.state.status, validation: await validateResult(workspace, id) };
}

function required(options, name) {
  if (!options[name]) throw new Error(`--${name} is required`);
  return options[name];
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!command || command === "help") {
    return { usage: [
      "create --workspace PATH --spec FILE",
      "show --workspace PATH --id ID",
      "list --workspace PATH",
      "set-status --workspace PATH --id ID --status STATUS [--actor codex]",
      "validate --workspace PATH --id ID",
      "doctor-workers [--config FILE]",
      "dispatch-worker --workspace PATH --id ID --worker NAME [--config FILE]",
      "reconcile --workspace PATH --id ID",
    ] };
  }
  if (command === "doctor-workers") return doctorWorkers(options.config ?? DEFAULT_CONFIG);
  const workspace = path.resolve(required(options, "workspace"));
  await mkdir(taskRoot(workspace), { recursive: true });
  if (command === "init") return { workspace, taskRoot: taskRoot(workspace) };
  if (command === "create") return createTask(workspace, required(options, "spec"));
  if (command === "show") return showTask(workspace, required(options, "id"));
  if (command === "list") return listTasks(workspace);
  if (command === "set-status") return setStatus(workspace, required(options, "id"), required(options, "status"), options.actor ?? "codex");
  if (command === "validate") return validateResult(workspace, required(options, "id"));
  if (command === "reconcile") return reconcileTask(workspace, required(options, "id"));
  if (command === "dispatch-worker") return dispatchWorker(workspace, required(options, "id"), options.config ?? DEFAULT_CONFIG, required(options, "worker"));
  if (command === "_worker-cli") {
    await runDirectWorker(workspace, required(options, "id"), options.config ?? DEFAULT_CONFIG, required(options, "worker"));
    return { finished: true, taskId: options.id, worker: options.worker };
  }
  throw new Error(`Unknown command: ${command}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
