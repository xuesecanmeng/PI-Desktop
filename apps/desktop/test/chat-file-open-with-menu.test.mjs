/**
 * A file the conversation already recognised is a file the user can act on.
 *
 * File and directory references offer explicit native destinations. Each
 * destination goes through the same completion as a click, so a shorthand that
 * resolves to nothing cannot open a different file (ADR 0262/0263).
 *
 * The destination half is asserted behaviorally: the real hooks run against a
 * recorded store and stubbed host replies, because the contract is the resolved
 * address handed to each destination, not the shape of the menu.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readTranscriptSource } from "./helpers/source-contracts.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** Compile one desktop module and evaluate it against the given mocks. */
function loadModule(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unmocked dependency: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

const calls = {
  tabs: [],
  files: [],
  urls: [],
  defaultBrowsers: [],
  vscode: [],
  reveals: [],
  toasts: [],
  resolved: [],
  menus: [],
};

const state = {
  sessions: [],
  workspace: { path: "C:/project" },
  activeSessionId: "session-1",
  pluginViews: [
    { pluginId: "pi.file-manager", viewId: "manager" },
    { pluginId: "pi.browser", viewId: "browser" },
  ],
  openFileInWorkPanel: (...args) => calls.files.push(args),
  openUrlInWorkPanel: (...args) => calls.urls.push(args),
  openWorkPanelTab: (tab) => calls.tabs.push(tab),
  showToast: (...args) => calls.toasts.push(args),
};
const useAppStore = Object.assign(
  (selector) => selector(state),
  {
    getState: () => state,
    setState: (update) => Object.assign(state, update),
  },
);

let nextMatch = null;
let clipboardFails = false;
let defaultOpenFails = false;
let lookupFails = false;
const copied = [];

/*
  The hooks read `navigator.clipboard` off the global, exactly as the app does,
  so what a copy claims is asserted against what actually reached the clipboard.
*/
Object.defineProperty(globalThis, "navigator", {
  value: {
    clipboard: {
      writeText: async (value) => {
        if (clipboardFails) throw new Error("clipboard refused");
        copied.push(value);
      },
    },
  },
  configurable: true,
});
const translate = () => ({
  t: (key, values) => `${key}:${values?.name ?? ""}`,
});
const sharedPackage = await import("@pi-desktop/shared");

const previewTarget = loadModule("../src/hooks/use-preview-target.ts", {
  react: React,
  "react-i18next": { useTranslation: translate },
  "@pi-desktop/shared": sharedPackage,
  "../stores/app-store": { useAppStore },
  "./use-chat-session-capability": { useChatSessionCapability: () => true },
  "../lib/remote-session-safety": loadModule("../src/lib/remote-session-safety.ts", {}),
  "../plugins/renderer-slots/use-slots": { useSlotSessionId: () => "" },
  "../lib/api": {
    api: {
      listPluginViews: async () => state.pluginViews,
      fsOpen: async (path, mimeType, sessionId) => {
        calls.defaultBrowsers.push([path, mimeType, sessionId]);
        if (defaultOpenFails) throw new Error("OS association failed");
      },
      fsOpenInVSCode: async (path, sessionId) => {
        calls.vscode.push([path, sessionId]);
        if (defaultOpenFails) throw new Error("VS Code unavailable");
      },
      fsReveal: async (path, sessionId) => {
        calls.reveals.push([path, sessionId]);
        if (defaultOpenFails) throw new Error("Explorer unavailable");
      },
      fsResolveRef: async (ref) => {
        calls.resolved.push(ref);
        if (lookupFails) throw new Error("metadata lookup unavailable");
        return { match: nextMatch };
      },
    },
  },
  "../lib/chat-links": loadModule("../src/lib/chat-links.ts", {
    "@pi-desktop/shared": sharedPackage,
    "./chat-link-scanner.ts": loadModule("../src/lib/chat-link-scanner.ts", {
      "./render-diagnostics.ts": { beginRenderDiagnostic: () => () => {} },
    }),
    "./render-diagnostics.ts": { beginRenderDiagnostic: () => () => {} },
  }),
  "../lib/open-http-url": { openHttpUrl: (...args) => calls.urls.push(args) },
  "../lib/work-panel-tabs": loadModule("../src/lib/work-panel-tabs.ts", {}),
});

const nativeCapability = loadModule("../src/hooks/use-chat-session-capability.ts", {
  "../lib/remote-session-safety": loadModule("../src/lib/remote-session-safety.ts", {}),
  "../plugins/renderer-slots/use-slots": { useSlotSessionId: () => "" },
  "../stores/app-store": { useAppStore },
});

const { useChatFileMenu, useChatFileMenuItems } = loadModule(
  "../src/hooks/use-chat-file-menu.tsx",
  {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react-i18next": { useTranslation: translate },
    "../components/icons": {
      IconBrowser: () => null,
      IconCopy: () => null,
      IconExternal: () => null,
      IconFolderOpen: () => null,
      IconGlobe: () => null,
      IconVSCode: () => null,
    },
    "../lib/chat-links": {
      isHtmlFilePath: (path) => /\.html?$/i.test(path),
    },
    "../components/ContextMenu": {
      useContextMenu: () => ({
        contextMenu: null,
        openContextMenu: (_event, request) => {
          calls.menus.push(request);
          return (items) => { request.items = items; };
        },
        closeContextMenu: () => {},
      }),
    },
    "./use-preview-target": previewTarget,
    "./use-chat-session-capability": nativeCapability,
  },
);

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reset(match) {
  Object.values(calls).forEach((list) => list.splice(0, list.length));
  nextMatch = match;
  clipboardFails = false;
  defaultOpenFails = false;
  lookupFails = false;
  state.settings = {};
}

/** The match the main process reports for a file of the project's main folder. */
function projectMatch(overrides = {}) {
  return {
    root: "workspace",
    relativePath: "src/dir/a.ts",
    absolutePath: "C:/project/src/dir/a.ts",
    matchedBy: "exact-relative",
    projectRoot: { primary: true },
    ...overrides,
  };
}

/**
 * Render both hooks for one reference, then click it and run the menu item the
 * right-click would have offered. Both run inside a render, so no side effect
 * fires while React is rendering.
 */
async function openReference(path, destination) {
  let open = null;
  function Harness() {
    open = previewTarget.useOpenChatFileRef();
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  assert.equal(typeof open, "function", "the hook returned a click handler");
  open(path, undefined, undefined, { destination });
  await flush();
}

test("ordinary files and HTML share the file preference and built-in File Manager", async () => {
  for (const name of ["a.ts", "page.HTML", "page.htm"]) {
    reset(projectMatch({ relativePath: name, absolutePath: `C:/project/${name}` }));
    state.settings = { fileOpenTarget: "workpanel", htmlOpenTarget: "external" };
    await openReference(name);
    assert.equal(calls.tabs[0]?.resource, "pi.file-manager/manager");
    assert.equal(calls.tabs[0]?.location, name);
    assert.deepEqual(calls.urls, []);
    assert.deepEqual(calls.defaultBrowsers, []);

    reset(projectMatch({ relativePath: name, absolutePath: `C:/project/${name}` }));
    state.settings = { fileOpenTarget: "external", htmlOpenTarget: "workpanel" };
    await openReference(name);
    assert.deepEqual(calls.defaultBrowsers, [[`C:/project/${name}`, undefined, "session-1"]]);
    assert.deepEqual(calls.tabs, []);
  }
});

test("directories follow the file preference even when their name ends in HTML", async () => {
  const match = projectMatch({ isDirectory: true, relativePath: "outputs.html", absolutePath: "C:/project/outputs.html" });
  reset(match);
  state.settings = { fileOpenTarget: "workpanel" };
  await openReference("outputs.html");
  assert.deepEqual(calls.files, [["C:/project/outputs.html", undefined, { isDirectory: true }]]);
  assert.deepEqual(calls.defaultBrowsers, []);
  await openReference("outputs.html", "file-manager");
  assert.deepEqual(calls.files[1], ["C:/project/outputs.html", undefined, { isDirectory: true }]);
  assert.deepEqual(calls.tabs, []);

  reset(match);
  state.settings = { fileOpenTarget: "external" };
  await openReference("outputs.html");
  assert.deepEqual(calls.defaultBrowsers, [["C:/project/outputs.html", undefined, "session-1"]]);
  assert.deepEqual(calls.urls, []);
});

test("a failed system handoff reports the failure without opening an in-app fallback", async () => {
  reset(projectMatch());
  state.settings = { fileOpenTarget: "external" };
  defaultOpenFails = true;
  await openReference("a.ts");
  assert.deepEqual(calls.tabs, []);
  assert.deepEqual(calls.files, []);
  assert.deepEqual(calls.toasts.map(([message]) => message), ["chat.defaultApplicationOpenFailed:"]);
});

test("local file menus add VS Code and Explorer while retaining the real HTML file submenu", async () => {
  for (const path of ["src/dir/a.ts", "page.html", "outputs", "folder.html", "folder.HTM"]) {
    const directory = path === "outputs" || path.startsWith("folder.");
    reset(projectMatch({ relativePath: path, absolutePath: `C:/project/${path}`, ...(directory ? { isDirectory: true } : {}) }));
    let openFileMenu;
    function Harness() { openFileMenu = useChatFileMenu().openFileMenu; return null; }
    renderToStaticMarkup(React.createElement(Harness));
    openFileMenu({}, { path });
    await flush();
    const items = calls.menus[0].items;
    const html = !directory && /\.html?$/i.test(path);
    assert.deepEqual(items.map(item => [item.id, item.label]), [
      ["open-in-vscode", "chat.openInVSCode:"],
      ...(html ? [["open-with", "chat.openWith:"]] : []),
      ["copy-full-path", "chat.copyFullPath:"],
      ["copy-relative-path", "chat.copyRelativePath:"],
      ["reveal-in-folder", "chat.openInFileExplorer:"],
    ]);
    if (html) {
      assert.deepEqual(items.find(item => item.id === "open-with").submenu.map(item => item.id), [
        "open-with-file-manager", "open-with-built-in-browser", "open-with-default-browser",
      ]);
    } else assert.ok(items.every(item => !item.submenu));
  }
});

test("HTML inspection keeps generic actions on missing files and reports unexpected lookup failures in diagnostics", async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    for (const failure of [false, true]) {
      reset(null);
      lookupFails = failure;
      let openFileMenu;
      function Harness() { openFileMenu = useChatFileMenu().openFileMenu; return null; }
      renderToStaticMarkup(React.createElement(Harness));
      openFileMenu({}, { path: "missing.html" });
      await flush();
      assert.deepEqual(calls.menus[0].items.map(item => item.id), [
        "open-in-vscode", "copy-full-path", "copy-relative-path", "reveal-in-folder",
      ]);
      assert.deepEqual(calls.toasts, [], "passive inspection does not toast an error");
    }
    assert.equal(warnings.length, 1, "unexpected lookup failure remains diagnosable");
    assert.equal(warnings[0][0], "File-reference metadata lookup failed");
  } finally { console.warn = previousWarn; }
});

async function selectFileAction(path, id) {
  let items;
  function Harness() { items = useChatFileMenuItems()({ path }); return null; }
  renderToStaticMarkup(React.createElement(Harness));
  const item = items.find(item => item.id === id);
  assert.ok(item, `missing file action: ${id}`);
  item.onSelect();
  await flush();
}

test("native menu actions resolve the actual file or directory and override its preference", async () => {
  for (const isDirectory of [false, true]) {
    reset(projectMatch({ ...(isDirectory ? { isDirectory: true } : {}) }));
    state.settings = { fileOpenTarget: "workpanel" };
    await selectFileAction("a.ts", "open-in-vscode");
    await selectFileAction("a.ts", "reveal-in-folder");
    assert.deepEqual(calls.vscode, [["C:/project/src/dir/a.ts", "session-1"]]);
    assert.deepEqual(calls.reveals, [["C:/project/src/dir/a.ts", "session-1"]]);
    assert.deepEqual(calls.tabs, []);
    assert.deepEqual(calls.files, []);
    assert.deepEqual(calls.defaultBrowsers, []);
  }
});

test("native actions fail visibly and never fall back to another destination", async () => {
  for (const [destination, message] of [["vscode", "chat.vscodeOpenFailed:"], ["file-explorer", "chat.fileExplorerOpenFailed:"]]) {
    reset(projectMatch());
    defaultOpenFails = true;
    await openReference("a.ts", destination);
    assert.deepEqual(calls.toasts.map(([message]) => message), [message]);
    assert.deepEqual(calls.tabs, []);
    assert.deepEqual(calls.files, []);
    assert.deepEqual(calls.defaultBrowsers, []);
  }
});

test("missing and remote paths cannot reach any native destination", async () => {
  for (const destination of [undefined, "vscode", "file-explorer"]) {
    reset(null);
    state.settings = { fileOpenTarget: "external" };
    await openReference("missing.pdf", destination);
    assert.deepEqual(calls.defaultBrowsers, []);
    assert.deepEqual(calls.vscode, []);
    assert.deepEqual(calls.reveals, []);
    assert.deepEqual(calls.toasts.map(([message]) => message), ["chat.fileRefMissing:missing.pdf"]);

    reset(projectMatch());
    state.settings = { fileOpenTarget: "external" };
    const previous = state.workspace;
    state.workspace = { ...previous, remote: { hostKey: "fixture" } };
    try {
      await openReference("a.ts", destination);
      assert.deepEqual(calls.defaultBrowsers, []);
      assert.deepEqual(calls.vscode, []);
      assert.deepEqual(calls.reveals, []);
      assert.equal(calls.toasts.length, 1);
    } finally { state.workspace = previous; }
  }
});

test("HTML Open with overrides the unified preference for that click", async () => {
  const match = projectMatch({ relativePath: "page.html", absolutePath: "C:/project/page.html" });
  reset(match);
  state.settings = { fileOpenTarget: "external" };
  await openReference("page.html", "file-manager");
  assert.equal(calls.tabs[0]?.location, "page.html");
  assert.deepEqual(calls.defaultBrowsers, []);
  await openReference("page.html", "built-in-browser");
  assert.deepEqual(calls.urls, [["C:/project/page.html"]]);
  state.settings = { fileOpenTarget: "workpanel" };
  await openReference("page.html", "default-browser");
  assert.deepEqual(calls.defaultBrowsers, [["C:/project/page.html", undefined, "session-1"]]);

  reset({ root: "scratch", absolutePath: "C:/data/scratch/session-1/page.html", relativePath: "page.html" });
  await openReference("page.html", "file-manager");
  assert.equal(calls.tabs[0]?.location, "C:/data/scratch/session-1/page.html");
});

test("the HTML browser destination refuses a directory or unavailable browser", async () => {
  reset(projectMatch({ isDirectory: true }));
  await openReference("folder.html", "built-in-browser");
  assert.deepEqual(calls.urls, []);
  assert.deepEqual(calls.toasts.map(([message]) => message), ["chat.builtInBrowserUnavailable:"]);
  const previous = state.pluginViews;
  state.pluginViews = [];
  try {
    reset(projectMatch());
    await openReference("page.html", "built-in-browser");
    assert.deepEqual(calls.urls, []);
    assert.deepEqual(calls.toasts.map(([message]) => message), ["chat.builtInBrowserUnavailable:"]);
  } finally { state.pluginViews = previous; }
});

/** Run one copy item of the reference menu on the reference it names. */
async function copyRef(path, kind) {
  let copy = null;
  let items = null;
  function Harness() {
    copy = previewTarget.useCopyChatFileRef();
    items = useChatFileMenuItems()({ path });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  const id = kind === "absolute" ? "copy-full-path" : "copy-relative-path";
  const item = items.find((entry) => entry.id === id);
  assert.ok(item, "the reference offers the copy");
  copy(path, undefined, kind);
  await flush();
}

test("a project file copies its full address and its project-relative one", async () => {
  reset(projectMatch());
  copied.length = 0;
  await copyRef("src/dir/a.ts", "absolute");
  await copyRef("src/dir/a.ts", "relative");
  assert.deepEqual(copied, ["C:/project/src/dir/a.ts", "src/dir/a.ts"]);
  assert.deepEqual(
    calls.toasts.map(([message]) => message),
    ["chat.copied:", "chat.copied:"],
  );
});

test("a sibling folder file copies its full address and its own relative one", async () => {
  reset(
    projectMatch({
      relativePath: "lib/only-here.ts",
      absolutePath: "C:/project-second/lib/only-here.ts",
      projectRoot: { primary: false },
    }),
  );
  copied.length = 0;
  await copyRef("lib/only-here.ts", "absolute");
  await copyRef("lib/only-here.ts", "relative");
  assert.deepEqual(copied, [
    "C:/project-second/lib/only-here.ts",
    "lib/only-here.ts",
  ]);
});

test("a file outside the project has nothing relative to copy", async () => {
  reset({
    root: "scratch",
    relativePath: "notes.md",
    absolutePath: "C:/data/scratch/session-1/notes.md",
    matchedBy: "exact-relative",
  });
  copied.length = 0;
  await copyRef("notes.md", "absolute");
  await copyRef("notes.md", "relative");
  // The full address is still the file's own; the relative one is refused
  // instead of handing back the absolute path under that name.
  assert.deepEqual(copied, ["C:/data/scratch/session-1/notes.md"]);
  assert.deepEqual(
    calls.toasts.map(([message]) => message),
    ["chat.copied:", "chat.relativePathUnavailable:"],
  );
});

test("a refused clipboard reports itself", async () => {
  reset(projectMatch());
  copied.length = 0;
  clipboardFails = true;
  await copyRef("src/dir/a.ts", "absolute");
  assert.deepEqual(copied, []);
  assert.deepEqual(
    calls.toasts.map(([message]) => message),
    ["chat.copyFailed:"],
  );
});

const transcript = await readTranscriptSource();
const markdown = read("../src/components/Markdown.tsx");
const toolRow = read("../src/features/chat/transcript/ToolRow.tsx");
const toolDetails = read("../src/components/ToolDetails.tsx");
const shared = read("../src/features/chat/transcript/shared.tsx");

test("every transcript surface that names a file opens that item", () => {
  // The chip a user turn renders owns the same item its row does, next to the
  // thumbnail that names the same attachment a second way.
  assert.match(
    shared,
    /const \{ fileMenu, openFileMenu, closeFileMenu \} = useChatFileMenu\(\)/,
  );
  assert.match(shared, /onContextMenu=\{\(event\) => openFileMenu\(event, \{ path \}\)/);
  // An image attachment is the same chip as any other attachment now, so that
  // chip carries the file menu and the shared preview card hangs off it.
  assert.match(
    shared,
    /<ImageHoverCard src=\{dataUrl\} anchor=\{anchor\} onDismiss=\{dismiss\} \/>/,
  );
  assert.match(shared, /<ContextMenu state=\{fileMenu\} onClose=\{closeFileMenu\} \/>/);
  // A tool row's summary and a tool result's file and match lists name files
  // the same way, so they open the same item where the reference is rendered.
  assert.match(toolRow, /previewTarget\?\.kind === "file"/);
  assert.match(toolRow, /openFileMenu\(event, \{ path: previewTarget\.path \}\)/);
  assert.match(toolDetails, /openFileMenu\(event, \{ path: rel \}\)/);
  // Markdown owns one surface for its whole tree, because its blocks are
  // memoized and the references are spread across them.
  assert.match(markdown, /openFileMenu: openMarkdownFileMenu,[\s\S]*?useChatFileMenu\(\)/);
  assert.match(
    markdown,
    /<MarkdownFileMenuContext\.Provider value=\{openMarkdownFileMenu\}>/,
  );
  assert.match(markdown, /<ContextMenu state=\{fileMenu\} onClose=\{closeFileMenu\} \/>/);
  // Inline code, a file link, and a local image each hand their own reference
  // to that surface; `./` and `../` keep the markdown base beside the path.
  assert.match(markdown, /openFileMenu\(event, \{ path: text \?\? target\.path, baseDir \}\)/);
  assert.match(markdown, /openFileMenu\(event, \{ path: ref, baseDir \}\)/);
  assert.match(markdown, /openFileMenu\(event, \{ path: localRef, baseDir \}\)/);
  assert.match(markdown, /onContextMenu=\{onLocalContextMenu\}/);
  // A local image that cannot be shown inline keeps a chip, and both carry the
  // menu only when local tools are allowed and the reference resolved to a file.
  assert.match(
    markdown,
    /const onLocalContextMenu =\s*localToolsAllowed && localRef && openFileMenu/,
  );
});

test("HTTP URLs keep their existing external/work-panel/copy menu", () => {
  const menu = read("../src/hooks/use-chat-file-menu.tsx");
  assert.match(menu, /resolved && !resolved\.isDirectory && isHtmlFilePath\(resolved\.absolutePath\)/);
  assert.ok(markdown.includes('if (!/^https?:\\/\\//i.test(href)) {'));
});

test("the reference labels ship in the catalogs the menu reads", () => {
  const en = read("../../../packages/i18n/src/locales/en/index.ts");
  const zhCN = read("../../../packages/i18n/src/locales/zh-CN/index.ts");
  assert.match(en, /openInVSCode: "Open in VS Code"/);
  assert.match(en, /openInFileExplorer: "Open in File Explorer"/);
  assert.match(en, /defaultApplicationOpenFailed:/);
  assert.match(en, /copyFullPath: "Copy full path"/);
  assert.match(en, /copyRelativePath: "Copy relative path"/);
  assert.match(zhCN, /openInVSCode: "在 VS Code 中打开"/);
  assert.match(zhCN, /openInFileExplorer: "在资源管理器中打开"/);
  assert.match(zhCN, /defaultApplicationOpenFailed:/);
  assert.match(zhCN, /copyFullPath: "复制完整地址"/);
  assert.match(zhCN, /copyRelativePath: "复制相对地址"/);
});

test("remote workspace references retain copy actions but never offer local open actions", () => {
  const before = state.sessions;
  state.sessions = [{ id: state.activeSessionId, remoteWorkspace: { hostKey: "ssh", path: "/work/app" } }];
  let items;
  function Harness() { items = useChatFileMenuItems()({ path: "index.html" }); return null; }
  renderToStaticMarkup(React.createElement(Harness));
  assert.deepEqual(items.map(item => item.id), ["copy-full-path", "copy-relative-path"]);
  state.sessions = before;
});
