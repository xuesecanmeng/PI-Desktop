import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { AppSettings, UiMessage } from "@pi-desktop/shared";
import { AssistantTurn } from "../../apps/desktop/src/features/chat/transcript/AssistantTurn";
import { TranscriptDisclosureProvider } from "../../apps/desktop/src/features/chat/transcript/disclosure";
import { ShowThinkingRow } from "../../apps/desktop/src/components/settings/ShowThinkingRow";
import { buildTranscriptEntries } from "../../apps/desktop/src/lib/assistant-turns";
import { TranscriptSearchContext } from "../../apps/desktop/src/lib/transcript-search-context";
import type { TranscriptSearchTarget } from "../../apps/desktop/src/lib/transcript-reading";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({
  id,
  role,
  content,
  createdAt: "2026-09-17T00:00:00.000Z",
  ...extra,
});

const tool = (
  id: string,
  toolName: string,
  extra: Partial<UiMessage> = {},
): UiMessage =>
  message(id, "tool", "", {
    toolName,
    toolCallId: `call-${id}`,
    toolStatus: "success",
    ...extra,
  });

const run = (id: string, command: string): UiMessage =>
  tool(id, "Bash", {
    toolArgs: { command },
    toolResult: { details: { stdout: "ok", exitCode: 0 } },
  });

/** Real mounted React components: disclosure ownership, preference and search. */
export async function turnProcessProbe() {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const initialSettings = useAppStore.getState().settings;
  const baseSettings: AppSettings = {
    defaultMode: "agent",
    theme: "light",
    enterToSend: true,
    onboardingDismissed: true,
  };
  const setSettings = (patch: Partial<AppSettings> = {}) =>
    flushSync(() => useAppStore.setState({ settings: { ...baseSettings, ...patch } }));
  setSettings();
  const errors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  const notes: string[] = [];
  const check = (value: unknown, name: string) => {
    assert(value, name);
    notes.push(name);
  };
  const render = (
    messages: UiMessage[],
    active = false,
    search: TranscriptSearchTarget | null = null,
    key = "turn",
    expandWhole = true,
  ) => {
    const entry = buildTranscriptEntries(messages).entries.find(
      (item) => item.kind === "assistant-turn",
    );
    assert(entry?.kind === "assistant-turn", "missing turn");
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <TranscriptSearchContext.Provider value={search}>
            <TranscriptDisclosureProvider key={key} sessionId={`turn-process-probe:${key}`}>
              <AssistantTurn entry={entry} isActive={active} />
            </TranscriptDisclosureProvider>
          </TranscriptSearchContext.Provider>
        </I18nextProvider>,
      ),
    );
    assert(!errors.length, `React error: ${errors.map(String).join("; ")}`);
    // Existing segment probes inspect the turn's contents after opening it.
    // Whole-turn lifecycle probes opt out and exercise its default directly.
    const whole = wholeHeader();
    if (expandWhole && whole?.getAttribute("aria-expanded") === "false") click(whole);
  };
  const wholeHeader = () => container.querySelector<HTMLButtonElement>(
    '[data-process-scope="turn"] > button',
  );
  const processHeaders = () =>
    [...container.querySelectorAll<HTMLButtonElement>(".turn-process > button")];
  const firstProcess = () => container.querySelector<HTMLElement>(".turn-process > .turn-process-body");
  const visible = (element: Element | null) =>
    Boolean(element?.getBoundingClientRect().height);
  const click = (element: HTMLElement | null) => {
    assert(element, "missing click target");
    flushSync(() => element.click());
  };
  const row = (id: string) =>
    container.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  const allCollapsed = () =>
    [...container.querySelectorAll<HTMLElement>("[aria-expanded]")].filter(
      (element) => element !== wholeHeader(),
    ).every(
      (element) => element.getAttribute("aria-expanded") === "false",
    );

  const intro = message("intro", "assistant", "Inspecting the files", {
    thinking: "reasoning detail",
    status: "complete",
  });
  const read = tool("read", "Read", {
    toolResult: "read output",
    toolArgs: { path: "src/example.ts" },
  });
  const grep = tool("grep", "Grep", {
    toolResult: "grep output",
    toolArgs: { query: "todo" },
  });
  const bash1 = run("bash1", "pnpm test");
  const bash2 = run("bash2", "pnpm build");
  const edit = tool("edit", "Edit", {
    toolResult: "edit output",
    toolArgs: { path: "src/example.ts" },
  });
  const answer = message("answer", "assistant", "The fix is ready.", {
    status: "complete",
    createdAt: "2026-09-17T00:00:03.000Z",
    responseDurationMs: 1000,
  });
  const mixed = [intro, read, grep, bash1, bash2, edit, answer];

  try {
    // The whole-turn disclosure owns all process segments and command rows.
    // Closing it preserves every nested choice and leaves the answer reachable.
    render(mixed, false, null, "whole-turn", false);
    check(Boolean(wholeHeader()), "a completed turn exposes one whole-process disclosure");
    check(wholeHeader()?.getAttribute("aria-expanded") === "false" &&
      !visible(row("bash1")) && !visible(row("bash2")),
    "the completed whole process starts collapsed, including both commands");
    check(visible(row("answer")) && row("answer")?.closest('[data-process-scope="turn"]') === null,
      "the final answer stays visible outside the collapsed whole process");
    click(wholeHeader());
    check(visible(row("bash1")) && visible(row("bash2")) && allCollapsed(),
      "opening the whole process reveals commands and preserves collapsed segments");
    click(processHeaders()[0]);
    click(row("bash1")?.querySelector<HTMLElement>(".tool-row-header") ?? null);
    click(wholeHeader());
    check(!visible(row("bash1")) && !visible(firstProcess()),
      "closing the whole process hides an expanded segment and command output together");
    click(wholeHeader());
    check(processHeaders()[0]?.getAttribute("aria-expanded") === "true" &&
      processHeaders()[1]?.getAttribute("aria-expanded") === "false" &&
      row("bash1")?.classList.contains("open") === true && visible(row("bash1")),
    "reopening the whole process restores independent segment and command choices");

    const wholeLive = [read, run("whole-live", "pwsh -Command Get-Date")];
    render(wholeLive, true, null, "whole-lifecycle", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "true" && visible(row("whole-live")),
      "an untouched running whole process starts open");
    render([...wholeLive, answer], false, null, "whole-lifecycle", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "false" &&
      !visible(row("whole-live")) && visible(row("answer")),
    "completion collapses the untouched whole process and keeps the answer visible");

    render(wholeLive, true, null, "whole-manual-close", false);
    click(wholeHeader());
    render([...wholeLive, run("next-command", "echo next")], true, null, "whole-manual-close", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "false" && !visible(row("next-command")),
      "a manual whole-process close survives new streaming commands");

    render(wholeLive, true, null, "whole-child-owned", false);
    click(row("whole-live")?.querySelector<HTMLElement>(".tool-row-header") ?? null);
    render([...wholeLive, answer], false, null, "whole-child-owned", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "true" && visible(row("whole-live")),
      "completion preserves a whole process whose command details the user opened");

    render(wholeLive, true, null, "whole-keyboard", false);
    const commandHeader = row("whole-live")?.querySelector<HTMLButtonElement>(".tool-row-header");
    assert(commandHeader, "missing command keyboard target");
    flushSync(() => commandHeader.focus());
    render([...wholeLive, answer], false, null, "whole-keyboard", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "true" && document.activeElement === commandHeader,
      "completion preserves keyboard focus inside the whole process");
    click(wholeHeader());
    check(document.activeElement === wholeHeader() && !visible(row("whole-live")),
      "manual whole-process collapse returns hidden keyboard focus to its title");

    render(mixed, false, null, "whole-retained", false);
    click(wholeHeader());
    click(processHeaders()[0]);
    flushSync(() => root.render(null));
    render(mixed, false, null, "whole-retained", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "true" &&
      processHeaders()[0]?.getAttribute("aria-expanded") === "true" &&
      processHeaders()[1]?.getAttribute("aria-expanded") === "false",
    "whole and segment choices survive a session pane remount independently");

    render(mixed, false, null, "whole-search", false);
    render(mixed, false, { sessionId: "s", messageId: "edit", query: "edit", requestId: 10 },
      "whole-search", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "true" &&
      processHeaders()[1]?.getAttribute("aria-expanded") === "true" && visible(row("edit")),
    "search opens both the whole process and the segment that owns its target");
    click(wholeHeader());
    render(mixed, false, { sessionId: "s", messageId: "edit", query: "edit", requestId: 10 },
      "whole-search", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "false",
      "replaying the same search cannot override a manual whole-process close");
    render(mixed, false, { sessionId: "s", messageId: "bash2", query: "pnpm", requestId: 11 },
      "whole-search", false);
    check(wholeHeader()?.getAttribute("aria-expanded") === "true" && visible(row("bash2")),
      "a new command search reveals its collapsed whole process");

    // Commands remain outside segment disclosures and independently expandable
    // while the enclosing whole process is open.
    render(mixed);
    const bash1Row = row("bash1");
    const bash2Row = row("bash2");
    check(Boolean(bash1Row) && Boolean(bash2Row), "both adjacent Bash rows render");
    check(
      bash1Row?.closest(".turn-process") === null &&
        bash2Row?.closest(".turn-process") === null,
      "no Bash row is inside a segment disclosure",
    );
    check(
      bash1Row?.closest(".turn-run-row") !== null &&
        bash1Row?.closest(".turn-run-row") !== bash2Row?.closest(".turn-run-row"),
      "adjacent Bash rows each render standalone",
    );
    check(
      bash1Row?.closest(".process-activity-group") === null &&
        bash1Row?.closest(".tool-activity-group") === null,
      "Bash rows are not folded into an activity group",
    );
    check(allCollapsed(), "the completed inner segments start fully collapsed");
    check(
      visible(bash1Row) && visible(bash2Row),
      "Bash rows stay visible with every inner disclosure collapsed",
    );
    check(
      !visible(row("read")) && !visible(row("grep")),
      "non-run work stays inside its collapsed process",
    );
    check(
      bash1Row?.classList.contains("open") !== true,
      "a Bash row keeps its detail closed until opened",
    );
    click(bash1Row?.querySelector<HTMLElement>(".tool-row-header") ?? null);
    check(
      bash1Row?.classList.contains("open") === true,
      "a Bash row opens its own detail on request",
    );

    // Each process chunk owns its recorded duration even though thinking state
    // still follows the whole turn. Bash and the final answer are not its work.
    const timedRead = tool("timed-read", "Read", {
      toolDurationMs: 2000,
      toolResult: "read output",
    });
    const timedBash = {
      ...run("timed-bash", "echo timing"),
      createdAt: "2026-09-17T00:00:10.000Z",
      toolDurationMs: 5000,
    };
    const timedEdit = tool("timed-edit", "Edit", {
      createdAt: "2026-09-17T00:00:30.000Z",
      toolDurationMs: 7000,
      toolResult: "edit output",
    });
    const timedAnswer = {
      ...answer,
      id: "timed-answer",
      createdAt: "2026-09-17T00:00:50.000Z",
      responseDurationMs: 5000,
    };
    const timingLabels = () => processHeaders().map((header) =>
      header.querySelector(".tool-activity-label")?.textContent);
    const expectedTimings = ["2s", "7s"].map((time) => i18n.t("chat.processedFor", { time }));
    render([timedRead, timedBash, timedEdit, timedAnswer], false, null, "segment-timing");
    check(JSON.stringify(timingLabels()) === JSON.stringify(expectedTimings),
      `process chunks show their own 2s and 7s, not the full turn: ${timingLabels()}`);
    check(wholeHeader()?.textContent?.includes(i18n.t("chat.processedFor", { time: "55s" })),
      "only the whole-process summary includes the final answer in its total duration");
    render([timedRead, timedBash, timedEdit, {
      ...timedAnswer, responseDurationMs: 25_000,
    }], false, null, "segment-timing");
    check(JSON.stringify(timingLabels()) === JSON.stringify(expectedTimings),
      "a later answer update cannot change completed process chunk durations");
    check(wholeHeader()?.textContent?.includes(i18n.t("chat.processedFor", { time: "1m 15s" })),
      "a later answer update changes the whole total without changing segment timing");

    const realNow = Date.now;
    try {
      Date.now = () => Date.parse("2026-09-17T00:00:35.000Z");
      render([timedRead, timedBash, {
        ...timedEdit, status: "streaming", toolStatus: "running", toolDurationMs: undefined,
      }], true, null, "live-segment-timing");
      const liveTimings = [
        i18n.t("chat.processedFor", { time: "2s" }),
        i18n.t("chat.processingFor", { time: "5s" }),
      ];
      check(JSON.stringify(timingLabels()) === JSON.stringify(liveTimings),
        "only the active chunk counts from its own start while previous chunks stay settled");
      render([timedRead, timedBash, timedEdit], false, null, "live-segment-timing");
      check(JSON.stringify(timingLabels()) === JSON.stringify(expectedTimings),
        "finishing the active chunk replaces live elapsed time with its recorded duration");
    } finally {
      Date.now = realNow;
    }

    // A command-only turn still has the whole-process control, with no segments.
    render([run("only1", "echo 1"), { ...run("only2", "Get-Date"), toolName: "PowerShell" }],
      false, null, "only-bash");
    check(
      container.querySelectorAll(".turn-process").length === 0,
      "a command-only turn renders no inner process segment",
    );
    check(Boolean(wholeHeader()), "a command-only turn retains its whole-process control");
    check(
      visible(row("only1")) && visible(row("only2")),
      "both Bash and PowerShell rows are visible inside the opened whole process",
    );
    click(wholeHeader());
    check(!visible(row("only1")) && !visible(row("only2")),
      "the whole-process control collapses Bash and PowerShell together");
    render([answer], false, null, "answer-only", false);
    check(!wholeHeader() && visible(row("answer")), "a plain answer has no empty whole-process control");

    // Active process content opens while the turn runs and closes when it stops.
    const activeTurn = [intro, read, grep];
    render(activeTurn, true, null, "active");
    check(
      firstProcess() !== null &&
        processHeaders()[0]?.getAttribute("aria-expanded") === "true" &&
        visible(firstProcess()),
      "the active process chunk starts open",
    );
    render(activeTurn, false, null, "active");
    check(
      processHeaders()[0]?.getAttribute("aria-expanded") === "false" &&
        !visible(firstProcess()),
      "an untouched process chunk collapses on completion",
    );

    // A streaming thinking chunk superseded by a later Bash row must not keep a
    // false Thinking header: the real tail is the Bash row.
    const supersededThought = message("thought-before-bash", "assistant", "", {
      thinking: "Reasoning before a command",
      status: "streaming",
    });
    const bashLive = run("bash-live", "pnpm test");
    const thinkingLabel = i18n.t("chat.thinkingFor", { time: "" });
    render([supersededThought, bashLive], true, null, "thinking-to-bash");
    check(
      row("bash-live")?.closest(".turn-process") === null &&
        visible(row("bash-live")),
      "a Bash row that supersedes thinking stays standalone and visible",
    );
    check(
      !processHeaders().some((header) =>
        header
          .querySelector(".tool-activity-label")
          ?.textContent?.startsWith(thinkingLabel),
      ),
      "a superseded thinking chunk does not keep a Thinking header",
    );
    setSettings({ showThinking: false });
    render([supersededThought, bashLive], true, null, "thinking-to-bash-hidden");
    check(
      container.querySelectorAll(".turn-process").length === 0 &&
        visible(row("bash-live")),
      "hidden superseded thinking leaves no empty process and keeps the Bash row",
    );
    setSettings();

    // A separate streamed answer supersedes the thinking chunk the same way.
    const supersededThought2 = message("thought-before-answer", "assistant", "", {
      thinking: "Reasoning before an answer",
      status: "streaming",
    });
    const separateAnswer = message("stream-answer", "assistant", "Answer text", {
      status: "streaming",
    });
    render([supersededThought2, separateAnswer], true, null, "thinking-to-answer");
    check(
      Boolean(row("stream-answer")) &&
        row("stream-answer")?.closest(".turn-process") === null,
      "a separate streamed answer stays outside the process",
    );
    check(
      !processHeaders().some((header) =>
        header
          .querySelector(".tool-activity-label")
          ?.textContent?.startsWith(thinkingLabel),
      ),
      "a separate streamed answer clears the Thinking header",
    );
    setSettings({ showThinking: false });
    render([supersededThought2, separateAnswer], true, null, "thinking-to-answer-hidden");
    check(
      container.querySelectorAll(".turn-process").length === 0 &&
        !container.querySelector(".thinking") &&
        Boolean(row("stream-answer")),
      "hidden thinking superseded by a separate answer leaves no empty process",
    );
    setSettings();

    // Show thinking off: the live indicator stays, completed reasoning leaves
    // nothing behind, and stored reasoning is never deleted.
    const liveThought = message("live-thought", "assistant", "", {
      thinking: "Reasoning before the answer",
      status: "streaming",
    });
    setSettings({ showThinking: false });
    render([liveThought], true, null, "thought-off-live");
    const liveHeader = processHeaders()[0];
    check(
      liveHeader?.querySelector(".tool-activity-label")?.textContent?.startsWith(
        i18n.t("chat.thinkingFor", { time: "" }),
      ),
      "show thinking off keeps the live thinking indicator in the header",
    );
    check(
      Boolean(container.querySelector(".thinking-compact")),
      "show thinking off shows the live thinking row",
    );
    click(liveHeader);
    check(
      allCollapsed() &&
        liveHeader?.querySelector(".tool-activity-label")?.textContent?.startsWith(
          i18n.t("chat.thinkingFor", { time: "" }),
        ),
      "the live thinking indicator stays visible with the process closed",
    );
    render([{ ...liveThought, status: "complete" }], false, null, "thought-off-done");
    check(
      !wholeHeader() && !container.querySelector(".turn-process") && !container.querySelector(".thinking"),
      "completed hidden thinking leaves no empty container",
    );
    check(
      liveThought.thinking === "Reasoning before the answer",
      "hiding thinking never deletes stored reasoning",
    );
    setSettings({ showThinking: true });
    render([{ ...liveThought, status: "complete" }], false, null, "thought-on-done");
    check(
      Boolean(container.querySelector(".tool-row.thinking")),
      "turning show thinking back on restores the completed reasoning row",
    );
    check(
      container.textContent?.includes("Reasoning before the answer"),
      "the restored row shows the retained reasoning text",
    );

    // Search reveal opens the process chunk that owns the named message.
    setSettings();
    render(
      mixed,
      false,
      { sessionId: "s", messageId: "read", query: "read", requestId: 1 },
      "search",
    );
    check(
      processHeaders()[0]?.getAttribute("aria-expanded") === "true" &&
        visible(firstProcess()),
      "search reveals the process chunk that owns the target",
    );

    // The Settings row is a boolean Show thinking toggle.
    let saved: Partial<AppSettings> | undefined;
    const settings: AppSettings = { ...baseSettings, showThinking: false };
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <ShowThinkingRow
            settings={settings}
            saveSettings={async (patch) => {
              saved = patch;
            }}
          />
        </I18nextProvider>,
      ),
    );
    const toggle = container.querySelector<HTMLElement>('[role="switch"]');
    check(
      toggle?.getAttribute("aria-checked") === "false",
      "the Show thinking row reflects the stored preference",
    );
    click(toggle);
    check(
      saved?.showThinking === true,
      "the Show thinking row saves the boolean preference",
    );

    return { ok: true, checks: notes };
  } finally {
    flushSync(() => root.unmount());
    useAppStore.setState({ settings: initialSettings });
    container.remove();
  }
}
