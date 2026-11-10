import { snapshotProxyEnv } from "@pi-desktop/shared";

// Capture before app settings mutate process.env; Host restarts reuse this baseline.
export const inheritedProxyEnv = Object.freeze(snapshotProxyEnv(process.env));
