import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { APP_VERSION, IPC } from "../../../packages/shared/src/protocol.ts";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const bundle = await build({
  stdin: {
    contents: 'export { DESKTOP_VERSION } from "./desktop-version"; export { registerAppIpc } from "./ipc/app-ipc";',
    resolveDir: fileURLToPath(new URL("../electron/main/", import.meta.url)), loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", write: false,
  alias: {
    "@pi-desktop/shared": fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)),
    "@pi-desktop/agent-runtime": fileURLToPath(new URL("../../../packages/agent-runtime/src/project-instructions.ts", import.meta.url)),
  },
  plugins: [{ name: "electron-boundary", setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "version-test" }));
    builder.onLoad({ filter: /.*/, namespace: "version-test" }, () => ({ contents: "export const app = globalThis.__desktopVersionApp; export class BrowserWindow {}" }));
  } }],
});

for (const packaged of [true, false]) {
  test(`version IPC and feedback use the ${packaged ? "installed" : "source"} version`, async (t) => {
    const installedVersion = "2026.11.10-dev.1";
    globalThis.__desktopVersionApp = { isPackaged: packaged, getVersion: () => installedVersion };
    t.after(() => { delete globalThis.__desktopVersionApp; });
    const module = { exports: {} };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
    const expected = packaged ? installedVersion : APP_VERSION;
    assert.equal(module.exports.DESKTOP_VERSION, expected);
    const handlers = new Map();
    let feedback;
    module.exports.registerAppIpc({
      registrar: { handle: (channel, handler) => handlers.set(channel, handler), handleWithEvent() {} },
      getHost: () => ({ call: async () => ({ version: APP_VERSION, protocolVersion: 11 }) }),
      safeOpenExternal: async (url) => { feedback = url; },
    });
    const info = await handlers.get(IPC.invoke.appGetVersion)();
    assert.equal(info.version, expected);
    assert.equal(info.hostVersion, APP_VERSION);
    await handlers.get(IPC.invoke.appOpenFeedback)();
    assert.match(decodeURIComponent(feedback), new RegExp(expected.replaceAll(".", "\\.")));
  });
}
