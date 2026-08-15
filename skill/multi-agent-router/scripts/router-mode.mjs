#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MODES = new Set(["auto", "sol", "spark", "luna", "deepseek", "workbuddy"]);

export function defaultConfig() {
  return {
    version: 2,
    defaultMode: "auto",
    workbuddy: {
      priorityWhileEntitlementHealthy: true,
      entitlementHealthy: true,
      model: "auto",
      balanceVisibility: "per-run-consumption-only",
      paidSubscriptionAllowed: false,
    },
    deepseek: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" },
    qwenVision: { provider: "aliyun-qwen", model: "qwen3.7-plus", role: "visual-observation-only" },
    spark: { agentType: "spark_worker" },
    luna: { agentType: "luna_worker" },
  };
}

export async function readConfig(configPath) {
  const base = defaultConfig();
  try {
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    if (MODES.has(saved.defaultMode)) base.defaultMode = saved.defaultMode;
    if (typeof saved.workbuddy?.entitlementHealthy === "boolean") base.workbuddy.entitlementHealthy = saved.workbuddy.entitlementHealthy;
    if (["hy3", "auto"].includes(saved.workbuddy?.model)) base.workbuddy.model = saved.workbuddy.model;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return base;
}

async function saveConfig(configPath, config) {
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, configPath);
}

function parse(argv) {
  const options = {};
  const booleans = new Set(["persist", "read-current", "mark-workbuddy-quota-exhausted", "mark-workbuddy-healthy", "mark-hy3-paid", "mark-hy3-free"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (booleans.has(key)) options[key] = true;
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parse(argv);
  const configPath = path.resolve(options.config ?? path.join(os.homedir(), ".codex", "multi-agent-router.json"));
  const config = await readConfig(configPath);
  let changed = false;
  if (options.mode) {
    if (!MODES.has(options.mode)) throw new Error(`Invalid mode: ${options.mode}`);
    config.defaultMode = options.mode;
    changed = true;
  }
  if (options["mark-workbuddy-quota-exhausted"]) { config.workbuddy.entitlementHealthy = false; changed = true; }
  if (options["mark-workbuddy-healthy"]) { config.workbuddy.entitlementHealthy = true; changed = true; }
  if (options["mark-hy3-paid"]) { config.workbuddy.model = "auto"; changed = true; }
  if (options["mark-hy3-free"]) { config.workbuddy.model = "hy3"; changed = true; }
  const marker = options["mark-workbuddy-quota-exhausted"] || options["mark-workbuddy-healthy"] || options["mark-hy3-paid"] || options["mark-hy3-free"];
  const persisted = Boolean(changed && (options.persist || marker));
  if (persisted) await saveConfig(configPath, config);
  const result = { config, persisted, configPath };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (direct) {
  try { await runCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
