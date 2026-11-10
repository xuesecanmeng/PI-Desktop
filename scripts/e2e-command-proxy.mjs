/** Desktop transport -> real Host -> shell -> curl, using loopback fixtures only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROXY_ENV_KEYS } from "../packages/shared/src/network-proxy.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
assert.ok(process.env.PI_DESKTOP_HOST_BIN, "Set PI_DESKTOP_HOST_BIN to the built Host binary");
const scratch = await mkdtemp(join(tmpdir(), "pi-command-proxy-"));
const savedEnv = { ...process.env };
const proxyRequests = [];
const proxy = createServer((req, res) => {
  proxyRequests.push(req.url);
  res.end("via-proxy");
});
const origin = createServer((_req, res) => res.end("direct"));
let host;
const quote = (value) => process.platform === "win32"
  ? `'${value.replaceAll("'", "''")}'`
  : `'${value.replaceAll("'", "'\\''")}'`;
const invoke = (program, ...args) => `${process.platform === "win32" ? "& " : ""}${[program, ...args].map(quote).join(" ")}`;
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}
try {
  const proxyPort = await listen(proxy);
  const originPort = await listen(origin);
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  delete process.env.PI_DESKTOP_PROXY_JSON;
  const computerProxy = `http://127.0.0.1:${proxyPort}`;
  Object.assign(process.env, {
    HTTP_PROXY: computerProxy, HTTPS_PROXY: computerProxy, ALL_PROXY: computerProxy,
    http_proxy: computerProxy, https_proxy: computerProxy, all_proxy: computerProxy,
    NO_PROXY: "localhost", no_proxy: "localhost",
    NODE_USE_ENV_PROXY: "1",
  });
  const bundle = join(scratch, "desktop-host.cjs");
  await build({
    stdin: { contents: 'export { HostProcess } from "./apps/desktop/electron/main/host-process.ts";', resolveDir: root, loader: "ts" },
    outfile: bundle, bundle: true, platform: "node", format: "cjs",
    alias: {
      "@pi-desktop/host-runtime": join(root, "packages/host-runtime/src/host-process.ts"),
      "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"),
    },
    define: { "import.meta.url": JSON.stringify(new URL("../apps/desktop/electron/main/index.js", import.meta.url).href) },
  });
  const { HostProcess } = require(bundle);
  const probe = join(scratch, "probe.cjs");
  const keys = [...PROXY_ENV_KEYS, "PI_DESKTOP_PROXY_JSON"];
  await writeFile(probe, `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,process.env[k]??null]))));`);
  for (const mode of ["system", "custom", "direct"]) {
    if (mode === "custom") {
      process.env.HTTP_PROXY = "http://app-user:app-password@127.0.0.1:1";
      process.env.HTTPS_PROXY = process.env.HTTP_PROXY;
      process.env.PI_DESKTOP_PROXY_JSON = JSON.stringify({ mode, url: process.env.HTTP_PROXY });
    } else if (mode === "direct") {
      for (const key of PROXY_ENV_KEYS) delete process.env[key];
      delete process.env.PI_DESKTOP_PROXY_JSON;
    }
    host = new HostProcess(join(scratch, "data"), () => {});
    await host.handshake();
    const { session } = await host.call("session.create", { title: "Command proxy regression", mode: "agent", projectPath: scratch });
    await host.call("session.configure", { id: session.id, mode: "agent", permissionMode: "auto" });
    const { effective } = await host.call("commandShells.list");
    const run = async (command) => {
      const result = await host.call("tools.execute", {
        sessionId: session.id, toolCallId: randomUUID(), toolName: "Bash",
        args: { command }, mode: "agent", timeoutMs: 10_000,
        expectedCommandShellId: effective.id, expectedCommandShellDialect: effective.dialect,
      }, 20_000);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.content.exitCode, 0, JSON.stringify(result.content));
      return result.content.stdout.trim();
    };
    const env = JSON.parse(await run(invoke(process.execPath, probe)));
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
      assert.equal(env[key], computerProxy, `${mode}: ${key} must retain the computer proxy`);
    }
    assert.equal(env.NO_PROXY, "localhost");
    assert.equal(env.NODE_USE_ENV_PROXY, "1");
    assert.equal(env.PI_DESKTOP_PROXY_JSON, null);
    const curl = process.platform === "win32" ? "curl.exe" : "curl";
    assert.equal(await run(invoke(curl, "--silent", "--show-error", "--max-time", "3", `http://127.0.0.1:${originPort}/probe`)), "via-proxy");
    assert.equal(await run(invoke(curl, "--silent", "--show-error", "--max-time", "3", `http://localhost:${originPort}/probe`)), "direct");
    await host.dispose();
    host = null;
    console.log(`PASS ${mode}: computer proxy inherited, app proxy isolated, NO_PROXY honored`);
  }
  assert.equal(proxyRequests.length, 3);
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  delete require.cache[bundle];
  const { HostProcess: WithoutStartupProxy } = require(bundle);
  process.env.HTTP_PROXY = "http://app-user:app-password@127.0.0.1:1";
  process.env.PI_DESKTOP_PROXY_JSON = JSON.stringify({ mode: "custom", url: process.env.HTTP_PROXY });
  host = new WithoutStartupProxy(join(scratch, "data"), () => {});
  await host.handshake();
  const { session } = await host.call("session.create", { title: "No startup proxy", mode: "agent", projectPath: scratch });
  await host.call("session.configure", { id: session.id, mode: "agent", permissionMode: "auto" });
  const { effective } = await host.call("commandShells.list");
  const result = await host.call("tools.execute", {
    sessionId: session.id, toolCallId: randomUUID(), toolName: "Bash", mode: "agent",
    args: { command: invoke(process.execPath, probe) }, timeoutMs: 10_000,
    expectedCommandShellId: effective.id, expectedCommandShellDialect: effective.dialect,
  }, 20_000);
  assert.equal(result.ok, true, JSON.stringify(result));
  const env = JSON.parse(result.content.stdout.trim());
  for (const key of keys) assert.equal(env[key], null, `${key} must remain absent without a startup proxy`);
  console.log("PASS no startup proxy: app credentials remain isolated");
} finally {
  await host?.dispose();
  for (const server of [proxy, origin]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await rm(scratch, { recursive: true, force: true });
}
