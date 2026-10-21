import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMainWindowBackground,
  macosWindowSurfaceOptions,
  mainWindowBackgroundOptions,
  toElectronBackgroundColor,
} from "../electron/main/window-background.ts";

function makeWindow() {
  const calls = [];
  return {
    calls,
    setBackgroundColor: (color) => calls.push(["window", color]),
  };
}

test("plugin colors convert from RRGGBBAA to an explicit CSS color", () => {
  assert.equal(toElectronBackgroundColor("#123456"), "rgba(18, 52, 86, 1)");
  assert.equal(toElectronBackgroundColor("#12345680"), "rgba(18, 52, 86, 0.5019607843137255)");
  assert.equal(toElectronBackgroundColor("#abcdef00"), "rgba(171, 205, 239, 0)");
  assert.throws(() => toElectronBackgroundColor("#1234567"), /invalid window background color/);
});

test("constructor backgrounds use opaque Windows and macOS surfaces", () => {
  assert.deepEqual(mainWindowBackgroundOptions("win32", "#ffffff"), {
    transparent: false,
    backgroundColor: "#ffffff",
  });
  assert.deepEqual(mainWindowBackgroundOptions("linux", "#12345680"), {
    backgroundColor: "rgba(18, 52, 86, 0.5019607843137255)",
  });
  assert.deepEqual(mainWindowBackgroundOptions("darwin", "#12345680"), {
    transparent: false,
    backgroundColor: "rgba(18, 52, 86, 0.5019607843137255)",
  });
});

test("macOS surfaces follow the translucency flag", () => {
  // Absent/false keeps the window out of WindowServer's per-frame
  // recomposition path (issue #1064).
  assert.deepEqual(macosWindowSurfaceOptions(false, "#12345680"), {
    transparent: false,
    backgroundColor: "rgba(18, 52, 86, 0.5019607843137255)",
  });
  // The opt-in restores the native `sidebar` material behind a transparent
  // Electron surface.
  assert.deepEqual(macosWindowSurfaceOptions(true, "#12345680"), {
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    transparent: true,
    backgroundColor: "#00000000",
  });
  // The platform helper must not disagree with the default surface.
  assert.deepEqual(
    mainWindowBackgroundOptions("darwin", "#12345680"),
    macosWindowSurfaceOptions(false, "#12345680"),
  );
});

test("Windows alpha theme colors are flattened before creation and later updates", () => {
  assert.deepEqual(mainWindowBackgroundOptions("win32", "#12345680", "#ffffff"), {
    transparent: false,
    backgroundColor: "#8899aa",
  });
  assert.deepEqual(mainWindowBackgroundOptions("win32", "#12345600", "#181818"), {
    transparent: false,
    backgroundColor: "#181818",
  });
  const windows = makeWindow();
  assert.equal(applyMainWindowBackground(windows, "win32", "#00000080", "#ffffff"), true);
  assert.deepEqual(windows.calls, [["window", "#7f7f7f"]]);
});

test("background updates use the native Windows, Linux and opaque macOS surface", () => {
  const windows = makeWindow();
  assert.equal(applyMainWindowBackground(windows, "win32", "#12345680"), true);
  assert.deepEqual(windows.calls, [["window", "#123456"]]);
  const linux = makeWindow();
  assert.equal(applyMainWindowBackground(linux, "linux", "#12345680"), true);
  assert.deepEqual(linux.calls, [["window", "rgba(18, 52, 86, 0.5019607843137255)"]]);
  // Only an opaque macOS surface calls this background path.
  const mac = makeWindow();
  assert.equal(applyMainWindowBackground(mac, "darwin", "#123456"), true);
  assert.deepEqual(mac.calls, [["window", "rgba(18, 52, 86, 1)"]]);
});
