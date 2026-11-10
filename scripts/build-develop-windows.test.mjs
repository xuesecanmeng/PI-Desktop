import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageDevelopWindows, reserveDevelopBuild } from "./build-develop-windows.mjs";

const today = new Date("2026-11-10T04:00:00Z");
async function outputRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-develop-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("build numbers increase past existing reservations without filling deleted gaps", async (t) => {
  const root = await outputRoot(t);
  await mkdir(join(root, "2026.11.10-dev.3"));
  const result = await reserveDevelopBuild(root, today);
  assert.equal(result.version, "2026.11.10-dev.4");
  assert.equal(result.buildVersion, "2026.11.10.4");
});

test("Shanghai date rollover resets the daily build number without leading zeroes", async (t) => {
  const root = await outputRoot(t);
  const result = await reserveDevelopBuild(root, new Date("2026-01-04T16:00:00Z"));
  assert.equal(result.version, "2026.1.5-dev.1");
  assert.equal((await reserveDevelopBuild(root, new Date("2026-01-05T16:00:00Z"))).version, "2026.1.6-dev.1");
});

test("concurrent reservations cannot reuse an output directory", async (t) => {
  const root = await outputRoot(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveDevelopBuild(root, today)));
  assert.equal(new Set(results.map((result) => result.version)).size, 8);
});

test("filesystem failures and Windows build-number exhaustion remain observable", async (t) => {
  const root = await outputRoot(t);
  const file = join(root, "not-a-directory");
  await writeFile(file, "keep");
  await assert.rejects(reserveDevelopBuild(file, today));
  assert.equal(await readFile(file, "utf8"), "keep");
  await mkdir(join(root, "2026.11.10-dev.65535"));
  await assert.rejects(reserveDevelopBuild(root, today), /build number exhausted/i);
});

test("private packaging stamps one NSIS build and records provenance without changing source identity", async (t) => {
  const root = await outputRoot(t);
  const manifestPath = new URL("../apps/desktop/package.json", import.meta.url);
  const before = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(before);
  const info = await packageDevelopWindows({ outputRoot: root, now: today, build: async (options) => {
    assert.deepEqual(options.win, ["nsis"]);
    assert.equal(options.x64, true);
    assert.equal(options.publish, "never");
    assert.equal(options.config.buildVersion, "2026.11.10.1");
    assert.equal(options.config.extraMetadata.version, "2026.11.10-dev.1");
    assert.equal(options.config.extraMetadata.piUpstreamVersion, manifest.version);
    assert.equal(options.config.extraMetadata.piUpdatesDisabled, true);
    assert.equal(options.config.appId, undefined);
    assert.equal(options.config.productName, undefined);
    await writeFile(join(options.config.directories.output, "PI-Desktop-Setup-2026.11.10-dev.1.exe"), "fixture-installer");
  } });
  assert.equal(info.version, "2026.11.10-dev.1");
  assert.equal(info.appId, "net.aiuo.pi-desktop");
  assert.match(info.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(info.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(join(root, info.version, "build-info.json"), "utf8")), info);
  assert.equal(await readFile(manifestPath, "utf8"), before);
});

test("a failed packaging attempt retains its reservation and rejects instead of overwriting", async (t) => {
  const root = await outputRoot(t);
  await assert.rejects(packageDevelopWindows({ outputRoot: root, now: today, build: async () => { throw new Error("builder failed"); } }), /builder failed/);
  assert.equal((await reserveDevelopBuild(root, today)).version, "2026.11.10-dev.2");
});
