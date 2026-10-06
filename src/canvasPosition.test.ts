import { describe, expect, it } from "vitest";
import {
  movePeopleToPositions,
  personPositionAtViewCenter,
} from "./canvasPosition";
import { makePerson, makeTree, personCardHeight } from "./model";

describe("saving a group drag", () => {
  it("keeps all moved positions together and leaves other people unchanged", () => {
    const a = makePerson("A", -100, 50);
    const b = makePerson("B", 200, -80);
    const c = makePerson("C", 700, 300);
    const tree = { ...makeTree(), people: [a, b, c] };
    const moved = movePeopleToPositions(tree, [
      { id: a.id, position: { x: -40, y: 90 } },
      { id: b.id, position: { x: 260, y: -40 } },
    ]);
    expect(moved.people.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: -40, y: 90 },
      { x: 260, y: -40 },
      { x: 700, y: 300 },
    ]);
    expect(moved.people[2]).toBe(c);
    expect(tree.people).toEqual([a, b, c]);
    expect(a.x).toBe(-100);
    expect(b.y).toBe(-80);
  });

  it("doesn't create another history entry for duplicate or empty stop events", () => {
    const person = makePerson("A", 30, 40);
    const tree = { ...makeTree(), people: [person] };
    expect(movePeopleToPositions(tree, [])).toBe(tree);
    expect(
      movePeopleToPositions(tree, [
        { id: person.id, position: { x: 30, y: 40 } },
      ]),
    ).toBe(tree);
  });
});

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
