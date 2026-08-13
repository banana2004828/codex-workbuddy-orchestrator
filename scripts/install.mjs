#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_NODE_MAJOR = 20;
const SMOKE_PROOF = "workbuddy-orchestrator-smoke-v1\n";
const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const installerDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(installerDirectory, "..");
const defaultTarget = path.join(os.homedir(), ".codex", "skills", "workbuddy-orchestrator");
const defaultConfigPath = path.join(os.homedir(), ".codex", "workbuddy-orchestrator", "workers.json");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function expandPath(value, home = os.homedir(), env = process.env) {
  if (typeof value !== "string") return value;
  return path.resolve(
    value
      .replace(/^~(?=$|[\\/])/, home)
      .replace(/%([^%]+)%/g, (match, key) => env[key] ?? match)
      .replace(/\$\{([^}]+)\}/g, (match, key) => env[key] ?? match),
  );
}

function firstEnvironment(env, names) {
  return names.map((name) => env[name]).find((value) => typeof value === "string" && value.trim()) ?? null;
}

function standardAppCandidates(platform, home, env = process.env) {
  if (platform === "darwin") {
    return [
      "/Applications/WorkBuddy.app",
      path.join(home, "Applications", "WorkBuddy.app"),
      path.join(home, "Applications", "WorkBuddy CN.app"),
      "/Applications/WorkBuddy CN.app",
    ];
  }
  return [
    path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "WorkBuddy", "WorkBuddy.exe"),
    path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "WorkBuddy", "WorkBuddy.exe"),
    path.join(env.ProgramFiles ?? "C:\\Program Files", "WorkBuddy", "WorkBuddy.exe"),
    path.join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "WorkBuddy", "WorkBuddy.exe"),
  ];
}

function standardCodeBuddyAppCandidates(platform, home, env = process.env) {
  if (platform === "darwin") {
    return [
      "/Applications/CodeBuddy.app",
      path.join(home, "Applications", "CodeBuddy.app"),
      "/Applications/CodeBuddy CN.app",
      path.join(home, "Applications", "CodeBuddy CN.app"),
    ];
  }
  return [
    path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "CodeBuddy", "CodeBuddy.exe"),
    path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "CodeBuddy CN", "CodeBuddy CN.exe"),
    path.join(env.ProgramFiles ?? "C:\\Program Files", "CodeBuddy", "CodeBuddy.exe"),
  ];
}

function cliCandidatesFromApp(appPath, platform) {
  if (!appPath) return [];
  const appRoot = platform === "darwin" ? appPath : path.dirname(appPath);
  const relative = platform === "darwin"
    ? [
        ["Contents", "Resources", "app.asar.unpacked", "cli", "dist", "codebuddy.js"],
        ["Contents", "Resources", "app.asar.unpacked", "cli", "bin", "codebuddy"],
        ["Contents", "Resources", "app.asar.unpacked", "cli", "bin", "codebuddy-cli"],
        ["Contents", "Resources", "cli", "bin", "codebuddy"],
        ["Contents", "Resources", "app.asar.unpacked", "cli", "bin", "codebuddy.js"],
      ]
    : [
        ["resources", "app.asar.unpacked", "cli", "dist", "codebuddy.js"],
        ["resources", "app.asar.unpacked", "cli", "bin", "codebuddy"],
        ["resources", "app.asar.unpacked", "cli", "bin", "codebuddy.js"],
        ["resources", "app.asar.unpacked", "cli", "bin", "codebuddy.cmd"],
        ["resources", "cli", "bin", "codebuddy"],
        ["resources", "cli", "bin", "codebuddy.cmd"],
      ];
  return relative.map((parts) => path.join(appRoot, ...parts));
}

async function findFirst(paths) {
  for (const candidate of paths.filter(Boolean)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function findOnPath(names, env = process.env, platform = process.platform) {
  const pathEntries = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  // taskctl starts the CLI through Node. Windows npm shims (`codebuddy` and
  // `codebuddy.cmd`) are wrappers rather than JavaScript entry files, so do
  // not mistake them for a runnable Node entry.
  const suffixes = platform === "win32" ? [".js"] : [""];
  for (const entry of pathEntries) {
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidate = path.join(entry, `${name}${suffix}`);
        if (await exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

async function detectOne({ platform, home, env, appOverride, cliOverride, configOverride, appCandidates, cliCandidates, defaultAppCandidates, defaultConfigDir }) {
  const appPath = await findFirst(appOverride ? [expandPath(appOverride, home, env)] : appCandidates ?? defaultAppCandidates);
  const derived = cliCandidatesFromApp(appPath, platform);
  const cliPath = await findFirst(
    cliOverride
      ? [expandPath(cliOverride, home, env)]
      : [...(cliCandidates ?? []), ...derived, await findOnPath(["codebuddy", "codebuddy-cli"], env, platform)],
  );
  const configDir = expandPath(configOverride ?? defaultConfigDir, home, env);
  return {
    appPath,
    cliPath,
    configDir,
    configDirExists: await isDirectory(configDir),
  };
}

/** Detect application/CLI paths without reading account files or credentials. */
export async function detectPrograms(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const workbuddy = await detectOne({
    platform,
    home,
    env,
    appOverride: options.workbuddyApp ?? firstEnvironment(env, ["WB_WORKBUDDY_APP", "WORKBUDDY_APP_PATH"]),
    cliOverride: options.workbuddyCli ?? firstEnvironment(env, ["WB_WORKBUDDY_CLI", "WORKBUDDY_CLI_PATH"]),
    configOverride: options.workbuddyConfigDir ?? firstEnvironment(env, ["WB_WORKBUDDY_CONFIG_DIR", "WORKBUDDY_CONFIG_DIR"]),
    appCandidates: options.workbuddyAppCandidates,
    cliCandidates: options.workbuddyCliCandidates,
    defaultAppCandidates: standardAppCandidates(platform, home, env),
    defaultConfigDir: platform === "darwin" || platform === "win32" ? path.join(home, ".workbuddy") : path.join(home, ".workbuddy"),
  });
  const codebuddyCandidate = await detectOne({
    platform,
    home,
    env,
    appOverride: options.codebuddyApp ?? firstEnvironment(env, ["WB_CODEBUDDY_APP", "CODEBUDDY_APP_PATH"]),
    cliOverride: options.codebuddyCli ?? firstEnvironment(env, ["WB_CODEBUDDY_CLI", "CODEBUDDY_CLI_PATH"]),
    configOverride: options.codebuddyConfigDir ?? firstEnvironment(env, ["WB_CODEBUDDY_CONFIG_DIR", "CODEBUDDY_CONFIG_DIR"]),
    appCandidates: options.codebuddyAppCandidates,
    cliCandidates: options.codebuddyCliCandidates,
    defaultAppCandidates: standardCodeBuddyAppCandidates(platform, home, env),
    defaultConfigDir: path.join(home, ".codebuddy"),
  });
  const codebuddy = codebuddyCandidate.cliPath && codebuddyCandidate.configDirExists
    ? codebuddyCandidate
    : null;
  return {
    platform,
    home,
    workbuddy,
    codebuddy,
    optionalCodebuddyReason: codebuddy ? null : "CodeBuddy is enabled only when its CLI and configDir are both detected.",
  };
}

export function validateNodeVersion(nodePath = process.execPath, minimumMajor = MIN_NODE_MAJOR) {
  const result = spawnSync(nodePath, ["--version"], { encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(`Cannot execute Node at ${nodePath}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Node version check failed for ${nodePath}: ${String(result.stderr).trim()}`);
  const versionText = String(result.stdout).trim();
  const match = versionText.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) throw new Error(`Unable to parse Node version from ${nodePath}: ${versionText}`);
  const major = Number(match[1]);
  if (major < minimumMajor) throw new Error(`Node ${minimumMajor}+ is required; ${nodePath} reports ${versionText}`);
  return { nodePath: path.resolve(nodePath), version: versionText, major, minimumMajor };
}

export function buildWorkersConfig(detection, options = {}) {
  if (!detection?.workbuddy?.cliPath) throw new Error("WorkBuddy headless CLI was not detected. Set --workbuddy-cli or WB_WORKBUDDY_CLI.");
  if (!detection.workbuddy.configDirExists) throw new Error(`WorkBuddy configDir does not exist: ${detection.workbuddy.configDir}. Set --workbuddy-config-dir or WB_WORKBUDDY_CONFIG_DIR after signing in.`);
  for (const [name, candidate] of [["WorkBuddy", detection.workbuddy], ["CodeBuddy", detection.codebuddy]]) {
    if (candidate?.cliPath && /\.(?:cmd|bat|exe)$/i.test(candidate.cliPath)) {
      throw new Error(`${name} CLI must point to its Node entry file (normally cli/dist/codebuddy.js), not ${candidate.cliPath}`);
    }
  }
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const defaults = {
    enabled: true,
    maxConcurrent: 1,
    model: "auto",
    permissionMode: "acceptEdits",
    maxTurns: 20,
    tools: DEFAULT_TOOLS,
  };
  const workers = {
    "workbuddy-account": {
      type: "codebuddy-cli",
      nodePath,
      cliPath: path.resolve(detection.workbuddy.cliPath),
      configDir: path.resolve(detection.workbuddy.configDir),
    },
  };
  if (detection.codebuddy?.cliPath && detection.codebuddy.configDirExists) {
    workers["codebuddy-account"] = {
      type: "codebuddy-cli",
      nodePath,
      cliPath: path.resolve(detection.codebuddy.cliPath),
      configDir: path.resolve(detection.codebuddy.configDir),
    };
  }
  const config = { version: 2, defaults, workers };
  const serialized = JSON.stringify(config);
  if (/(?:token|cookie|api[_-]?key|secret|password)/i.test(serialized)) throw new Error("Generated workers config contains a forbidden credential-like field");
  return config;
}

async function writePrivateJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
  try { await chmod(filePath, 0o600); } catch { /* chmod is not meaningful on every Windows volume */ }
}

/** Move an existing target aside before installation; returns a reversible backup path or null. */
export async function backupTarget(target) {
  const resolved = path.resolve(target);
  if (!(await exists(resolved))) return null;
  if (path.dirname(resolved) === resolved) throw new Error("Refusing to back up a filesystem root");
  const backup = `${resolved}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  await rename(resolved, backup);
  return backup;
}

async function writeOptionalSolLuna(sourceSkill, target) {
  const source = path.join(sourceSkill, "assets", "sol-luna", "AGENTS.optional.md");
  if (!(await exists(source))) throw new Error(`Optional Sol/Luna fragment is missing: ${source}`);
  const existingAgents = path.join(path.dirname(target), "AGENTS.md");
  let destination = path.join(target, "AGENTS.workbuddy-orchestrator.fragment.md");
  if (await exists(destination)) destination = `${destination}.new-${Date.now()}`;
  await writeFile(destination, await readFile(source, "utf8"), { encoding: "utf8", mode: 0o600 });
  return { destination, existingAgents: (await exists(existingAgents)) ? existingAgents : null };
}

function smokeSpec() {
  return {
    title: "WorkBuddy installer proof smoke",
    objective: `Create proof/workbuddy-proof.txt containing exactly ${JSON.stringify(SMOKE_PROOF)} and report the result using the task protocol.`,
    acceptanceCriteria: [
      "proof/workbuddy-proof.txt exists with the exact installer marker",
      "result.json is completed and lists only allowed paths",
      "No credentials are read or written",
    ],
    allowedPaths: ["proof/"],
    forbiddenPaths: ["credentials/", "AGENTS.md"],
    workingDirectory: ".",
    canUseSubagents: false,
    maxDelegationDepth: 0,
    risk: "low",
    notes: "This isolated smoke is retained for independent review.",
  };
}

function validResultSchema(result, id) {
  return Boolean(
    result &&
      result.taskId === id &&
      result.status === "completed" &&
      typeof result.summary === "string" &&
      result.summary.trim() &&
      Array.isArray(result.filesChanged) &&
      Array.isArray(result.commandsRun) &&
      Array.isArray(result.tests) &&
      Array.isArray(result.blockers) &&
      Array.isArray(result.followUps),
  );
}

export function evaluateSmokeEvidence({ task, validation, proofText, workspaceFiles = [], proofRelativePath = "proof/workbuddy-proof.txt" }) {
  const result = task?.result;
  const resultSchema = validResultSchema(result, task?.request?.id);
  const proofExact = proofText === SMOKE_PROOF;
  const filesAllowed = resultSchema && result.filesChanged.every((file) => typeof file === "string" && (file.replaceAll("\\", "/").startsWith("proof/")));
  const normalizedFiles = resultSchema ? result.filesChanged.map((file) => file.replaceAll("\\", "/")) : [];
  const proofListed = resultSchema && normalizedFiles.includes(proofRelativePath);
  const exactFilesReported = resultSchema && normalizedFiles.length === 1 && normalizedFiles[0] === proofRelativePath;
  const noBlockers = resultSchema && result.blockers.length === 0;
  const workspaceClean = workspaceFiles.length === 1 && workspaceFiles[0] === proofRelativePath;
  const validationValid = validation?.valid === true;
  const stateCompleted = task?.state?.status === "completed";
  const passed = stateCompleted && resultSchema && proofExact && filesAllowed && proofListed && exactFilesReported && noBlockers && workspaceClean && validationValid;
  return {
    passed,
    stateCompleted,
    resultSchema,
    proofExact,
    filesAllowed,
    proofListed,
    exactFilesReported,
    noBlockers,
    workspaceClean,
    validationValid,
  };
}

async function collectSmokeWorkspaceFiles(root) {
  const files = [];
  async function walk(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (childRelative === ".workbuddy-orchestrator" || childRelative === "smoke-spec.json") continue;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), childRelative);
      else if (entry.isFile()) files.push(childRelative.replaceAll("\\", "/"));
      else files.push(`${childRelative.replaceAll("\\", "/")}#non-file`);
    }
  }
  await walk(root);
  return files.sort();
}

/** Run and independently verify the installer smoke. The workspace is intentionally retained. */
export async function runSmoke({ target, configPath, timeoutMs = 120000, pollMs = 250, smokeRoot } = {}) {
  const root = smokeRoot ?? os.tmpdir();
  await mkdir(root, { recursive: true });
  const smokeWorkspace = await mkdtemp(path.join(root, "workbuddy-orchestrator-smoke-"));
  const specPath = path.join(smokeWorkspace, "smoke-spec.json");
  await writeFile(specPath, `${JSON.stringify(smokeSpec(), null, 2)}\n`, "utf8");
  const taskctlPath = path.join(target, "scripts", "taskctl.mjs");
  const ctl = await import(`${pathToFileURL(taskctlPath).href}?smoke=${Date.now()}`);
  let created;
  try {
    created = await ctl.main(["create", "--workspace", smokeWorkspace, "--spec", specPath]);
    await ctl.main(["dispatch-worker", "--workspace", smokeWorkspace, "--id", created.id, "--worker", "workbuddy-account", "--config", configPath]);
  } catch (error) {
    return {
      status: "failed",
      passed: false,
      accepted: false,
      workspacePath: smokeWorkspace,
      taskId: created?.id ?? null,
      error: error.message,
    };
  }
  const deadline = Date.now() + timeoutMs;
  let task = await ctl.main(["show", "--workspace", smokeWorkspace, "--id", created.id]);
  while (!["completed", "failed"].includes(task.state.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    task = await ctl.main(["show", "--workspace", smokeWorkspace, "--id", created.id]);
  }
  if (!["completed", "failed"].includes(task.state.status)) {
    await ctl.main(["set-status", "--workspace", smokeWorkspace, "--id", created.id, "--status", "failed", "--actor", "codex:installer-timeout"]);
    const validation = await ctl.main(["validate", "--workspace", smokeWorkspace, "--id", created.id]);
    return {
      status: "failed",
      passed: false,
      accepted: false,
      workspacePath: smokeWorkspace,
      taskId: created.id,
      timeout: true,
      validation,
      evidence: { passed: false, stateCompleted: false, resultSchema: false, proofExact: false, filesAllowed: false, proofListed: false, exactFilesReported: false, noBlockers: false, workspaceClean: false, validationValid: validation.valid === true },
    };
  }
  const validation = await ctl.main(["validate", "--workspace", smokeWorkspace, "--id", created.id]);
  let proofText = null;
  const proofPath = path.join(smokeWorkspace, "proof", "workbuddy-proof.txt");
  try { proofText = await readFile(proofPath, "utf8"); } catch { /* evidence remains false */ }
  const workspaceFiles = await collectSmokeWorkspaceFiles(smokeWorkspace);
  const evidence = evaluateSmokeEvidence({ task, validation, proofText, workspaceFiles });
  let accepted = false;
  if (evidence.passed) {
    await ctl.main(["set-status", "--workspace", smokeWorkspace, "--id", created.id, "--status", "accepted", "--actor", "codex"]);
    accepted = true;
  }
  const finalTask = await ctl.main(["show", "--workspace", smokeWorkspace, "--id", created.id]);
  return {
    status: accepted ? "passed" : "failed",
    passed: evidence.passed,
    accepted,
    workspacePath: smokeWorkspace,
    taskId: created.id,
    proofPath,
    resultPath: path.join(smokeWorkspace, ".workbuddy-orchestrator", "tasks", created.id, "result.json"),
    timeout: !["completed", "failed"].includes(task.state.status),
    state: finalTask.state.status,
    validation,
    workspaceFiles,
    evidence,
  };
}

function cliParse(argv) {
  const command = argv[0] ?? "install";
  const options = {};
  const booleans = new Set(["skip-smoke", "enable-sol-luna", "help"]);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (booleans.has(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

export async function install(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? repositoryRoot);
  const sourceSkill = path.join(sourceRoot, "skill", "workbuddy-orchestrator");
  const target = expandPath(options.target ?? firstEnvironment(options.env ?? process.env, ["WB_TARGET", "CODEX_SKILL_TARGET"]) ?? defaultTarget, options.home ?? os.homedir(), options.env ?? process.env);
  const configPath = expandPath(options.configPath ?? firstEnvironment(options.env ?? process.env, ["WB_CONFIG_OUT", "WORKBUDDY_ORCHESTRATOR_CONFIG"]) ?? defaultConfigPath, options.home ?? os.homedir(), options.env ?? process.env);
  if (path.resolve(sourceSkill) === path.resolve(target)) throw new Error("Source skill and install target must be different");
  if (!(await exists(path.join(sourceSkill, "SKILL.md")))) throw new Error(`Source skill is missing: ${sourceSkill}`);
  const nodePath = expandPath(options.nodePath ?? firstEnvironment(options.env ?? process.env, ["WB_NODE_PATH"]) ?? process.execPath, options.home ?? os.homedir(), options.env ?? process.env);
  const nodeCheck = validateNodeVersion(nodePath);
  const detection = options.detection ?? await detectPrograms({
    ...options,
    workbuddyApp: options.workbuddyApp ?? options["workbuddy-app"],
    workbuddyCli: options.workbuddyCli ?? options["workbuddy-cli"],
    workbuddyConfigDir: options.workbuddyConfigDir ?? options["workbuddy-config-dir"],
    codebuddyApp: options.codebuddyApp ?? options["codebuddy-app"],
    codebuddyCli: options.codebuddyCli ?? options["codebuddy-cli"],
    codebuddyConfigDir: options.codebuddyConfigDir ?? options["codebuddy-config-dir"],
    home: options.home,
    env: options.env,
  });
  const workers = buildWorkersConfig(detection, { nodePath });
  const backupPath = await backupTarget(target);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await cp(sourceSkill, target, { recursive: true, force: false, errorOnExist: true });
  } catch (error) {
    if (backupPath && !(await exists(target))) {
      try { await rename(backupPath, target); } catch { /* retain the backup if recovery itself is unavailable */ }
    }
    throw error;
  }
  const configBackupPath = await backupTarget(configPath);
  await writePrivateJson(configPath, workers);
  const solLuna = options.enableSolLuna ? await writeOptionalSolLuna(sourceSkill, target) : null;
  const smoke = options.skipSmoke
    ? { status: "skipped", passed: false, accepted: false, reason: "--skip-smoke was explicitly supplied" }
    : await runSmoke({ target, configPath, timeoutMs: options.smokeTimeoutMs ?? 120000, pollMs: options.smokePollMs ?? 250, smokeRoot: options.smokeRoot });
  return {
    status: smoke.status,
    target,
    configPath,
    backupPath,
    configBackupPath,
    node: nodeCheck,
    detection,
    workers: Object.keys(workers.workers),
    solLuna,
    smoke,
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, options } = cliParse(argv);
  if (command === "help" || options.help) {
    process.stdout.write("Usage: node bootstrap.mjs install [options]\n       node bootstrap.mjs detect [options]\n       node bootstrap.mjs smoke --target PATH --config PATH\n\nOptions: --target PATH --config-out PATH --workbuddy-app PATH --workbuddy-cli PATH --workbuddy-config-dir PATH --codebuddy-app PATH --codebuddy-cli PATH --codebuddy-config-dir PATH --node PATH --enable-sol-luna --skip-smoke\n");
    return { status: "help" };
  }
  if (command === "detect") {
    const detection = await detectPrograms(options);
    process.stdout.write(`${JSON.stringify(detection, null, 2)}\n`);
    return detection;
  }
  if (command === "smoke") {
    const result = await runSmoke({ target: expandPath(options.target ?? defaultTarget), configPath: expandPath(options.config ?? options["config-out"] ?? defaultConfigPath), timeoutMs: Number(options["timeout-ms"] ?? 120000) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "failed") process.exitCode = 1;
    return result;
  }
  if (command !== "install" && command !== "bootstrap") throw new Error(`Unknown installer command: ${command}`);
  const result = await install({
    ...options,
    nodePath: options.node ?? options.nodePath,
    configPath: options["config-out"],
    enableSolLuna: options["enable-sol-luna"] === true,
    skipSmoke: options["skip-smoke"] === true,
    smokeTimeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failed") process.exitCode = 1;
  return result;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
