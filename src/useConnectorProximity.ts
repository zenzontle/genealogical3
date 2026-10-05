import { useEffect, type RefObject } from "react";

// Measure screen-space distance so the reveal radius stays consistent at any zoom.
export function useConnectorProximity(
  canvasRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const cards = Array.from(
        canvas.querySelectorAll<HTMLElement>(".person-card"),
      );
      const opacities = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        const distance = pointer
          ? Math.hypot(
              Math.max(rect.left - pointer.x, 0, pointer.x - rect.right),
              Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom),
            )
          : Infinity;
        return Math.max(0, 1 - distance / 80).toFixed(2);
      });
      cards.forEach((card, index) => {
        const opacity = opacities[index];
        if (card.style.getPropertyValue("--connector-opacity") !== opacity)
          card.style.setProperty("--connector-opacity", opacity);
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const leave = () => {
      pointer = null;
      schedule();
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", schedule);
    };
  }, [canvasRef, enabled]);
}
