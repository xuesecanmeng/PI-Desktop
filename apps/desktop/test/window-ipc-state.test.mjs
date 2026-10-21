import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { isWindowFullScreen, setWindowFullScreen } from "../electron/main/window-fullscreen.ts";
import { readMainModule } from "./helpers/source-contracts.mjs";

const source = await readMainModule("ipc/window-ipc.ts");
const control = source.slice(source.indexOf("  handle(IPC.invoke.windowControl,"), source.indexOf("  handle(IPC.invoke.closeBehaviorGet,"));

function windowControl(window, platform = "win32", translucent = false) {
  let callback;
  vm.runInNewContext(stripTypeScriptTypes(control), {
    handle: (_channel, handler) => { callback = handler; },
    IPC: { invoke: { windowControl: "window-control" } },
    WINDOW_CONTROL_ACTIONS: ["getState", "minimize", "toggleMaximize", "close"],
    getMainWindow: () => window,
    isWindowFullScreen,
    process: { platform },
    isMacosWindowTranslucent: () => translucent,
  });
  return async (action) => JSON.parse(JSON.stringify(await callback({ action })));
}

for (const window of [null, { isDestroyed: () => true }]) {
  test("window state includes window and surface flags when no live window exists", async () => {
    assert.deepEqual(await windowControl(window)("getState"), { maximized: false, fullScreen: false, macosWindowTranslucency: false });
    assert.deepEqual(await windowControl(window, "darwin", true)("getState"), { maximized: false, fullScreen: false, macosWindowTranslucency: true });
  });
}

for (const maximized of [false, true]) {
  test(`getState and minimize report native fullscreen and its exit: maximized=${maximized}`, async () => {
    let minimized = false;
    let nativeFullscreen = false;
    const window = {
      isDestroyed: () => false,
      isMaximized: () => maximized && !nativeFullscreen,
      isFullScreen: () => nativeFullscreen,
      setFullScreen: (value) => { nativeFullscreen = value; },
      minimize: () => { minimized = true; },
    };
    const control = windowControl(window);
    setWindowFullScreen(window, true);
    assert.deepEqual(await control("getState"), { maximized: false, fullScreen: true, macosWindowTranslucency: false });
    assert.deepEqual(await control("minimize"), { maximized: false, fullScreen: true, macosWindowTranslucency: false });
    assert.equal(minimized, true);
    nativeFullscreen = false;
    assert.deepEqual(await control("getState"), { maximized, fullScreen: false, macosWindowTranslucency: false });
  });
}

test("macOS window state preserves translucency alongside native fullscreen", async () => {
  const window = {
    isDestroyed: () => false,
    isMaximized: () => false,
    isFullScreen: () => true,
  };
  for (const translucent of [false, true]) {
    assert.deepEqual(await windowControl(window, "darwin", translucent)("getState"), {
      maximized: false,
      fullScreen: true,
      macosWindowTranslucency: translucent,
    });
  }
});
