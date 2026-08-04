import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dragging that works on a phone.
 *
 * The HTML5 drag-and-drop API is not an option here: it does not fire on touch
 * at all, and this board is mostly read on a phone. So this is built on pointer
 * events, which are the one input model that covers mouse, touch and pen with
 * the same code.
 *
 * The drop target is resolved with elementFromPoint rather than by tracking
 * enter/leave on every zone. During a pointer capture the events all go to the
 * dragged element, so the zones never hear about the pointer crossing them —
 * asking the document what is under the finger is what actually works.
 */

export interface DragState<T> {
  item: T;
  /** Viewport coordinates of the pointer, for positioning the ghost. */
  x: number;
  y: number;
  /** Offset from the pointer to the grabbed element's top-left corner. */
  dx: number;
  dy: number;
  /** data-drop-zone value currently under the pointer, if any. */
  over: string | null;
}

/** Movement in px before a press becomes a drag rather than a tap. */
const SLOP = 6;

/**
 * How long after a drop a click is treated as its tail rather than a real tap.
 * A drag always ends with a click on the grabbed element, and that click must
 * not be mistaken for the user selecting it.
 */
const CLICK_TAIL_MS = 300;

export function useDragDrop<T>(onDrop: (item: T, zone: string) => void) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const droppedAt = useRef(0);

  // Held in a ref as well: the pointer handlers are registered once and would
  // otherwise close over the state as it was when they were attached.
  const dragRef = useRef<DragState<T> | null>(null);
  const pending = useRef<{ item: T; x: number; y: number; dx: number; dy: number } | null>(
    null,
  );
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const zoneAt = (x: number, y: number): string | null => {
    const element = document.elementFromPoint(x, y);
    return element?.closest<HTMLElement>('[data-drop-zone]')?.dataset.dropZone ?? null;
  };

  const start = useCallback((event: React.PointerEvent, item: T) => {
    // Left button or touch only: a right-click must still open the menu.
    if (event.button !== 0) return;

    const box = event.currentTarget.getBoundingClientRect();
    pending.current = {
      item,
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - box.left,
      dy: event.clientY - box.top,
    };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const waiting = pending.current;

      // Below the slop it is still a tap, so the board does not start dragging
      // when someone is trying to scroll it.
      if (waiting && !dragRef.current) {
        const far =
          Math.abs(event.clientX - waiting.x) > SLOP ||
          Math.abs(event.clientY - waiting.y) > SLOP;
        if (!far) return;

        const next: DragState<T> = {
          item: waiting.item,
          x: event.clientX,
          y: event.clientY,
          dx: waiting.dx,
          dy: waiting.dy,
          over: null,
        };
        dragRef.current = next;
        setDrag(next);
      }

      const current = dragRef.current;
      if (!current) return;

      // Stops the page from scrolling under the finger mid-drag.
      event.preventDefault();

      const next = {
        ...current,
        x: event.clientX,
        y: event.clientY,
        over: zoneAt(event.clientX, event.clientY),
      };
      dragRef.current = next;
      setDrag(next);
    };

    const end = (event: PointerEvent) => {
      const current = dragRef.current;
      pending.current = null;
      dragRef.current = null;
      setDrag(null);

      if (!current) return;
      droppedAt.current = Date.now();
      const zone = zoneAt(event.clientX, event.clientY);
      if (zone) onDropRef.current(current.item, zone);
    };

    // Non-passive so preventDefault actually suppresses touch scrolling.
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const justDragged = useCallback(
    () => Date.now() - droppedAt.current < CLICK_TAIL_MS,
    [],
  );

  return { drag, start, justDragged };
}
