import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, resolveElectronBinary } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");

const mainSource = String.raw`
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC } from "@pi-desktop/shared";
import { registerWorkspaceIpc } from "./electron/main/ipc/workspace-ipc";
import { registerSettingsIpc } from "./electron/main/ipc/settings-ipc";
import { createProviderCatalogRuntime } from "./electron/main/runtime/provider-catalog";

const temporary = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(temporary, "data");
const project = join(temporary, "project");
const worktree = join(temporary, "worktree");
const outside = join(temporary, "outside");
const settingsFile = join(dataDir, "settings.json");
const handoffs = [];
const vscode = [];
const revealed = [];
const lookups = [];
let heldLookup;
const handlers = new Map();
let ready;
const rendererReady = new Promise((resolve) => { ready = resolve; });
let isolated = false;
const host = { async call(method, input) {
  if (method === "session.get") return { session: { id: "fixture-session", projectPath: project, ...(isolated ? { worktree: { location: worktree } } : {}) } };
  if (method === "workspace.get") return { workspace: { path: project, name: "Fixture" } };
  if (method === "session.getScratchPath") return { path: join(dataDir, "scratch", "fixture-session") };
  if (method === "worktree.location") return { path: worktree };
  if (method === "settings.get") return JSON.parse(await readFile(settingsFile, "utf8"));
  if (method === "settings.set") {
    const previous = await this.call("settings.get");
    const next = { ...previous, ...input };
    await writeFile(settingsFile, JSON.stringify(next));
    return next;
  }
  throw new Error("unexpected fixture Host call: " + method);
} };
const registrar = { handle: (channel, handler) => handlers.set(channel, handler), handleWithEvent() {}, assertMainWindowSender() {} };
const runtime = createProviderCatalogRuntime({ getHost: () => host, modelsDevCatalog: {} });
registerSettingsIpc({
  registrar, getHost: () => host, getSidecar: () => null, dataDir,
  normalizeSettings: runtime.normalizeSettings, validateSettingsWrite: runtime.validateSettingsWrite,
  applyNetworkProxyFromAppSettings: async () => {}, applyApplicationMenuSettings() {}, applyDeveloperMode() {},
  applyPreventScreenSleep() {}, applyKeepAwakeWhileRunning() {}, applyUpdatePreference() {},
});
registerWorkspaceIpc({
  registrar, getHost: () => host, getSidecar: () => null, getMainWindow: () => null, dataDir,
  plugins: {}, browserHost: {}, clipboardHistory: {}, recordPastedClipboardFiles() {},
  currentWorkspacePath: () => project, setCurrentWorkspacePath() {}, withGitBranch: async (value) => value,
  stripWinLongPrefix: (value) => value,
});
shell.openPath = async (path) => { handoffs.push(path); return ""; };
shell.openExternal = async (url) => { vscode.push(url); };
shell.showItemInFolder = (path) => { revealed.push(path); };
ipcMain.handle("fixture/invoke", async (_event, channel, ...args) => {
  if (channel === "fixture/context") return { project, worktree, outside };
  if (channel === "fixture/lookups") return lookups;
  if (channel === "fixture/holdLookup") {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    heldLookup = { ref: String(args[0]), promise, release, started: false };
    return;
  }
  if (channel === "fixture/lookupPending") return heldLookup?.started === true;
  if (channel === "fixture/releaseLookup") { const pending = heldLookup; heldLookup = undefined; pending?.release(); return; }
  if (channel === "fixture/ready") { ready(); return; }
  if (channel === "fixture/handoffs") return handoffs;
  if (channel === "fixture/nativeActions") return { vscode, revealed };
  if (channel === "fixture/isolate") { isolated = true; return; }
  if (channel === "fixture/invalidPaths") {
    for (const path of [join(project, "missing.txt"), "vscode://settings/editor.fontSize"]) {
      for (const method of [IPC.invoke.fsOpen, IPC.invoke.fsList, IPC.invoke.fsReveal, IPC.invoke.fsOpenInVSCode]) {
        let refused = false;
        try { await handlers.get(method)({ path, sessionId: "fixture-session" }); } catch { refused = true; }
        if (!refused) throw new Error("invalid path was accepted: " + method);
      }
    }
    const lookup = await handlers.get(IPC.invoke.fsResolveRef)({ ref: join(project, "escape"), sessionId: "fixture-session", allowDirectories: true });
    if (lookup.match?.root !== "external" || !lookup.match.isDirectory) throw new Error("user-selected directory alias did not resolve");
    return true;
  }
  if (channel === IPC.invoke.pluginViews) return { ok: true, data: [
    { pluginId: "pi.file-manager", viewId: "manager" }, { pluginId: "pi.browser", viewId: "browser" },
  ] };
  const handler = handlers.get(channel);
  if (!handler) throw new Error("unexpected fixture IPC: " + channel);
  try {
    const pending = heldLookup;
    const ref = String(args[0]?.ref ?? "").replaceAll("\\", "/");
    if (channel === IPC.invoke.fsResolveRef && pending?.ref === ref) {
      pending.started = true;
      await pending.promise;
    }
    const data = await handler(...args);
    if (channel === IPC.invoke.fsResolveRef) lookups.push(ref);
    return { ok: true, data };
  }
  catch (error) { return { ok: false, error: { code: error.errorCode ?? "INTERNAL_ERROR", message: error.message } }; }
});

app.setPath("userData", join(temporary, "profile"));
await app.whenReady();
try {
  for (const base of [project, worktree]) {
    const directory = join(base, "outputs", "会计资料");
    await mkdir(join(directory, "nested"), { recursive: true });
    await mkdir(join(directory, "folder.html"), { recursive: true });
    await symlink(join(directory, "folder.html"), join(directory, "alias.HTML"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(directory, "report.pdf"), "%PDF-1.4 fixture");
    await writeFile(join(directory, "page.HTML"), "<!doctype html><p>Fixture</p>");
    await writeFile(join(directory, "note # 100%.txt"), "reserved URL characters");
    await writeFile(join(directory, "nested", "child.txt"), "child");
  }
  await mkdir(dataDir, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "交接 # 100%.md"), "EXTERNAL_HANDOFF_FIXTURE");
  await symlink(outside, join(project, "escape"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(settingsFile, JSON.stringify({ theme: "light", language: "en" }));
  const window = new BrowserWindow({ show: false, width: 1100, height: 850,
    webPreferences: { preload: join(temporary, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  await window.loadFile(join(temporary, "index.html"));
  await rendererReady;
  const result = await window.webContents.executeJavaScript("window.fileOpeningProbe()");
  console.log("FILE_OPENING_PROBE " + JSON.stringify(result));
  window.destroy();
  app.exit(0);
} catch (error) { console.error(error?.stack ?? error); app.exit(1); }
`;

test("settings, Markdown links and directory browsing use the selected destination through Main IPC", {
  timeout: 60_000,
  skip: process.platform === "linux" && !process.env.DISPLAY ? "Isolated Electron needs a display" : false,
}, async () => {
  const temp = await mkdtemp(join(root, "apps/desktop/.file-opening-ui-"));
  try {
    await build({
      entryPoints: [join(root, "scripts/e2e/file-opening.tsx")], outfile: join(temp, "renderer.js"),
      bundle: true, platform: "browser", format: "esm", jsx: "automatic", target: "es2022",
      loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
      alias: { "@pi-desktop/i18n": join(root, "packages/i18n/src"),
        react: join(root, "apps/desktop/node_modules/react"), "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
        i18next: join(root, "apps/desktop/node_modules/i18next"), "react-i18next": join(root, "apps/desktop/node_modules/react-i18next") },
      nodePaths: [join(root, "apps/desktop/node_modules")],
    });
    await build({ stdin: { contents: mainSource, resolveDir: join(root, "apps/desktop"), loader: "ts" },
      outfile: join(temp, "main.mjs"), bundle: true, platform: "node", format: "esm", packages: "external" });
    await writeFile(join(temp, "preload.cjs"), `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("piDesktop", { platform: process.platform, on() { return () => {}; }, invoke: (channel, ...args) => ipcRenderer.invoke("fixture/invoke", channel, ...args) });`);
    await writeFile(join(temp, "boot.cjs"), `const { app } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(() => import("./main.mjs")).catch((error) => { console.error(error); app.exit(1); });`);
    await writeFile(join(temp, "index.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:"><body><div id="root"></div><script type="module" src="renderer.js"></script>');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolveElectronBinary(root).electronBinary, ["--headless=new", join(temp, "boot.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => { output += chunk; });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(code, 0, output.slice(-8000));
    } finally { clearTimeout(timer); }
    const line = output.split(/\r?\n/).find((value) => value.startsWith("FILE_OPENING_PROBE "));
    assert.ok(line, output.slice(-8000));
    const result = JSON.parse(line.slice("FILE_OPENING_PROBE ".length));
    assert.deepEqual(result, { defaults: true, unifiedHtml: true, nativeMenu: true, htmlSubmenu: true, menuKinds: true, menuLifecycle: true, directoryBrowsing: true, persisted: true, systemOpening: true, invalidPaths: true, worktree: true, externalFiles: true });
  } finally {
    assert.ok(temp.startsWith(join(root, "apps/desktop/.file-opening-ui-")));
    await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
});
