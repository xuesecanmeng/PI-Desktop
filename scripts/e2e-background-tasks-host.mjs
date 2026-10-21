#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { beginTurn, configureSession, createSession, endTurn } from "./e2e/session.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = join(root, ".cache", "background-tasks-host-e2e");
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(join(artifacts, "run-"));
const workspace = join(scratch, "workspace");
await mkdir(workspace);
const home = join(scratch, "home");
const appData = join(home, "AppData", "Roaming");
const localAppData = join(home, "AppData", "Local");
const agentsDir = join(home, ".agents");
await Promise.all([home, appData, localAppData, agentsDir].map(path => mkdir(path, { recursive: true })));
await copyFile(join(root, "scripts/e2e/background-task-output.mjs"), join(workspace, "output.mjs"));
const host = new Host(resolveHostBinary(), join(scratch, "data"), {
  quiet: true,
  env: {
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
    HOME: home, USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
    PI_DESKTOP_AGENTS_DIR: agentsDir,
  },
});
const rpcDurations = [];
const timedCall = async (method, params = {}) => {
  const start = performance.now();
  const result = await host.call(method, params);
  rpcDurations.push(performance.now() - start);
  return result;
};
const until = async (check, message) => {
  const deadline = performance.now() + 30_000;
  while (!(await check())) {
    assert(performance.now() < deadline, message);
    await setImmediate();
  }
};
try {
  await host.start();
  const session = await createSession(host, workspace, "Background output stress");
  await configureSession(host, session, "agent", "auto");
  // PowerShell converts a native child's stderr into ErrorRecords. Use the
  // catalog's cmd entry for raw two-stream throughput on Windows.
  if (process.platform === "win32") {
    await host.call("settings.set", { defaultCommandShell: "cmd" });
  }
  const turnId = await beginTurn(host, session.id);
  const { effective: shell } = await host.call("commandShells.list");
  assert(shell && ["cmd", "posix"].includes(shell.dialect), "fixture needs cmd or a POSIX shell");
  const ids = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const command = `node output.mjs . ${index}`;
    const result = await host.call("tools.execute", {
      sessionId: session.id, turnId, toolCallId: `stress-${index}`,
      toolName: "Bash", args: { command, runInBackground: true },
      mode: "agent", runInBackground: true, timeoutMs: 1_000,
      expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect,
    });
    assert(result.ok && result.content.backgroundTaskId, JSON.stringify(result));
    return result.content.backgroundTaskId;
  }));
  await until(async () => {
    const { tasks } = await host.call("backgroundTasks.list");
    const failed = tasks.find((task) => task.state === "failed");
    if (failed) {
      const output = await host.call("backgroundTasks.output", { id: failed.id });
      throw new Error(`Fixture failed to start: ${output.stderr.slice(-2_000)}`);
    }
    const ready = await Promise.all(ids.map((_, index) => access(join(workspace, `${index}.ready`)).then(() => true, () => false)));
    return ready.every(Boolean);
  }, "all ten commands must start");
  await Promise.all(ids.map((_, index) =>
    host.call("tools.abort", { sessionId: session.id, toolCallId: `stress-${index}` }),
  ));
  await endTurn(host, turnId, "aborted");
  let summaries = (await timedCall("backgroundTasks.list")).tasks;
  assert.equal(summaries.filter((task) => task.state === "running").length, 10, "turn abort must preserve running background tasks");
  await writeFile(join(workspace, "release"), "");
  let polls = 0;
  await until(async () => {
    summaries = (await timedCall("backgroundTasks.list")).tasks;
    const output = await timedCall("backgroundTasks.output", { id: ids[polls++ % ids.length] });
    assert(Buffer.byteLength(output.stdout) <= 256 * 1024);
    assert(Buffer.byteLength(output.stderr) <= 256 * 1024);
    return summaries.every((task) => task.state !== "running");
  }, "large output commands must drain and settle");
  for (const [index, id] of ids.entries()) {
    const output = await timedCall("backgroundTasks.output", { id });
    assert.equal(output.state, "exited", JSON.stringify({
      index, state: output.state, exitCode: output.exitCode,
      stdoutTail: output.stdout.slice(-500), stderrTail: output.stderr.slice(-2_000),
      hostErrors: host.stderr.slice(-2_000),
    }));
    assert.equal(output.exitCode, 0);
    assert.equal(output.truncated, true);
    assert(output.stdout.endsWith(`stdout-done-${index}\n`), "final stdout must not be lost");
    assert(output.stderr.endsWith(`stderr-done-${index}\n`), "final stderr must not be lost");
    assert(Buffer.byteLength(output.stdout) <= 256 * 1024);
    assert(Buffer.byteLength(output.stderr) <= 256 * 1024);
  }
  await writeFile(join(workspace, "session-worker.mjs"), `
import { existsSync, watch, writeFileSync } from "node:fs";
const name = process.argv[2];
const gate = watch(".", () => {
  if (existsSync(name + ".release")) {
    gate.close();
    console.log("finished-" + name);
  }
});
console.log("ready-" + name);
writeFileSync(name + ".ready", "");
`);
  const otherSession = await createSession(host, workspace, "Background ownership B");
  await configureSession(host, otherSession, "agent", "auto");
  const ownedTurnA = await beginTurn(host, session.id);
  const ownedTurnB = await beginTurn(host, otherSession.id);
  const startOwned = async (sessionId, turnId, name) => {
    const result = await host.call("tools.execute", {
      sessionId, turnId, toolCallId: `owned-${name}`, toolName: "Bash",
      args: { command: `node session-worker.mjs ${name}`, runInBackground: true },
      mode: "agent", runInBackground: true,
      expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect,
    });
    assert(result.ok && result.content.backgroundTaskId, JSON.stringify(result));
    await until(() => access(join(workspace, `${name}.ready`)).then(() => true, () => false), `${name} must start`);
    return result.content.backgroundTaskId;
  };
  const ownedA = await startOwned(session.id, ownedTurnA, "A");
  const ownedB = await startOwned(otherSession.id, ownedTurnB, "B");
  const ownedTasks = async () => (await host.call("backgroundTasks.list")).tasks
    .filter(task => task.id === ownedA || task.id === ownedB);
  assert.deepEqual((await ownedTasks()).map(task => task.id), [ownedB, ownedA], "later starts precede earlier starts");
  await host.call("tools.abort", { sessionId: session.id, toolCallId: "owned-A" });
  await endTurn(host, ownedTurnA, "aborted");
  await endTurn(host, ownedTurnB, "completed");
  assert((await ownedTasks()).every(task => task.state === "running"), "both sessions' background work survives turn changes");
  assert.equal((await host.call("backgroundTasks.stop", { id: ownedA })).found, true);
  await until(async () => (await ownedTasks()).find(task => task.id === ownedA)?.state === "stopped", "A must stop");
  const afterStop = await ownedTasks();
  assert.equal(afterStop.find(task => task.id === ownedA)?.sessionId, session.id);
  assert.equal(afterStop.find(task => task.id === ownedB)?.sessionId, otherSession.id);
  assert.equal(afterStop.find(task => task.id === ownedB)?.state, "running", "stopping A cannot stop B");
  await writeFile(join(workspace, "B.release"), "");
  await until(async () => (await ownedTasks()).find(task => task.id === ownedB)?.state === "exited", "B must finish independently");
  assert.deepEqual((await ownedTasks()).map(task => task.id), [ownedB, ownedA], "terminal tasks retain reverse start order");
  assert((await host.call("backgroundTasks.output", { id: ownedB })).stdout.includes("finished-B"));
  rpcDurations.sort((a, b) => a - b);
  const result = {
    tasks: 10, shell: shell.id, linesPerTaskPerStream: 100_000, bytesProduced: 202_000_000,
    maxRetainedBytesPerStream: 256 * 1024, polls,
    rpcP95Ms: Number(rpcDurations[Math.floor(rpcDurations.length * 0.95)].toFixed(2)),
    rpcMaxMs: Number(rpcDurations.at(-1).toFixed(2)),
    turnAbortSurvived: true, finalOutputRetained: true,
    sessionOwnership: { sessions: 2, startOrderVerified: true, independentStopVerified: true },
  };
  await writeFile(join(scratch, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  // EOF exercises graceful host shutdown; no user profile or running app is used.
  host.child?.stdin.end();
  if (host.child && !host.exited) {
    await Promise.race([host.exitPromise, new Promise((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      timer.unref();
    })]);
  }
  await host.stop();
}
