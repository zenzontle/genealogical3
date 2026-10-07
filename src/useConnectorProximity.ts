import { useEffect, type RefObject } from 'react';

// Cache screen-space bounds until cards or the viewport change. Pointer frames
// use only cached numbers, keeping the reveal radius consistent at any zoom.
export function trackConnectorProximity(canvas: HTMLElement) {
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;
  let dirty = true;
  let bounds: { card: HTMLElement; rect: DOMRect }[] = [];
  const observed = new Set<HTMLElement>();
  const update = () => {
    frame = 0;
    if (dirty) {
      dirty = false;
      const cards = Array.from(canvas.querySelectorAll<HTMLElement>('.person-card'));
      bounds = cards.map((card) => ({
        card,
        rect: card.getBoundingClientRect(),
      }));
      const current = new Set(cards);
      for (const card of observed) {
        if (!current.has(card)) {
          resizeObserver.unobserve(card);
          observed.delete(card);
        }
      }
      for (const card of cards) {
        if (!observed.has(card)) {
          resizeObserver.observe(card);
          observed.add(card);
        }
      }
    }
    for (const { card, rect } of bounds) {
      const distance = pointer
        ? Math.hypot(
            Math.max(rect.left - pointer.x, 0, pointer.x - rect.right),
            Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom),
          )
        : Infinity;
      const opacity = Math.max(0, 1 - distance / 80).toFixed(2);
      if (card.style.getPropertyValue('--connector-opacity') !== opacity)
        card.style.setProperty('--connector-opacity', opacity);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const invalidate = () => {
    dirty = true;
    schedule();
  };
  const resizeObserver = new ResizeObserver(invalidate);
  resizeObserver.observe(canvas);
  const mutationObserver = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          mutation.type !== 'attributes' ||
          (mutation.target instanceof HTMLElement &&
            (mutation.target.matches('.react-flow__viewport, .react-flow__node') ||
              (mutation.attributeName === 'class' && mutation.target.matches('.person-card')))),
      )
    )
      invalidate();
  });
  mutationObserver.observe(canvas, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  const move = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  };
  const leave = () => {
    pointer = null;
    schedule();
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerleave', leave);
  window.addEventListener('resize', invalidate);
  window.addEventListener('scroll', invalidate, true);
  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerleave', leave);
    window.removeEventListener('resize', invalidate);
    window.removeEventListener('scroll', invalidate, true);
  };
}

export function useConnectorProximity(
  canvasRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && enabled) return trackConnectorProximity(canvas);
  }, [canvasRef, enabled]);
}
