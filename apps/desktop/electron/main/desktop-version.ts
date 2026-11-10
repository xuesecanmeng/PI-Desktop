import { app } from "electron";
import { APP_VERSION } from "@pi-desktop/shared";

// Package metadata owns private build labels; APP_VERSION remains the upstream baseline.
export const DESKTOP_VERSION = app.isPackaged ? app.getVersion() : APP_VERSION;
