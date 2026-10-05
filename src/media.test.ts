import { afterEach, describe, expect, it, vi } from "vitest";
import { exportPng } from "./media";
import { connectorPath, familyConnectors } from "./familyConnectors";
import { makePerson, makeTree, personCardHeight, type Relation } from "./model";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shared connectors in PNG exports", () => {
  it.each([false, true])(
    "uses canvas geometry and includes bar extents (home=%s)",
    async (hasHome) => {
      const a = makePerson("A", 0, 0),
        b = makePerson("B", 350, 0);
      const c = makePerson("C", 0, -100),
        d = makePerson("D", 400, 260);
      const relations: Relation[] = [
        {
          id: "couple",
          type: "partner",
          personA: a.id,
          personB: b.id,
          status: "current",
          union: "married",
        },
        ...[c, d].flatMap((child) =>
          [a, b].map((parent) => ({
            id: `${parent.id}-${child.id}`,
            type: "parent" as const,
            parentId: parent.id,
            childId: child.id,
            kind: "unspecified" as const,
          })),
        ),
      ];
      const tree = {
        ...makeTree(),
        people: [a, b, c, d],
        relations,
        homePersonId: hasHome ? a.id : null,
      };
      const original = structuredClone(tree);
      const ctx = {
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        stroke: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        roundRect: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        closePath: vi.fn(),
        measureText: (text: string) => ({ width: text.length * 6 }),
        scale: vi.fn(),
      };
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"])),
      };
      const anchor = {
        href: "",
        download: "",
        click: vi.fn(),
        remove: vi.fn(),
      };
      vi.useFakeTimers();
      vi.stubGlobal("document", {
        documentElement: {},
        createElement: (tag: string) => (tag === "canvas" ? canvas : anchor),
        body: { append: vi.fn() },
      });
      vi.stubGlobal("getComputedStyle", () => ({
        getPropertyValue: () => "#123456",
      }));
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      });
      vi.stubGlobal(
        "Path2D",
        class {
          constructor(public path: string) {}
        },
      );
      await exportPng(tree);
      const height = personCardHeight(hasHome);
      const [family] = familyConnectors(tree.people, tree.relations, {
        width: 220,
        height,
      });
      const expected = [
        family.stem,
        family.bar,
        ...family.branches.map((branch) => branch.points),
      ]
        .map(connectorPath)
        .join(" ");
      expect(ctx.stroke.mock.calls[0][0]).toEqual({ path: expected });
      expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
      expect(ctx.translate).toHaveBeenCalledWith(90, 222);
      expect(canvas.width).toBe((620 + 180) * 2);
      expect(canvas.height).toBe((260 + height + 132 + 180) * 2);
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(tree).toEqual(original);
    },
  );
});
