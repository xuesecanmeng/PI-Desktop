import { useCallback, useRef, type RefObject } from "react";
import {
  captureTranscriptReadingPosition,
  restoreTranscriptReadingPosition,
  type TranscriptReadingPosition,
} from "../lib/transcript-reading-position";

/** Keep the visible message stable through deferred prepends and late layout. */
export function useTranscriptHistoryAnchor(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  windowSize: number,
  onPosition: (top: number) => void,
) {
  const positionRef = useRef<TranscriptReadingPosition | undefined>(undefined);
  const capture = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    positionRef.current = captureTranscriptReadingPosition(scroller, content, false, windowSize);
  }, [contentRef, scrollRef, windowSize]);
  const release = useCallback(() => { positionRef.current = undefined; }, []);
  const restore = useCallback(() => {
    const position = positionRef.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!position || !scroller || !content) return false;
    // Input can move the viewport while a page is in flight. Compensate only
    // the layout change; a boundary clamp is not reader input.
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const previousTop = Math.min(position.scrollTop, maxTop);
    const offset = position.offset - (scroller.scrollTop - previousTop);
    // A live anchor's fallback must not replay a bookmark older than reader input.
    if (!restoreTranscriptReadingPosition(scroller, content, { ...position, offset, scrollTop: scroller.scrollTop })) {
      release();
      return false;
    }
    onPosition(scroller.scrollTop);
    capture();
    return true;
  }, [capture, contentRef, onPosition, release, scrollRef]);
  return { capture, restore, release };
}
