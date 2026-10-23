import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, it } from "vitest";
import { resolveChatFileRef, resolveUserChatFileRef } from "./chat-ref-resolve.js";
import { listDir, readOpenableFile } from "./workspace-files.js";
import { listUserDirectory, readUserFile, readUserImage, resolveUserFilePath } from "./user-files.js";

const temporary: string[] = [];
afterAll(async () => {
  await Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pi-user-files-"));
  temporary.push(base);
  const workspace = join(base, "project");
  const outside = join(base, "handoffs");
  const attachments = join(base, "attachments");
  await Promise.all([mkdir(workspace), mkdir(outside), mkdir(attachments)]);
  const file = join(outside, "交接 # 100%.md");
  await writeFile(file, "external user file");
  const roots = { project: [{ path: workspace, name: "project", primary: true }], attachments };
  return { base, workspace, outside, attachments, file, roots };
}

it("opens an external user file while scoped tool and remote readers retain containment", async () => {
  const f = await fixture();
  expect(await readUserFile(f.file, f.workspace)).toMatchObject({ kind: "text", content: "external user file" });
  await expect(readOpenableFile(f.file, f.workspace, [])).rejects.toThrow("outside allowed roots");
  expect(await resolveChatFileRef(f.file, f.roots)).toBeNull();
  expect(await resolveUserChatFileRef(f.file, f.roots)).toMatchObject({
    root: "external", relativePath: "", absolutePath: f.file, matchedBy: "exact-absolute",
  });
});

it("opens absolute files without a project and resolves user parent paths and file URLs", async () => {
  const f = await fixture();
  expect((await readUserFile(f.file, null)).content).toBe("external user file");
  expect((await readUserFile("../handoffs/交接 # 100%.md", f.workspace)).content).toBe("external user file");
  expect((await readUserFile(pathToFileURL(f.file).href, null)).content).toBe("external user file");
  expect(await resolveUserChatFileRef(f.file, {})).toMatchObject({ root: "external", absolutePath: f.file });
  expect(resolveUserFilePath("~/notes.md", null)).toBe(join(homedir(), "notes.md"));
  expect(resolveUserFilePath("notes.md", null)).toBeNull();
});

it("keeps project shorthand and attachment identity before classifying external paths", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace, "project.md"), "project");
  const hash = "a".repeat(64);
  await writeFile(join(f.attachments, hash), "attachment");
  expect(await resolveUserChatFileRef("project.md", f.roots)).toMatchObject({ root: "workspace", relativePath: "project.md" });
  expect(await resolveUserChatFileRef(`attachments/${hash}`, f.roots)).toMatchObject({ root: "attachments" });
  expect((await readUserFile(`attachments/${hash}`, null, f.attachments)).content).toBe("attachment");
});

it("lists and follows user-selected directory links outside the project", async (ctx) => {
  const f = await fixture();
  const link = join(f.workspace, "linked");
  try { await symlink(f.outside, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) { ctx.skip(); return; }
    throw error;
  }
  expect((await listUserDirectory("", f.workspace)).some((entry) => entry.name === "linked")).toBe(true);
  expect((await listUserDirectory(link, f.workspace)).some((entry) => entry.name === "交接 # 100%.md")).toBe(true);
  expect((await readUserFile(join(link, "交接 # 100%.md"), f.workspace)).content).toBe("external user file");
  expect((await listDir(f.workspace, "")).some((entry) => entry.name === "linked")).toBe(false);
  expect(await resolveUserChatFileRef(link, f.roots, { allowDirectories: true })).toMatchObject({ root: "external", isDirectory: true });
});

it("previews external images without treating a text file as an image", async () => {
  const f = await fixture();
  const image = join(f.outside, "image.png");
  await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(await readUserImage(image, f.workspace)).toMatchObject({ kind: "image", size: 4 });
  expect(await readUserImage(f.file, f.workspace, undefined, "image/png")).toMatchObject({ kind: "notImage" });
});

it("reports missing files and keeps directory opt-in separate from user access", async () => {
  const f = await fixture();
  const missing = join(f.outside, "missing.md");
  expect(await resolveUserChatFileRef(missing, f.roots)).toBeNull();
  await expect(readUserFile(missing, f.workspace)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readUserImage(missing, f.workspace)).toMatchObject({ kind: "missing", errorCode: "FILE_NOT_FOUND" });
  expect(await resolveUserChatFileRef(f.outside, f.roots)).toBeNull();
  expect(await resolveUserChatFileRef(f.outside, f.roots, { allowDirectories: true })).toMatchObject({ root: "external", isDirectory: true });
});
