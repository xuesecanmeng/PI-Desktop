import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, resolveElectronBinary } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
test("manual compaction updates the live inspector, survives restore, and yields to fresh usage", {
  timeout: 60_000,
  skip: process.platform === "linux" && !process.env.DISPLAY ? "Isolated Electron needs a display" : false,
}, async () => {
  const temp = await mkdtemp(join(root, "apps/desktop/.compaction-usage-ui-"));
  try {
    await build({ entryPoints: [join(root, "scripts/e2e/compaction-context-usage.tsx")], outfile: join(temp, "renderer.js"),
      bundle: true, platform: "browser", format: "esm", jsx: "automatic", target: "es2022", loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
      alias: { "@pi-desktop/i18n": join(root, "packages/i18n/src"), react: join(root, "apps/desktop/node_modules/react"),
        "react-dom": join(root, "apps/desktop/node_modules/react-dom"), i18next: join(root, "apps/desktop/node_modules/i18next"),
        "react-i18next": join(root, "apps/desktop/node_modules/react-i18next") }, nodePaths: [join(root, "apps/desktop/node_modules")] });
    await writeFile(join(temp, "index.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'"><div id="root"></div><script type="module" src="renderer.js"></script>');
    await writeFile(join(temp, "preload.cjs"), `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("piDesktop", { platform: process.platform,
  on(channel, listener) { const handler = (_event, payload) => listener(payload); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); },
  invoke: (channel, ...args) => ipcRenderer.invoke("fixture/invoke", channel, ...args) });`);
    await writeFile(join(temp, "boot.cjs"), `const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
ipcMain.handle("fixture/invoke", async (event, channel) => {
  if (channel === "pi-desktop/agent/compact") {
    const send = payload => event.sender.send("pi-desktop/agent/event/message", { sessionId: "fixture-session", ts: Date.now(), event: payload });
    send({ type: "compaction_start", reason: "manual" });
    send({ type: "compaction_end", reason: "manual", ok: true, willRetry: false,
      mark: { id: "checkpoint", throughMessageId: "old-reply", tokensAfter: 24000, generation: 1, summaryTokens: 5, summarized: true } });
  }
  return { ok: true, data: {} };
});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on("console-message", event => console.error(event.message));
  await window.loadFile(path.join(__dirname, "index.html"));
  const result = await window.webContents.executeJavaScript("window.compactionUsageProbe()");
  console.log("COMPACTION_USAGE " + JSON.stringify(result)); window.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolveElectronBinary(root).electronBinary, ["--headless=new", join(temp, "boot.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) { stream.setEncoding("utf8"); stream.on("data", chunk => { output += chunk; }); }
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(code, 0, output.slice(-8000));
    } finally { clearTimeout(timer); }
    const result = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith("COMPACTION_USAGE ")).slice("COMPACTION_USAGE ".length));
    assert.deepEqual(result, { immediate: true, transcriptPreserved: true, providerRow: true, displayModes: true, restored: true, realUsageWins: true });
  } finally {
    assert.ok(temp.startsWith(join(root, "apps/desktop/.compaction-usage-ui-")));
    await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
});
