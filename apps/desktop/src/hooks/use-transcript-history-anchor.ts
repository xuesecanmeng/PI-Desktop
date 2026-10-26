import { useCallback, useRef, type RefObject } from "react";
import {
  captureTranscriptHistoryAnchor,
  restoreTranscriptHistoryAnchor,
  type TranscriptHistoryAnchor,
} from "../lib/transcript-history-anchor";

/** Keep the visible message stable through deferred prepends and late layout. */
export function useTranscriptHistoryAnchor(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  onPosition: (top: number) => void,
) {
  const positionRef = useRef<TranscriptHistoryAnchor | undefined>(undefined);
  const capture = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const previous = positionRef.current;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    // Correction events must not replace the target with a newly prepended row
    // whose content-visibility placeholder has not resolved yet.
    if (previous && scroller.scrollTop === Math.min(previous.scrollTop, maxTop)) return;
    positionRef.current = captureTranscriptHistoryAnchor(scroller, content);
  }, [contentRef, scrollRef]);
  const release = useCallback(() => { positionRef.current = undefined; }, []);
  const restore = useCallback(() => {
    const position = positionRef.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!position || !scroller || !content) return false;
    const restored = restoreTranscriptHistoryAnchor(scroller, content, position);
    if (!restored) return false;
    positionRef.current = restored;
    onPosition(scroller.scrollTop);
    return true;
  }, [contentRef, onPosition, scrollRef]);
  return { capture, restore, release };
}
