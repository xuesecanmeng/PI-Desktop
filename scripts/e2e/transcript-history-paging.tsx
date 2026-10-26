import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { UiMessage } from "@pi-desktop/shared";
import { SessionPane } from "../../apps/desktop/src/components/SessionPane";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { createTranscriptReadingRuntime } from "../../apps/desktop/src/stores/runtime/transcript-reading-runtime";
import { forgetTranscriptReadingState } from "../../apps/desktop/src/lib/transcript-reading-position";

type Scenario = "ordinary" | "long-turn" | "partial-turn" | "progress";
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (predicate()) return;
    await frame();
  }
  throw new Error(`History paging did not settle: ${label}`);
}

function history(scenario: Scenario): UiMessage[] {
  return Array.from({ length: 600 }, (_, index) => {
    const base: UiMessage = {
      id: `page-${index}`, role: "assistant", content: "", status: "complete",
      createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    };
    if (scenario === "ordinary") return {
      ...base, role: index % 2 ? "assistant" : "user",
      content: `Message ${index}\n\n${"Stable plain text. ".repeat(8 + index % 7 * 5)}`,
    };
    const period = scenario === "progress" ? 600 : scenario === "long-turn" ? 300 : 37;
    if (index % period === 0 && (scenario !== "progress" || index === 0)) return {
      ...base, role: "user", content: `Question ${index}\n\n${"Question details. ".repeat(18)}`,
    };
    if (index % period === 1 || (scenario === "progress" && index % 100 === 0)) return {
      ...base, content: `Progress ${index}: inspecting the next group of files.`,
    };
    if (index % period === period - 1 || index === 599) return {
      ...base, content: `Answer ${index}\n\n${"The final result and detailed explanation. ".repeat(scenario === "partial-turn" ? 22 : 110)}`,
    };
    return {
      ...base, role: "tool", toolName: "Read", toolCallId: `call-${index}`,
      toolStatus: "success", toolArgs: { path: `file-${index}.ts` },
      toolResult: { content: "Synthetic tool output" },
    };
  });
}

function visibleMessage(scroller: HTMLElement): HTMLElement {
  const viewport = scroller.getBoundingClientRect();
  const row = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].find((element) => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  assert(row, "a visible message must exist");
  return row;
}
const offset = (scroller: HTMLElement, row: HTMLElement) =>
  row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

export async function transcriptHistoryPagingProbe() {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  const initial = useAppStore.getState();
  const results: { scenario: Scenario; pages: number; displacement?: number; error?: string }[] = [];
  for (const scenario of ["ordinary", "long-turn", "partial-turn", "progress"] as const) {
    const id = `history-paging-${scenario}`;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column;--composer-dock-height:0px";
    document.body.append(host);
    const root = createRoot(host);
    const all = history(scenario);
    let pages = 0;
    let start = 500;
    let completePage: (() => void) | undefined;
    const reading = createTranscriptReadingRuntime({ get: useAppStore.getState, set: useAppStore.setState }, (sessionId, options) => {
      pages++;
      const end = options.messageBefore ?? all.length;
      const next = Math.max(0, end - (options.messageLimit ?? 100));
      return new Promise((resolve) => {
        completePage = () => {
          completePage = undefined;
          start = next;
          resolve({ session: {
            id: sessionId, title: "Synthetic paged history", createdAt: all[0].createdAt, updatedAt: all[599].createdAt,
            messages: all.slice(next, end), messageStart: next, messageEnd: end,
            hasMoreBefore: next > 0, hasMoreAfter: end < all.length,
          } });
        };
      });
    });
    try {
      flushSync(() => useAppStore.setState({
        ...reading.actions, activeSessionId: id, messages: all.slice(500),
        retainedSessionIds: [id], retainedTranscripts: {}, transcriptViews: {},
        sessionHistory: { [id]: { messageStart: 500, hasMoreBefore: true } },
        settings: { ...initial.settings, theme: "light", showThinking: true, transcriptDisplayMode: "command-first" },
      }));
      flushSync(() => root.render(<I18nextProvider i18n={i18n}><SessionPane sessionId={id} visible /></I18nextProvider>));
      const scroller = host.querySelector<HTMLElement>(".thread-scroll");
      assert(scroller, "the real transcript must mount");
      await until(() => !host.querySelector(".transcript-settle-veil"), "initial hydration");
      for (let gesture = 0; gesture < 4 && !completePage; gesture++) {
        scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100_000 }));
        scroller.scrollTop = 100;
        let stable = 0;
        let previous = "";
        await until(() => {
          const geometry = `${scroller.scrollHeight},${scroller.scrollTop},${Boolean(completePage)}`;
          stable = geometry === previous ? stable + 1 : 0;
          previous = geometry;
          return stable >= 8;
        }, "upward reading gesture");
      }
      assert(completePage, "scrolling to the loaded range's top must request a page");
      const messageId = visibleMessage(scroller).dataset.messageId;
      const before = offset(scroller, visibleMessage(scroller));
      let displacement = 0;
      for (let page = 0; page < 6 && completePage; page++) {
        const previousStart = start;
        completePage();
        await until(() => start < previousStart, "page response");
        let stable = 0;
        let previous = "";
        await until(() => {
          const row = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId ?? "")}"]`);
          const geometry = `${scroller.scrollHeight},${scroller.scrollTop},${row && offset(scroller, row)}`;
          stable = geometry === previous ? stable + 1 : 0;
          previous = geometry;
          return stable >= 8;
        }, "rendered page geometry");
        const row = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId ?? "")}"]`);
        assert(row, "the reading message must remain mounted");
        displacement = offset(scroller, row) - before;
        assert(Math.abs(displacement) < 2, `${scenario}: page ${page + 1} moved ${messageId} by ${displacement.toFixed(2)}px`);
      }
      assert(visibleMessage(scroller).dataset.messageId === messageId, "paging must not reveal a different exchange");
      results.push({ scenario, pages, displacement });
    } catch (error) {
      results.push({ scenario, pages, error: error instanceof Error ? error.message : String(error) });
    } finally {
      flushSync(() => root.unmount());
      host.remove();
      forgetTranscriptReadingState(id);
      useAppStore.setState(initial, true);
    }
  }
  return { ok: results.every((result) => !result.error), results };
}
