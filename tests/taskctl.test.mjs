import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../skill/workbuddy-orchestrator/scripts/taskctl.mjs";

async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "wb-taskctl-portable-"));
  const specPath = path.join(workspace, "spec.json");
  await writeFile(specPath, JSON.stringify({
    title: "Bounded proof",
    objective: "Write one proof file.",
    acceptanceCriteria: ["proof is reported"],
    allowedPaths: ["proof/"],
    forbiddenPaths: ["private/"],
    risk: "low",
  }));
  return { workspace, specPath };
}

test("creates and validates a self-contained packet with allowed path enforcement", async () => {
  const { workspace, specPath } = await fixture();
  const created = await main(["create", "--workspace", workspace, "--spec", specPath]);
  assert.match(created.id, /^wb-\d{14}-[a-f0-9]{6}$/);
  const task = await main(["show", "--workspace", workspace, "--id", created.id]);
  assert.equal(task.state.status, "queued");
  assert.match(await readFile(path.join(created.directory, "TASK.md"), "utf8"), /Bounded proof/);
  await writeFile(path.join(created.directory, "result.json"), JSON.stringify({
    taskId: created.id,
    status: "completed",
    summary: "Proof reported",
    filesChanged: ["proof/proof.txt"],
    commandsRun: [],
    tests: [{ name: "proof", status: "passed" }],
    blockers: [],
    followUps: [],
  }));
  const valid = await main(["validate", "--workspace", workspace, "--id", created.id]);
  assert.equal(valid.valid, true);
  await writeFile(path.join(created.directory, "result.json"), JSON.stringify({
    taskId: created.id,
    status: "completed",
    summary: "Out of scope",
    filesChanged: ["private/secret.txt"],
    commandsRun: [],
    tests: [],
    blockers: [],
    followUps: [],
  }));
  const invalid = await main(["validate", "--workspace", workspace, "--id", created.id]);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.includes("out-of-scope")));
});

test("only Codex can mark a completed result accepted", async () => {
  const { workspace, specPath } = await fixture();
  const created = await main(["create", "--workspace", workspace, "--spec", specPath]);
  await main(["set-status", "--workspace", workspace, "--id", created.id, "--status", "dispatched"]);
  await main(["set-status", "--workspace", workspace, "--id", created.id, "--status", "running"]);
  await main(["set-status", "--workspace", workspace, "--id", created.id, "--status", "completed", "--actor", "worker:test"]);
  await assert.rejects(
    main(["set-status", "--workspace", workspace, "--id", created.id, "--status", "accepted", "--actor", "worker:test"]),
    /Only Codex/,
  );
  await main(["set-status", "--workspace", workspace, "--id", created.id, "--status", "accepted", "--actor", "codex"]);
  const task = await main(["show", "--workspace", workspace, "--id", created.id]);
  assert.equal(task.state.status, "accepted");
});

