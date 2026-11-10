import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { contextCompactionMark, type AgentEventEnvelope, type UiMessage } from "@pi-desktop/shared";
import { ContextUsageInspector } from "../../apps/desktop/src/components/ContextUsageInspector";
import { latestTurnContextInspector } from "../../apps/desktop/src/lib/latest-turn-context";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";

await i18n.use(initReactI18next).init({ lng: "en", keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } }, interpolation: { escapeValue: false } });
const history: UiMessage[] = [{ id: "old-reply", role: "assistant", content: "Earlier response", status: "complete",
  createdAt: "2026-10-23T00:00:00Z", providerId: "fixture", modelId: "fixture-model",
  usage: { inputTokens: 190_000, outputTokens: 10_000, totalTokens: 200_000 } }];
const record = { id: "checkpoint", throughMessageId: "old-reply", tokensBefore: 200_000, tokensAfter: 24_000,
  summary: "A compact summary.", createdAt: "2026-10-23T00:00:01Z" };
const send = (event: AgentEventEnvelope["event"]) => useAppStore.getState().handleAgentEvent({ sessionId: "fixture-session", ts: Date.now(), event });
api.onAgentEvent(envelope => useAppStore.getState().handleAgentEvent(envelope));
useAppStore.setState({ activeSessionId: "fixture-session", messages: history, sessionCompactions: {}, isRunning: false,
  runningSessions: {}, settings: { contextUsageDisplay: "remaining" },
  sessions: [{ id: "fixture-session", createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:01Z" }] });

function Harness() {
  const messages = useAppStore(state => state.messages);
  const marks = useAppStore(state => state.sessionCompactions["fixture-session"]);
  const data = latestTurnContextInspector(messages, {}, [{ id: "fixture", models: [{ id: "fixture-model", contextWindow: 256_000 }] }], marks);
  return <><button id="compact" onClick={() => { void useAppStore.getState().compactContext(); }}>Compact context</button>
    {data && <ContextUsageInspector {...data} />}</>;
}
flushSync(() => createRoot(document.getElementById("root")!).render(<Harness />));
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { check(Date.now() < deadline, message); await settle(); }
}
const ring = () => document.querySelector(".context-inspector-ring-value")?.textContent;
Object.assign(window, { async compactionUsageProbe() {
  check(ring() === "22%", "initial provider occupancy is wrong");
  document.getElementById("compact")!.click();
  await until(() => ring() === "≈91%", "successful compaction did not immediately update the cached ring");
  check(useAppStore.getState().messages === history, "compaction changed the visible transcript");
  document.querySelector<HTMLButtonElement>(".context-inspector-trigger")!.click();
  await settle();
  check(document.querySelector(".context-inspector-heading-percent")?.textContent === "≈91%", "popover missed the estimate");
  check(document.querySelector(".context-inspector-window")?.textContent?.includes("≈24K"), "used/window count missed the estimate");
  const providerRow = Array.from(document.querySelectorAll(".context-inspector-summary-row"))
    .find(row => row.querySelector("strong")?.textContent === i18n.t("chat.usageProviderUsage"))?.textContent;
  check(providerRow?.includes("190K"), "provider input was overwritten by an estimate");
  check(document.querySelector(".context-inspector-kpis")?.textContent?.includes("200K"), "provider totals were overwritten");
  check(document.querySelector(".context-inspector-trigger")?.getAttribute("aria-label")?.includes("≈232K"), "accessible label missed the estimate");
  flushSync(() => useAppStore.setState(state => ({ settings: { ...state.settings, contextUsageDisplay: "used" } })));
  check(ring() === "≈9%", "used mode did not follow the estimated occupancy");
  flushSync(() => useAppStore.setState({ activeSessionId: "other-session", messages: [] }));
  flushSync(() => useAppStore.setState({ activeSessionId: "fixture-session", messages: [...history],
    sessionCompactions: { "fixture-session": [contextCompactionMark(JSON.parse(JSON.stringify(record)))] } }));
  check(ring() === "≈9%", "restored checkpoint lost the estimate");
  send({ type: "message_end", message: { ...history[0], id: "new-reply", content: "A new response",
    usage: { inputTokens: 10_000, outputTokens: 1_000, totalTokens: 11_000 } } });
  await settle();
  check(ring() === "4%", "fresh provider usage did not replace the estimate");
  return { immediate: true, transcriptPreserved: true, providerRow: Boolean(providerRow), displayModes: true, restored: true, realUsageWins: true };
} });
