import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { UiMessage } from "@pi-desktop/shared";
import type { TranscriptEntry } from "../../apps/desktop/src/lib/assistant-turns";
import { useTranscriptScroll } from "../../apps/desktop/src/features/chat/transcript/hooks/useTranscriptScroll";
import { transcriptHistoryPagingProbe } from "./transcript-history-paging";

declare global {
  var transcriptHistoryProbe: () => Promise<unknown>;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (predicate()) return;
    await frame();
  }
  throw new Error(`History anchor never settled: ${label}; ${JSON.stringify({ loads: current?.loadCount, messages: current?.messageCount, top: current?.scrollRef.current?.scrollTop, showJump: current?.showJump })}`);
}
function messages(start: number, end: number): UiMessage[] {
  return Array.from({ length: end - start }, (_, index) => ({
    id: `m${start + index}`,
    role: (start + index) % 2 ? "assistant" : "user",
    content: `Synthetic message ${start + index}`,
    createdAt: "2026-10-23T00:00:00Z",
  }));
}
function entryId(entry: TranscriptEntry): string {
  if (entry.kind === "message") return entry.message.id;
  if (entry.kind === "compaction") return entry.mark.id;
  return entry.id;
}

type Scenario = "grow" | "page" | "intrinsic" | "late-layout" | "scroll-during-page";
type ProbeState = ReturnType<typeof useTranscriptScroll> & {
  messageCount: number;
  loadCount: number;
  finishPage: () => void;
};
let current: ProbeState;

function Fixture({ scenario }: { scenario: Scenario }) {
  const paging = scenario === "page" || scenario === "scroll-during-page";
  const [rows, setRows] = useState(() => messages(paging ? 100 : 0, 140));
  const [more, setMore] = useState(paging);
  const [running, setRunning] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  const [page] = useState(() => {
    let finish = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    return { done, finish };
  });
  const scroll = useTranscriptScroll({
    sessionId: `history-anchor-${scenario}`,
    messages: rows,
    hasMoreBefore: more,
    onLoadOlder: async () => {
      setLoadCount((count) => count + 1);
      await page.done;
      setRows(messages(0, 140));
      setMore(false);
    },
    isRunning: running,
    askPending: false,
    approvalPending: false,
    paneVisible: true,
    searchTarget: null,
    readingWindow: false,
  });
  current = { ...scroll, messageCount: rows.length, loadCount, finishPage: page.finish };
  const entries = [...scroll.historyEntries, ...(scroll.tailEntry ? [scroll.tailEntry] : [])];
  return <div ref={scroll.wrapRef}>
    <button type="button" data-action="latest" onClick={scroll.jumpToLatest}>Latest</button>
    <button type="button" data-action="send" onClick={() => {
      setRunning(true);
      setRows((previous) => [...previous, ...messages(140, 142)]);
    }}>Send</button>
    <div ref={scroll.scrollRef} onScroll={scroll.handleScroll} style={{ height: 420, overflow: "auto", overflowAnchor: "none" }}>
      <div ref={scroll.contentRef}>
        <div ref={scroll.historyBoundaryRef} style={{ height: 1 }} />
        {entries.map((entry) => <div
          key={entryId(entry)}
          data-message-id={entryId(entry)}
          style={scenario === "intrinsic" ? { contentVisibility: "auto", containIntrinsicSize: "auto 140px" } : undefined}
        >
          <div style={{ height: scenario === "intrinsic" ? 80 + Number(entryId(entry).slice(1)) % 5 * 100 : 100 }}>
            {entryId(entry)}
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}

function readAt(scroller: HTMLElement, top: number) {
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: top - scroller.scrollTop, bubbles: true }));
  scroller.scrollTop = top;
}
function visibleRow(scroller: HTMLElement): HTMLElement {
  const viewport = scroller.getBoundingClientRect();
  const row = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  assert(row, "a visible message must exist");
  return row;
}
function offset(scroller: HTMLElement, row: HTMLElement) {
  return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}
async function settle(scroller: HTMLElement, row: HTMLElement) {
  let previous = "";
  let stable = 0;
  await until(() => {
    const geometry = [current.messageCount, current.historyEntries.length, scroller.scrollHeight, scroller.scrollTop, offset(scroller, row)].join(",");
    stable = geometry === previous ? stable + 1 : 0;
    previous = geometry;
    return stable >= 8;
  }, "layout stops changing");
}

globalThis.transcriptHistoryProbe = async () => {
  const results: { scenario: Scenario; displacement?: number; error?: string }[] = [];
  for (const scenario of ["grow", "page", "intrinsic", "late-layout", "scroll-during-page"] as const) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      flushSync(() => root.render(<Fixture scenario={scenario} />));
      await until(() => current.veilPhase === "off" && current.historyEntries.length >= 39, "initial hydration");
      const scroller = current.scrollRef.current;
      assert(scroller, "scroller must mount");
      await settle(scroller, visibleRow(scroller));
      readAt(scroller, scenario === "late-layout" ? 1000 : 100);
      let row = visibleRow(scroller);
      let before = offset(scroller, row);
      if (scenario === "page" || scenario === "scroll-during-page") {
        await until(() => current.loadCount > 0, "older page requested");
        if (scenario === "scroll-during-page") {
          readAt(scroller, 500);
          row = visibleRow(scroller);
          before = offset(scroller, row);
        }
        current.finishPage();
        await until(() => current.messageCount === 140 && current.historyEntries.length >= 60, "older page rendered");
      } else if (scenario === "late-layout") {
        await frame();
        const above = scroller.querySelector<HTMLElement>("[data-message-id] > div");
        assert(above, "row above the reader must exist");
        above.style.height = "400px";
      } else {
        await until(() => current.historyEntries.length >= 100, "mounted window expanded");
      }
      await settle(scroller, row);
      const displacement = offset(scroller, row) - before;
      assert(Math.abs(displacement) < 2, `${scenario}: reading position moved ${displacement.toFixed(2)}px`);
      if (scenario === "late-layout") {
        const above = scroller.querySelector<HTMLElement>("[data-message-id] > div");
        assert(above, "resized row must remain mounted");
        above.style.height = "100px";
        await settle(scroller, row);
        assert(Math.abs(offset(scroller, row) - before) < 2, "shrinking content must preserve the reading position too");
        above.style.height = "4000px";
        await settle(scroller, row);
        readAt(scroller, scroller.scrollHeight - scroller.clientHeight - 100);
        await frame();
        const nearBottomRow = visibleRow(scroller);
        const nearBottomOffset = offset(scroller, nearBottomRow);
        above.style.height = "100px";
        await settle(scroller, nearBottomRow);
        assert(Math.abs(offset(scroller, nearBottomRow) - nearBottomOffset) < 2, "a browser boundary clamp must not count as reader input");
      }
      assert(current.showJump, "history reading must remain outside follow mode");
      // A later input must move freely, rather than being undone by the anchor.
      const previousTop = scroller.scrollTop;
      readAt(scroller, previousTop - 240);
      await settle(scroller, row);
      assert(Math.abs(scroller.scrollTop - previousTop + 240) < 2, "the next scroll must retain its intended movement");
      const latest = host.querySelector<HTMLButtonElement>('[data-action="latest"]');
      assert(latest, "jump-to-latest action must exist");
      latest.click();
      await until(() => Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2, "jump to latest");
      readAt(scroller, scroller.scrollTop - 300);
      await frame();
      const send = host.querySelector<HTMLButtonElement>('[data-action="send"]');
      assert(send, "send action must exist");
      send.click();
      await until(() => current.messageCount === 142 && !current.showJump && Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2, "new turn resumes follow");
      results.push({ scenario, displacement });
    } catch (error) {
      results.push({ scenario, error: error instanceof Error ? error.message : String(error) });
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  }
  const paging = await transcriptHistoryPagingProbe();
  return { ok: results.every((result) => !result.error) && paging.ok, results, paging };
};
