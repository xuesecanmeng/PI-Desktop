import { transcriptHasLayout } from "./transcript-scroll";

export type TranscriptHistoryAnchor = {
  messageId: string;
  offset: number;
  scrollTop: number;
};

function visibleHistoryRow(row: HTMLElement) {
  return !row.closest('[hidden], [inert], [aria-hidden="true"]') &&
    row.getBoundingClientRect().height > 0;
}

/** A prepend can regroup turns, so anchor a message rather than its outer turn. */
export function captureTranscriptHistoryAnchor(
  scroller: HTMLElement,
  content: HTMLElement,
): TranscriptHistoryAnchor | undefined {
  if (!transcriptHasLayout(scroller)) return;
  const viewport = scroller.getBoundingClientRect();
  let previous: TranscriptHistoryAnchor | undefined;
  for (const row of content.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (!visibleHistoryRow(row)) continue;
    const rect = row.getBoundingClientRect();
    const messageId = row.dataset.messageId;
    if (!messageId) continue;
    const anchor = { messageId, offset: rect.top - viewport.top, scrollTop: scroller.scrollTop };
    // Images and turn metadata can fill the viewport between message boxes.
    if (rect.top >= viewport.bottom) return previous ?? anchor;
    if (rect.bottom > viewport.top) return anchor;
    previous = anchor;
  }
  return previous;
}

export function restoreTranscriptHistoryAnchor(
  scroller: HTMLElement,
  content: HTMLElement,
  anchor: TranscriptHistoryAnchor,
): TranscriptHistoryAnchor | undefined {
  if (!transcriptHasLayout(scroller)) return;
  const id = CSS.escape(anchor.messageId);
  const row = [...content.querySelectorAll<HTMLElement>(`[data-message-id="${id}"]`)]
    .find(visibleHistoryRow);
  // A hidden or unmounted live target cannot safely use a bookmark's fallback.
  if (!row) return;
  const rect = row.getBoundingClientRect();
  // Input during a page request moves the viewport; a boundary clamp does not.
  const previousTop = Math.min(anchor.scrollTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
  const offset = anchor.offset - (scroller.scrollTop - previousTop);
  scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - offset;
  return { ...anchor, offset, scrollTop: scroller.scrollTop };
}
