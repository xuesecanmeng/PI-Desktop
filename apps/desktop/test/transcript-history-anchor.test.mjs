import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
globalThis.CSS ??= { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
const { captureTranscriptHistoryAnchor, restoreTranscriptHistoryAnchor } = await import(
  "../src/lib/transcript-history-anchor.ts"
);
const { useTranscriptHistoryAnchor } = await import("../src/hooks/use-transcript-history-anchor.ts");

function fixture() {
  const scroller = {
    scrollTop: 100, scrollHeight: 3000, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
  };
  const rows = [];
  const content = {
    querySelectorAll: (selector) => {
      assert(!selector.includes("minimap"), "turn identity must never resolve a history anchor");
      const id = selector.match(/="([^"]+)"/)?.[1];
      return rows.filter((row) => !id || row.dataset.messageId === id);
    },
  };
  const row = (id, top, height = 100, hidden = false) => ({
    dataset: { messageId: id }, top, height, hidden,
    closest() { return this.hidden ? {} : null; },
    getBoundingClientRect() {
      return { top: this.top - scroller.scrollTop, bottom: this.top + this.height - scroller.scrollTop, height: this.height };
    },
  });
  return { scroller, rows, content, row };
}

test("history capture skips folded fragments even when they report a layout box", () => {
  const { scroller, rows, content, row } = fixture();
  rows.push(row("progress", 100, 100, true), row("empty", 100, 0), row("answer", 120));
  const anchor = captureTranscriptHistoryAnchor(scroller, content);
  assert.deepEqual(anchor, { messageId: "answer", offset: 20, scrollTop: 100 });
  rows[2].top += 250;
  assert.deepEqual(restoreTranscriptHistoryAnchor(scroller, content, anchor), {
    messageId: "answer", offset: 20, scrollTop: 350,
  });
  assert.equal(rows[2].getBoundingClientRect().top, 20);
});

test("hidden and missing live targets keep the current offset without a bookmark fallback", () => {
  const { scroller, rows, content, row } = fixture();
  rows.push(row("answer", 120));
  const anchor = captureTranscriptHistoryAnchor(scroller, content);
  scroller.scrollTop = 80;
  rows[0].hidden = true;
  assert.equal(restoreTranscriptHistoryAnchor(scroller, content, anchor), undefined);
  assert.equal(scroller.scrollTop, 80);
  rows.length = 0;
  assert.equal(restoreTranscriptHistoryAnchor(scroller, content, anchor), undefined);
  assert.equal(scroller.scrollTop, 80);
});

test("reading between message boxes keeps an adjacent source anchor", () => {
  const { scroller, rows, content, row } = fixture();
  rows.push(row("answer", 0, 50), row("next-question", 1000));
  // Generated images and turn metadata can occupy the space after the answer.
  const anchor = captureTranscriptHistoryAnchor(scroller, content);
  assert.deepEqual(anchor, { messageId: "answer", offset: -100, scrollTop: 100 });
  rows[0].top += 200;
  rows[1].top += 200;
  restoreTranscriptHistoryAnchor(scroller, content, anchor);
  assert.equal(scroller.scrollTop, 300);
});

test("page correction preserves input during the read and ignores boundary clamps", () => {
  const { scroller, rows, content, row } = fixture();
  rows.push(row("answer", 120));
  const anchor = captureTranscriptHistoryAnchor(scroller, content);
  scroller.scrollTop = 60;
  rows[0].top += 200;
  const restored = restoreTranscriptHistoryAnchor(scroller, content, anchor);
  assert.equal(scroller.scrollTop, 260);
  assert.equal(restored.offset, 60, "reader input must retain its 40px movement");
  scroller.scrollHeight = 800;
  scroller.scrollTop = 200;
  rows[0].top -= 60;
  assert.equal(restoreTranscriptHistoryAnchor(scroller, content, restored).offset, 60);
  assert.equal(scroller.scrollTop, 200, "a clamp must not be applied as another gesture");
});

test("correction scroll events retain the same message through late placeholder layout", () => {
  const { scroller, rows, content, row } = fixture();
  const answer = row("answer", 120, 600);
  rows.push(answer);
  let history;
  function Fixture() {
    history = useTranscriptHistoryAnchor({ current: scroller }, { current: content }, () => {});
    return null;
  }
  renderToStaticMarkup(createElement(Fixture));
  history.capture();
  answer.top += 200;
  assert.equal(history.restore(), true);
  assert.equal(scroller.scrollTop, 300);
  // A newly mounted earlier row still has a placeholder height at this point.
  rows.unshift(row("earlier", 290, 500));
  history.capture();
  answer.top += 800;
  assert.equal(history.restore(), true);
  assert.equal(scroller.scrollTop, 1100);
  assert.equal(answer.getBoundingClientRect().top, 20);
  scroller.scrollTop = 400;
  history.capture();
  rows[0].top += 100;
  assert.equal(history.restore(), true);
  assert.equal(scroller.scrollTop, 500, "a later reading gesture must acquire its own anchor");
});
