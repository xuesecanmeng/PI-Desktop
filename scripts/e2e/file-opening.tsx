import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { FileOpenTargetRows } from "../../apps/desktop/src/components/settings/FileOpenTargetRows";
import { FilesTab } from "../../apps/desktop/src/components/workpanel/FilesTab";
import { Markdown } from "../../apps/desktop/src/components/Markdown";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import type { AppSettings } from "@pi-desktop/shared";

const config = await window.piDesktop.invoke("fixture/context");
const project = config.project.replaceAll("\\", "/");
const directory = `${project}/outputs/会计资料`;
const page = `${directory}/page.HTML`;
const file = `${directory}/report.pdf`;
const specialFile = `${directory}/note # 100%.txt`;
const htmlFolder = `${directory}/folder.html`;
const htmlFolderAlias = `${directory}/alias.HTML`;
const missingHtml = `${directory}/missing.html`;
await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } },
  interpolation: { escapeValue: false },
});
useAppStore.setState({
  settings: await api.getSettings(),
  workspace: { path: config.project, name: "Fixture" },
  sessions: [{ id: "fixture-session", projectPath: config.project }],
  activeSessionId: "fixture-session",
  pluginViews: [
    { pluginId: "pi.file-manager", viewId: "manager" },
    { pluginId: "pi.browser", viewId: "browser" },
  ],
});

function Harness() {
  const settings = useAppStore((state) => state.settings);
  const request = useAppStore((state) => state.workPanelFileRequest);
  const activeTab = useAppStore((state) => state.workPanelTabs.find((tab) => tab.id === state.activeWorkPanelTabId));
  return (
    <>
      <FileOpenTargetRows settings={settings} saveSettings={async (patch: Partial<AppSettings>) => {
        const next = { ...useAppStore.getState().settings, ...patch };
        await api.setSettings(next);
        useAppStore.setState({ settings: next });
      }} />
      <Markdown source={`[Open file](<${file}>)\n\n[Open HTML](<${page}>)\n\n[Open directory](<${directory}>)\n\n[Open special file](<${specialFile}>)\n\n[HTML-named directory](<${htmlFolder}>)\n\n[HTML-named directory alias](<${htmlFolderAlias}>)\n\n[Missing HTML](<${missingHtml}>)`} />
      {activeTab?.kind === "file" && request?.isDirectory && <FilesTab />}
    </>
  );
}
const view = createRoot(document.getElementById("root")!);
flushSync(() => view.render(<Harness />));

const nextTask = () => new Promise<void>((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
    resolve();
  };
  channel.port2.postMessage(null);
});
async function until(predicate: () => unknown, message: string) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await nextTask();
  }
  throw new Error(`${message}: ${JSON.stringify(currentTab())}`);
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function choose(label: string, choice: string) {
  const group = document.querySelector(`[aria-label="${label}"]`);
  const button = [...(group?.querySelectorAll("button") ?? [])].find((item) => item.textContent === choice);
  check(button, `missing option ${label}: ${choice}`);
  button.click();
}
function clickLink(label: string) {
  const link = [...document.querySelectorAll("a")].find((item) => item.textContent === label);
  check(link?.getAttribute("href"), `link lost its destination: ${label}`);
  link.click();
}
function currentTab() {
  const state = useAppStore.getState();
  return state.workPanelTabs.find((tab) => tab.id === state.activeWorkPanelTabId);
}
async function handoffs() {
  return await window.piDesktop.invoke("fixture/handoffs") as string[];
}

async function openMenu(label: string, html = false) {
  const link = [...document.querySelectorAll("a")].find((item) => item.textContent === label);
  check(link, `missing menu target: ${label}`);
  flushSync(() => link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
  await until(() => document.querySelector('[role="menuitem"]'), "file context menu did not open");
  if (html) await until(() => document.querySelector('[data-context-menu-item="open-with"]'), "real HTML file lost its submenu");
  return [...document.querySelectorAll<HTMLButtonElement>('[data-context-menu-root-item]')];
}
function closeMenu() {
  flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}
async function lookupCount(ref: string) {
  const lookups = await window.piDesktop.invoke("fixture/lookups") as string[];
  return lookups.filter(item => item === ref).length;
}
function menuHasHtml() { return Boolean(document.querySelector('[data-context-menu-item="open-with"]')); }
async function selectMenu(label: string, action: string) {
  const html = label === "Open HTML";
  const items = await openMenu(label, html);
  check(JSON.stringify(items.map(item => item.textContent)) === JSON.stringify([
    "Open in VS Code", ...(html ? ["Open with"] : []), "Copy full path", "Copy relative path", "Open in File Explorer",
  ]), "file menu contains unexpected actions");
  let item = items.find(item => item.textContent === action);
  if (!item) {
    const trigger = items.find(item => item.textContent === "Open with");
    check(trigger, "HTML Open with submenu is missing");
    trigger.click();
    await until(() => document.querySelector('[data-context-menu-submenu-item]'), "HTML submenu did not open");
    item = [...document.querySelectorAll<HTMLButtonElement>('[data-context-menu-submenu-item]')].find(item => item.textContent === action);
  }
  check(item, `missing menu action: ${action}`);
  item.click();
}
async function nativeActions() {
  return await window.piDesktop.invoke("fixture/nativeActions") as { vscode: string[]; revealed: string[] };
}
function pathFromVSCode(url: string) {
  const parsed = new URL(url);
  check(parsed.protocol === "vscode:" && parsed.hostname === "file", "unexpected native URL scheme or authority");
  check(!parsed.search && !parsed.hash, "filename became a URL query or fragment");
  return decodeURIComponent(parsed.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
}
Object.assign(window, {
  async fileOpeningProbe() {
    check(useAppStore.getState().settings.fileOpenTarget === "workpanel", "file default changed");
    check(!document.querySelector('[aria-label="HTML file opening"]'), "obsolete HTML preference is still visible");
    clickLink("Open file");
    await until(() => currentTab()?.resource === "pi.file-manager/manager", "file did not reach File Manager");
    clickLink("Open HTML");
    await until(() => currentTab()?.resource === "pi.file-manager/manager" && currentTab()?.location === "outputs/会计资料/page.HTML", "HTML did not reach File Manager");
    clickLink("Open directory");
    await until(() => document.querySelector('.file-tree button[title$="report.pdf"]'), "directory contents were not listed");
    const nested = [...document.querySelectorAll(".file-tree button")].find((item) => item.textContent === "nested");
    check(nested, "nested directory is missing");
    nested.click();
    await until(() => document.querySelector('.file-tree button[title$="child.txt"]'), "nested directory did not expand");
    check((await handoffs()).length === 0, "built-in defaults launched an application");
    const childPage = document.querySelector<HTMLButtonElement>('.file-tree button[title$="page.HTML"]');
    check(childPage, "HTML directory entry is missing");
    childPage.click();
    await until(() => currentTab()?.resource === "pi.file-manager/manager" && currentTab()?.location === "outputs/会计资料/page.HTML", "HTML directory entry did not use File Manager");

    choose("File and folder opening", "System default application");
    await until(() => useAppStore.getState().settings.fileOpenTarget === "external", "file setting did not save");
    useAppStore.setState({ settings: await api.getSettings() });
    flushSync(() => view.render(<Harness key="reopened" />));
    check(useAppStore.getState().settings.fileOpenTarget === "external", "preference was lost on reload");
    clickLink("Open HTML");
    await until(async () => (await handoffs()).length === 1, "HTML ignored the unified system preference");
    check((await handoffs())[0].replaceAll("\\", "/") === page, "HTML opened a different path");
    clickLink("Open file");
    await until(async () => (await handoffs()).length === 2, "file did not reach the system application");
    clickLink("Open directory");
    await until(async () => (await handoffs()).length === 3, "directory did not reach the system file manager");
    check((await handoffs())[2].replaceAll("\\", "/") === directory, "directory opened a different path");

    // A filename suffix never turns an actual directory or missing path into HTML.
    for (const [label, ref] of [["HTML-named directory", htmlFolder], ["HTML-named directory alias", htmlFolderAlias], ["Missing HTML", missingHtml]]) {
      const before = await lookupCount(ref);
      await openMenu(label);
      await until(async () => await lookupCount(ref) > before, "directory metadata was not inspected");
      await nextTask();
      check(!menuHasHtml(), "a directory or missing path received an HTML submenu");
      check(document.querySelectorAll('[data-context-menu-root-item]').length === 4, "generic file actions were lost");
      closeMenu();
    }

    // Metadata enrichment keeps keyboard focus, and never revives an old request.
    await window.piDesktop.invoke("fixture/holdLookup", page);
    const initialItems = await openMenu("Open HTML");
    check(!menuHasHtml(), "HTML was assumed before filesystem inspection");
    await until(() => document.activeElement === initialItems[0], "initial menu item was not focused");
    const copyItem = initialItems.find(item => item.textContent === "Copy relative path");
    check(copyItem, "copy item is missing");
    copyItem.focus();
    await until(() => window.piDesktop.invoke("fixture/lookupPending"), "HTML lookup did not pause");
    await window.piDesktop.invoke("fixture/releaseLookup");
    await until(menuHasHtml, "real HTML file did not gain its submenu");
    await nextTask();
    check(document.activeElement === copyItem, "metadata enrichment stole keyboard focus");
    closeMenu();

    for (const replacement of [true, false]) {
      const before = await lookupCount(page);
      await window.piDesktop.invoke("fixture/holdLookup", page);
      await openMenu("Open HTML");
      await until(() => window.piDesktop.invoke("fixture/lookupPending"), "HTML lookup did not pause");
      closeMenu();
      if (replacement) await openMenu("HTML-named directory");
      await window.piDesktop.invoke("fixture/releaseLookup");
      await until(async () => await lookupCount(page) > before, "paused HTML lookup did not complete");
      await nextTask();
      check(!menuHasHtml(), "an old HTML lookup changed a dismissed or newer menu");
      check(Boolean(document.querySelector('[role="menu"]')) === replacement, "a dismissed menu reappeared");
      closeMenu();
    }
    const beforeSwitch = await lookupCount(page);
    await window.piDesktop.invoke("fixture/holdLookup", page);
    await openMenu("Open HTML");
    await until(() => window.piDesktop.invoke("fixture/lookupPending"), "HTML lookup did not pause");
    useAppStore.setState({ activeSessionId: "other-session" });
    await until(() => !document.querySelector('[role="menu"]'), "session switch did not dismiss the old menu");
    await window.piDesktop.invoke("fixture/releaseLookup");
    await until(async () => await lookupCount(page) > beforeSwitch, "stale session lookup did not complete");
    await nextTask();
    check(!document.querySelector('[role="menu"]'), "stale session metadata reopened a menu");
    useAppStore.setState({ activeSessionId: "fixture-session" });

    // Explicit native menu actions override the saved preference after resolution.
    choose("File and folder opening", "Built-in viewer");
    await until(() => useAppStore.getState().settings.fileOpenTarget === "workpanel", "built-in preference did not save");
    await selectMenu("Open HTML", "Open in VS Code");
    await until(async () => (await nativeActions()).vscode.length === 1, "VS Code action did not reach Main");
    check(pathFromVSCode((await nativeActions()).vscode[0]) === page, "VS Code opened a different HTML path");
    await selectMenu("Open special file", "Open in VS Code");
    await until(async () => (await nativeActions()).vscode.length === 2, "encoded filename did not reach VS Code");
    check(pathFromVSCode((await nativeActions()).vscode[1]) === specialFile, "VS Code URL changed reserved filename characters");
    await selectMenu("Open directory", "Open in VS Code");
    await until(async () => (await nativeActions()).vscode.length === 3, "directory did not reach VS Code");
    check(pathFromVSCode((await nativeActions()).vscode[2]) === directory + "/", "VS Code directory URL changed the path");
    await selectMenu("Open file", "Open in File Explorer");
    await until(async () => (await nativeActions()).revealed.length === 1, "file was not revealed in Explorer");
    check((await nativeActions()).revealed[0].replaceAll("\\", "/") === file, "Explorer revealed a different file");
    await selectMenu("Open directory", "Open in File Explorer");
    await until(async () => (await handoffs()).length === 4, "Explorer did not open the directory contents");
    check((await handoffs())[3].replaceAll("\\", "/") === directory, "Explorer opened a different directory");

    // Invalid roots, missing paths and junction escapes never reach a native app.
    const denied = await window.piDesktop.invoke("fixture/security");
    check(denied === true && (await handoffs()).length === 4, "an invalid path reached the OS");
    check((await nativeActions()).vscode.length === 3 && (await nativeActions()).revealed.length === 1, "an invalid path reached a native menu action");

    choose("File and folder opening", "System default application");
    await until(() => useAppStore.getState().settings.fileOpenTarget === "external", "system preference did not save");
    await window.piDesktop.invoke("fixture/isolate");
    useAppStore.setState({ sessions: [{ id: "fixture-session", projectPath: config.project, worktree: { location: config.worktree } }] });
    clickLink("Open directory");
    await until(async () => (await handoffs()).length === 5, "worktree directory did not open");
    check((await handoffs())[4].replaceAll("\\", "/") === config.worktree.replaceAll("\\", "/") + "/outputs/会计资料", "worktree reference opened the parent checkout");
    choose("File and folder opening", "Built-in viewer");
    await until(() => useAppStore.getState().settings.fileOpenTarget === "workpanel", "built-in preference did not save");
    clickLink("Open directory");
    await until(() => document.querySelector('.file-tree button[title$="report.pdf"]'), "worktree directory could not be browsed");
    check(useAppStore.getState().workPanelFileRequest?.path.replaceAll("\\", "/").startsWith(config.worktree.replaceAll("\\", "/") + "/"), "directory viewer used the parent checkout");
    const branchPage = config.worktree.replaceAll("\\", "/") + "/outputs/会计资料/page.HTML";
    await selectMenu("Open HTML", "Built-in browser");
    await until(() => currentTab()?.resource === "pi.browser/browser" && currentTab()?.location?.replaceAll("\\", "/") === branchPage, "HTML submenu did not open the branch page in Browser");
    await selectMenu("Open HTML", "File Manager");
    await until(() => currentTab()?.resource === "pi.file-manager/manager" && currentTab()?.location?.replaceAll("\\", "/") === branchPage, "HTML submenu did not open the branch file in File Manager");
    await selectMenu("Open HTML", "Default browser");
    await until(async () => (await handoffs()).length === 6, "HTML submenu did not use the default application");
    check((await handoffs())[5].replaceAll("\\", "/") === branchPage, "HTML submenu opened a different branch file");
    check(useAppStore.getState().settings.fileOpenTarget === "workpanel", "HTML submenu changed the saved preference");
    return { defaults: true, unifiedHtml: true, nativeMenu: true, htmlSubmenu: true, menuKinds: true, menuLifecycle: true, directoryBrowsing: true, persisted: true, systemOpening: true, containment: true, worktree: true };
  },
});
await window.piDesktop.invoke("fixture/ready");
