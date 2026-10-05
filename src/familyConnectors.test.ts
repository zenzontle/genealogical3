import { describe, expect, it, vi } from "vitest";
import {
  familyConnectors,
  partnerGeometry,
  connectorPoints,
} from "./familyConnectors";
import { relationshipEdges } from "./relationshipEdges";
import {
  addRelation,
  makePerson,
  makeTree,
  removePerson,
  updateRelation,
  type Relation,
  type Tree,
} from "./model";

const size = { width: 220, height: 108 };
function familyFixture(count = 2) {
  const a = makePerson("Jorge", 0, 0),
    b = makePerson("Margot", 350, 0);
  const children = Array.from({ length: count }, (_, i) =>
    makePerson(`Child ${i + 1}`, i * 270, 260 + i * 45),
  );
  const partner: Extract<Relation, { type: "partner" }> = {
    id: "couple",
    type: "partner",
    personA: a.id,
    personB: b.id,
    status: "current",
    union: "married",
  };
  const links: Extract<Relation, { type: "parent" }>[] = children.flatMap(
    (child, i) =>
      [a, b].map((parent, j) => ({
        id: `parent-${i}-${j}`,
        type: "parent",
        parentId: parent.id,
        childId: child.id,
        kind: j === 0 ? "biological" : "adoptive",
      })),
  );
  const tree: Tree = {
    ...makeTree(),
    people: [a, b, ...children],
    relations: [partner, ...links],
  };
  return { a, b, children, partner, links, tree };
}

describe("automatic sibling bars", () => {
  it("appears for a second shared child and disappears after removal or undo", () => {
    const f = familyFixture();
    const one = removePerson(f.tree, f.children[1].id);
    expect(familyConnectors(one.people, one.relations, size)).toEqual([]);
    const saved = structuredClone(f.tree);
    const groups = familyConnectors(f.tree.people, f.tree.relations, size);
    expect(groups).toHaveLength(1);
    expect(groups[0].branches.map((b) => b.childId)).toEqual(
      f.children.map((p) => p.id),
    );
    expect(groups[0].relationIds).toEqual(f.links.map((r) => r.id));
    expect(f.tree).toEqual(saved);
    expect(familyConnectors(one.people, one.relations, size)).toEqual([]);
    expect(familyConnectors(saved.people, saved.relations, size)).toEqual(
      groups,
    );
  });

  it.each([108, 140])(
    "supports six unevenly positioned children and %ipx cards",
    (height) => {
      const f = familyFixture(6);
      f.children[0].x = 1500;
      f.children[5].x = -300;
      const dimensions = { width: 220, height };
      const [group] = familyConnectors(
        f.tree.people,
        f.tree.relations,
        dimensions,
      );
      expect(group.branches).toHaveLength(6);
      expect(group.stem[0]).toEqual(
        partnerGeometry(f.a, f.b, dimensions).midpoint,
      );
      expect(group.bar[0].x).toBe(-190);
      expect(group.bar[1].x).toBe(1610);
      for (const branch of group.branches) {
        const child = f.children.find((p) => p.id === branch.childId)!;
        expect(branch.points[1]).toEqual({ x: child.x + 110, y: child.y });
        expect(branch.points[0].y).toBeLessThan(child.y);
      }
      f.children[0].y = -100;
      const [dragged] = familyConnectors(
        f.tree.people,
        f.tree.relations,
        dimensions,
      );
      const above = dragged.branches.find(
        (b) => b.childId === f.children[0].id,
      )!;
      expect(above.targetHandle).toBe("bottom");
      expect(above.points[1].y).toBe(-100 + height);
      expect(above.points[0].y).toBe(-100 + height + 32);
      expect(connectorPoints([dragged])).toContainEqual(above.points[0]);
      expect(dragged.additionalPaths).toHaveLength(2);
      expect(
        dragged.branches.filter((b) => b.targetHandle === "top"),
      ).toHaveLength(5);
    },
  );

  it("requires two complete matching parent sets and a partnership", () => {
    const f = familyFixture();
    expect(familyConnectors(f.tree.people, f.links, size)).toEqual([]);
    const missing = f.tree.relations.filter((r) => r.id !== f.links[3].id);
    expect(familyConnectors(f.tree.people, missing, size)).toEqual([]);
    const extraParent = makePerson("Guardian");
    const extra: Relation = {
      id: "extra",
      type: "parent",
      parentId: extraParent.id,
      childId: f.children[0].id,
      kind: "guardian",
    };
    expect(
      familyConnectors(
        [...f.tree.people, extraParent],
        [...f.tree.relations, extra],
        size,
      ),
    ).toEqual([]);
    expect(
      familyConnectors(
        f.tree.people.filter((p) => p.id !== f.a.id),
        f.tree.relations,
        size,
      ),
    ).toEqual([]);
  });

  it.each(["step", "guardian"] as const)(
    "leaves %s links individually rendered",
    (kind) => {
      const f = familyFixture();
      const changed = updateRelation(f.tree, { ...f.links[0], kind });
      expect(familyConnectors(changed.people, changed.relations, size)).toEqual(
        [],
      );
    },
  );

  it("groups unspecified links and recognizes reversed partner endpoints", () => {
    const f = familyFixture();
    const relations: Relation[] = [
      { ...f.partner, personA: f.b.id, personB: f.a.id, status: "former" },
      ...f.links.map((r) => ({ ...r, kind: "unspecified" as const })),
    ];
    expect(familyConnectors(f.tree.people, relations, size)).toHaveLength(1);
  });

  it("keeps different parent pairs separate when one person has multiple partners", () => {
    const f = familyFixture(3);
    const other = makePerson("Other parent", -350, 0);
    let tree = { ...f.tree, people: [...f.tree.people, other] };
    tree = addRelation(tree, {
      ...f.partner,
      id: "other-couple",
      personB: other.id,
    });
    tree = updateRelation(tree, { ...f.links[5], parentId: other.id });
    const [group] = familyConnectors(tree.people, tree.relations, size);
    expect(group.branches.map((b) => b.childId)).toEqual(
      f.children.slice(0, 2).map((p) => p.id),
    );
    expect(group.relationIds).not.toContain(f.links[4].id);
    expect(group.relationIds).not.toContain(f.links[5].id);
  });
});

describe("canvas relationship edges", () => {
  it("switches partner and parent handles using live positions without reversing relationships", () => {
    const f = familyFixture(1);
    const original = structuredClone(f.tree);
    const edges = relationshipEdges(
      f.tree,
      new Map([
        [f.a.id, { x: 700, y: 500 }],
        [f.children[0].id, { x: 0, y: -250 }],
      ]),
      null,
      vi.fn(),
    );
    expect(edges.find((e) => e.id === f.partner.id)).toMatchObject({
      source: f.a.id,
      target: f.b.id,
      sourceHandle: "left",
      targetHandle: "right",
    });
    for (const link of f.links) {
      expect(edges.find((e) => e.id === link.id)).toMatchObject({
        source: link.parentId,
        target: link.childId,
        sourceHandle: "top",
        targetHandle: "bottom",
      });
    }
    expect(f.tree).toEqual(original);
    const restored = relationshipEdges(f.tree, new Map(), null, vi.fn());
    expect(restored.find((e) => e.id === f.partner.id)?.sourceHandle).toBe(
      "right",
    );
    expect(restored.find((e) => e.id === f.links[0].id)?.sourceHandle).toBe(
      "bottom",
    );
  });

  it("keeps unassigned handles and uses measured heights for shared connectors", () => {
    const f = familyFixture();
    const unassigned: Relation = {
      id: "unset",
      type: "unassigned",
      personA: f.a.id,
      personB: f.children[0].id,
      sourceHandle: "left",
      targetHandle: "bottom",
    };
    const edges = relationshipEdges(
      { ...f.tree, relations: [...f.tree.relations, unassigned] },
      new Map([[f.b.id, { x: -350, y: 0 }]]),
      null,
      vi.fn(),
      new Map([[f.a.id, { width: 220, height: 200 }]]),
    );
    expect(edges.find((e) => e.id === "unset")).toMatchObject({
      sourceHandle: "left",
      targetHandle: "bottom",
    });
    expect(edges.find((e) => e.id === f.partner.id)).toMatchObject({
      sourceHandle: "left",
      targetHandle: "right",
    });
    const shared = edges.find((e) => e.id === "family:couple")!;
    expect(shared.sourceHandle).toBe("left");
    expect(shared.targetHandle).toBe("right");
    expect(shared.data?.path).toContain("L -65 228");
    const above = familyConnectors(
      f.tree.people.map((p) => ({
        ...p,
        y: p.id === f.a.id || p.id === f.b.id ? 500 : p.y,
      })),
      f.tree.relations,
      size,
    )[0];
    expect(above.branches.every((b) => b.targetHandle === "bottom")).toBe(true);
    expect(above.additionalPaths).toEqual([]);
  });

  it("replaces grouped links, keeps the shared bar decorative, and opens a child from the keyboard", () => {
    const f = familyFixture(),
      select = vi.fn();
    const edges = relationshipEdges(f.tree, new Map(), null, select);
    expect(edges).toHaveLength(4);
    expect(edges.some((edge) => f.links.some((r) => r.id === edge.id))).toBe(
      false,
    );
    const shared = edges.find((edge) => edge.id === "family:couple")!;
    expect(shared.focusable).toBe(false);
    expect(shared.selectable).toBe(false);
    expect(shared.deletable).toBe(false);
    expect(shared.style?.pointerEvents).toBe("none");
    const branch = edges.find(
      (edge) => edge.data?.childId === f.children[0].id,
    )!;
    expect(branch.focusable).toBe(true);
    expect(branch.ariaRole).toBe("button");
    expect(branch.selectable).toBe(false);
    const event = {
      key: "Enter",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    branch.domAttributes!.onKeyDown!(event as never);
    expect(select).toHaveBeenCalledWith(f.children[0].id);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("uses live drag positions without changing saved coordinates, and restores direct edges after editing", () => {
    const f = familyFixture(),
      saved = structuredClone(f.tree);
    const initial = relationshipEdges(f.tree, new Map(), null, vi.fn());
    const dragged = relationshipEdges(
      f.tree,
      new Map([[f.children[0].id, { x: -500, y: 350 }]]),
      null,
      vi.fn(),
    );
    const branch = dragged.find(
      (edge) => edge.data?.childId === f.children[0].id,
    )!;
    expect(branch.data?.path).toContain("L -390 350");
    expect(branch.data?.path).not.toEqual(
      initial.find((edge) => edge.id === branch.id)?.data?.path,
    );
    expect(f.tree).toEqual(saved);
    const changed = updateRelation(f.tree, { ...f.links[0], kind: "guardian" });
    const direct = relationshipEdges(
      changed,
      new Map(),
      f.links[0].id,
      vi.fn(),
    );
    expect(direct).toHaveLength(5);
    expect(direct.every((edge) => !edge.markerEnd)).toBe(true);
    expect(
      direct.find((edge) => edge.id === f.links[0].id)?.style?.strokeWidth,
    ).toBe(3);
    expect(relationshipEdges(saved, new Map(), null, vi.fn())).toHaveLength(4);
  });
});
