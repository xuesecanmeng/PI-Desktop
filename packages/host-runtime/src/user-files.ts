import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsEntry, FsImageDataUrlResult, FsReadResult } from "@pi-desktop/shared";
import {
  isAttachmentBlobRef,
  listLocalDirectory,
  previewFile,
  previewImage,
} from "./workspace-files.js";

/** Local user actions address files directly; tool and remote scopes are separate. */
export function resolveUserFilePath(
  ref: string,
  workspaceRoot: string | null | undefined,
  attachmentsRoot?: string | null,
): string | null {
  const raw = String(ref ?? "").trim();
  if (!raw || raw.includes("\0")) return null;
  if (isAttachmentBlobRef(raw)) {
    return attachmentsRoot
      ? join(attachmentsRoot, raw.replaceAll("\\", "/").slice("attachments/".length))
      : null;
  }
  let path = raw;
  if (/^file:/i.test(path)) {
    try {
      path = fileURLToPath(path);
    } catch {
      return null;
    }
  } else if (path === "~") path = homedir();
  else if (/^~[/\\]/.test(path)) path = join(homedir(), path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  return workspaceRoot ? resolve(workspaceRoot, path) : null;
}

function requireUserFilePath(
  ref: string,
  workspaceRoot: string | null | undefined,
  attachmentsRoot?: string | null,
): string {
  const path = resolveUserFilePath(ref, workspaceRoot, attachmentsRoot);
  if (!path) throw new Error("path is not openable");
  return path;
}

export async function readUserFile(
  ref: string,
  workspaceRoot: string | null | undefined,
  attachmentsRoot?: string | null,
  mimeType?: string,
): Promise<FsReadResult> {
  return previewFile(requireUserFilePath(ref, workspaceRoot, attachmentsRoot), ref, mimeType);
}

export async function readUserImage(
  ref: string,
  workspaceRoot: string | null | undefined,
  attachmentsRoot?: string | null,
  mimeType?: string,
): Promise<FsImageDataUrlResult> {
  const path = resolveUserFilePath(ref, workspaceRoot, attachmentsRoot);
  return path ? previewImage(path, ref, mimeType) : { kind: "missing", errorCode: "FILE_NOT_FOUND" };
}

export async function listUserDirectory(
  ref: string,
  workspaceRoot: string | null | undefined,
  attachmentsRoot?: string | null,
): Promise<FsEntry[]> {
  return listLocalDirectory(requireUserFilePath(ref || ".", workspaceRoot, attachmentsRoot));
}
