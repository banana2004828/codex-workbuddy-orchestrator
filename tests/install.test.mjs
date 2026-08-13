import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backupTarget,
  buildWorkersConfig,
  detectPrograms,
  evaluateSmokeEvidence,
  install,
  runSmoke,
  validateNodeVersion,
} from "../scripts/install.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function fixture(prefix = "wb-portable-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function fakeCli(root, mode = "success") {
  const cli = path.join(root, `fake-cli-${mode}.mjs`);
  const body = mode === "success"
    ? `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const prompt = process.argv.at(-1);
const id = prompt.match(/Task ID: (wb-\\d{14}-[a-f0-9]{6})/)[1];
const taskDir = path.join(process.cwd(), ".workbuddy-orchestrator", "tasks", id);
await mkdir(path.join(process.cwd(), "proof"), { recursive: true });
await writeFile(path.join(process.cwd(), "proof", "workbuddy-proof.txt"), "workbuddy-orchestrator-smoke-v1\\n");
await writeFile(path.join(taskDir, "result.json"), JSON.stringify({taskId:id,status:"completed",summary:"Proof created",filesChanged:["proof/workbuddy-proof.txt"],commandsRun:["fake"],tests:[{name:"proof",status:"passed"}],blockers:[],followUps:[]}));
process.stdout.write(JSON.stringify({ok:true}));`
    : `process.stdout.write(JSON.stringify({ok:true}));`;
  await writeFile(cli, body, "utf8");
  return cli;
}

test("detects macOS and Windows fixture paths without reading account files", async () => {
  const root = await fixture("wb-detect-");
  const workbuddyApp = path.join(root, "WorkBuddy.app");
  const workbuddyCli = path.join(root, "workbuddy-cli");
  const workbuddyConfig = path.join(root, "workbuddy");
  await mkdir(workbuddyApp);
  await writeFile(workbuddyCli, "#!/bin/sh\n");
  await mkdir(workbuddyConfig);
  const mac = await detectPrograms({
    platform: "darwin",
    home: root,
    workbuddyAppCandidates: [workbuddyApp],
    workbuddyCliCandidates: [workbuddyCli],
    workbuddyConfigDir: workbuddyConfig,
    codebuddyAppCandidates: [],
    codebuddyCliCandidates: [],
    env: {},
  });
  assert.equal(mac.workbuddy.appPath, workbuddyApp);
  assert.equal(mac.workbuddy.cliPath, workbuddyCli);
  const winApp = path.join(root, "WorkBuddy.exe");
  const winCli = path.join(root, "codebuddy.cmd");
  await writeFile(winApp, "");
  await writeFile(winCli, "");
  const win = await detectPrograms({
    platform: "win32",
    home: root,
    workbuddyAppCandidates: [winApp],
    workbuddyCliCandidates: [winCli],
    workbuddyConfigDir: workbuddyConfig,
    codebuddyAppCandidates: [],
    codebuddyCliCandidates: [],
    env: {},
  });
  assert.equal(win.workbuddy.appPath, winApp);
  assert.equal(win.workbuddy.cliPath, winCli);
});

test("derives the bundled macOS Node CLI entry from WorkBuddy.app", async () => {
  const root = await fixture("wb-mac-bundle-");
  const app = path.join(root, "WorkBuddy.app");
  const cli = path.join(app, "Contents", "Resources", "app.asar.unpacked", "cli", "dist", "codebuddy.js");
  const configDir = path.join(root, ".workbuddy");
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, "#!/usr/bin/env node\n");
  await mkdir(configDir);
  const detection = await detectPrograms({
    platform: "darwin",
    home: root,
    workbuddyAppCandidates: [app],
    workbuddyConfigDir: configDir,
    codebuddyAppCandidates: [],
    codebuddyCliCandidates: [],
    env: {},
  });
  assert.equal(detection.workbuddy.cliPath, cli);
});

test("generates WorkBuddy-required config and optional CodeBuddy without credentials", async () => {
  const root = await fixture("wb-config-");
  const wbCli = path.join(root, "wb-cli");
  const cbCli = path.join(root, "cb-cli");
  const wbConfig = path.join(root, "wb-config");
  const cbConfig = path.join(root, "cb-config");
  await Promise.all([writeFile(wbCli, ""), writeFile(cbCli, ""), mkdir(wbConfig), mkdir(cbConfig)]);
  const detection = await detectPrograms({
    platform: "darwin",
    home: root,
    workbuddyAppCandidates: [],
    workbuddyCliCandidates: [wbCli],
    workbuddyConfigDir: wbConfig,
    codebuddyAppCandidates: [],
    codebuddyCliCandidates: [cbCli],
    codebuddyConfigDir: cbConfig,
    env: {},
  });
  const config = buildWorkersConfig(detection, { nodePath: process.execPath });
  assert.deepEqual(Object.keys(config.workers).sort(), ["codebuddy-account", "workbuddy-account"]);
  assert.match(JSON.stringify(config), /workbuddy/);
  assert.doesNotMatch(JSON.stringify(config), /token|cookie|api[_-]?key|secret|password/i);
});

test("rejects Windows command wrappers that cannot be launched through Node", async () => {
  const root = await fixture("wb-wrapper-");
  const configDir = path.join(root, "workbuddy-config");
  await mkdir(configDir);
  assert.throws(() => buildWorkersConfig({
    workbuddy: { cliPath: path.join(root, "codebuddy.cmd"), configDir, configDirExists: true },
    codebuddy: null,
  }), /Node entry file/);
});

test("backupTarget is reversible and never silently overwrites", async () => {
  const root = await fixture("wb-backup-");
  const target = path.join(root, "skill");
  await mkdir(target);
  await writeFile(path.join(target, "old.txt"), "old");
  const backup = await backupTarget(target);
  assert.ok(backup);
  assert.equal(await readFile(path.join(backup, "old.txt"), "utf8"), "old");
  assert.equal(await backupTarget(path.join(root, "missing")), null);
});

test("real offline smoke accepts only exact proof and valid result evidence", async () => {
  const root = await fixture("wb-smoke-");
  const cli = await fakeCli(root, "success");
  const configDir = path.join(root, "workbuddy-config");
  await mkdir(configDir);
  const target = path.join(root, "installed-skill");
  await install({
    sourceRoot: repoRoot,
    target,
    configPath: path.join(root, "workers.json"),
    nodePath: process.execPath,
    detection: {
      platform: process.platform,
      home: root,
      workbuddy: { appPath: null, cliPath: cli, configDir, configDirExists: true },
      codebuddy: null,
    },
    skipSmoke: true,
  });
  const configPath = path.join(root, "workers.json");
  const smoke = await runSmoke({ target, configPath, timeoutMs: 10000, pollMs: 20, smokeRoot: root });
  assert.equal(smoke.passed, true);
  assert.equal(smoke.accepted, true);
  assert.equal(smoke.state, "accepted");
  assert.ok(smoke.workspacePath);
});

test("install backs up an existing skill and config before replacing them", async () => {
  const root = await fixture("wb-install-backup-");
  const cli = await fakeCli(root, "success");
  const configDir = path.join(root, "workbuddy-config");
  const target = path.join(root, "installed-skill");
  const configPath = path.join(root, "workers.json");
  await mkdir(configDir);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "old.txt"), "keep me");
  await writeFile(configPath, "{\"old\":true}\n");
  const result = await install({
    sourceRoot: repoRoot,
    target,
    configPath,
    nodePath: process.execPath,
    detection: {
      platform: process.platform,
      home: root,
      workbuddy: { appPath: null, cliPath: cli, configDir, configDirExists: true },
      codebuddy: null,
    },
    skipSmoke: true,
  });
  assert.ok(result.backupPath);
  assert.ok(result.configBackupPath);
  assert.equal(await readFile(path.join(result.backupPath, "old.txt"), "utf8"), "keep me");
  assert.match(await readFile(configPath, "utf8"), /workbuddy-account/);
  assert.equal(await readFile(result.configBackupPath, "utf8"), "{\"old\":true}\n");
});

test("failed or incomplete evidence is never accepted", async () => {
  const task = {
    request: { id: "wb-20260813000000-abcdef" },
    state: { status: "completed" },
    result: {
      taskId: "wb-20260813000000-abcdef",
      status: "completed",
      summary: "claimed",
      filesChanged: ["proof/workbuddy-proof.txt", "private/secret.txt"],
      commandsRun: [],
      tests: [],
      blockers: [],
      followUps: [],
    },
  };
  const evidence = evaluateSmokeEvidence({
    task,
    validation: { valid: false },
    proofText: "wrong\n",
    workspaceFiles: ["private/secret.txt", "proof/workbuddy-proof.txt"],
  });
  assert.equal(evidence.passed, false);
});

test("completed claims with blockers or unreported workspace files are rejected", () => {
  const id = "wb-20260813000000-abc123";
  const base = {
    request: { id },
    state: { status: "completed" },
    result: {
      taskId: id,
      status: "completed",
      summary: "claimed",
      filesChanged: ["proof/workbuddy-proof.txt"],
      commandsRun: [],
      tests: [],
      blockers: ["not actually done"],
      followUps: [],
    },
  };
  const withBlocker = evaluateSmokeEvidence({
    task: base,
    validation: { valid: true },
    proofText: "workbuddy-orchestrator-smoke-v1\n",
    workspaceFiles: ["proof/workbuddy-proof.txt"],
  });
  assert.equal(withBlocker.noBlockers, false);
  assert.equal(withBlocker.passed, false);

  const extraFile = evaluateSmokeEvidence({
    task: { ...base, result: { ...base.result, blockers: [] } },
    validation: { valid: true },
    proofText: "workbuddy-orchestrator-smoke-v1\n",
    workspaceFiles: ["notes.txt", "proof/workbuddy-proof.txt"],
  });
  assert.equal(extraFile.workspaceClean, false);
  assert.equal(extraFile.passed, false);
});

test("installer uses a compatible current Node executable", () => {
  const result = validateNodeVersion(process.execPath);
  assert.ok(result.major >= 20);
});
