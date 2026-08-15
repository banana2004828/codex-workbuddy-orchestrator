import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { collectPackageFiles, packageRepository } from "../scripts/package.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("package file selection excludes local state, credentials, logs, fixtures, and prior archives", async () => {
  const files = await collectPackageFiles(root);
  const names = files.map((file) => file.relative);
  assert.ok(names.includes("bootstrap.mjs"));
  assert.ok(names.includes("skill/workbuddy-orchestrator/SKILL.md"));
  assert.ok(names.includes("skill/multi-agent-router/SKILL.md"));
  assert.ok(names.includes("agent-templates/spark-worker.toml"));
  assert.ok(names.includes("templates/deepseek-harness/qwen-vision.fragment.yml"));
  assert.ok(!names.some((name) => name.startsWith(".git/")));
  assert.ok(!names.some((name) => name.includes("workers.local")));
  assert.ok(!names.some((name) => name.endsWith(".log") || name.endsWith(".zip")));
  assert.ok(!names.some((name) => name.startsWith("dist/")));
});

test("packager creates a self-contained ZIP and excludes its own output", async () => {
  const output = path.join(root, "dist", "package-test.zip");
  const result = await packageRepository({ root, output });
  assert.equal(result.outputPath, path.resolve(output));
  assert.ok(result.fileCount >= 10);
  assert.ok(result.bytes > 1000);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const filesAfter = await collectPackageFiles(root);
  assert.ok(!filesAfter.some((file) => file.relative === "dist/package-test.zip"));
});
