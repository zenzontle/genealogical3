import { describe, expect, it } from "vitest";
import { personPositionAtViewCenter } from "./canvasPosition";
import { personCardHeight } from "./model";

describe("adding a person at the current view center", () => {
  it.each([
    [0, 0, 1, 1200, 800, false],
    [-1200, 450, 0.4, 1024, 768, true],
    [750, -900, 2, 320, 600, false],
  ])(
    "centers a card at viewport (%i, %i) with zoom %f",
    (x, y, zoom, width, height, hasHome) => {
      const position = personPositionAtViewCenter(
        { x, y, zoom },
        { width, height },
        hasHome,
      );
      expect((position.x + 110) * zoom + x).toBeCloseTo(width / 2);
      expect(
        (position.y + personCardHeight(hasHome) / 2) * zoom + y,
      ).toBeCloseTo(height / 2);
    },
  );
});
