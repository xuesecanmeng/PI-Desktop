import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
register(new URL("./helpers/updater-module-stubs.mjs", import.meta.url));
const { app } = await import("electron");
const { AppUpdaterController } = await import("../electron/main/updater.ts");
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("develop packaging stamps an immutable update opt-out", () => {
  assert.equal(manifest.build.extraMetadata.piUpdatesDisabled, true);
});

for (const platform of ["win32", "darwin", "linux"]) {
  test(`a packaged develop install stays fixed despite automatic preferences: ${platform}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-develop-update-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, "package.json"), JSON.stringify({
      ...manifest,
      ...manifest.build.extraMetadata,
      piUpdatesDisabled: true,
    }));
    t.mock.method(app, "getAppPath", () => directory);
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const updater = Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: t.mock.fn(async () => null),
      downloadUpdate: t.mock.fn(async () => []),
      quitAndInstall: t.mock.fn(),
    });
    const controller = new AppUpdaterController({
      logger: { app() {} }, send() {}, currentVersion: manifest.version,
      platform, isPackaged: true, autoUpdater: updater,
      readUpdateSettings: async () => ({ updatePreference: "automatic" }),
    });
    t.after(() => controller.dispose());

    assert.equal(controller.getState().mode, "disabled");
    assert.equal(controller.getState().automaticSupported, false);
    controller.startAutoCheck();
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await assert.rejects(controller.check({ manual: true }), /updates are disabled/);
    controller.setPreference("automatic");
    updater.emit("update-downloaded", { version: "99.0.0", files: [] });
    await assert.rejects(controller.download(), /not supported/);
    assert.throws(() => controller.install(), /no downloaded update/);

    assert.equal(controller.getState().mode, "disabled");
    assert.equal(controller.getState().status, "idle");
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.equal(updater.checkForUpdates.mock.callCount(), 0);
    assert.equal(updater.downloadUpdate.mock.callCount(), 0);
    assert.equal(updater.quitAndInstall.mock.callCount(), 0);
  });
}
