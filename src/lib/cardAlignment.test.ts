import { describe, expect, it } from 'vitest';
import { cardAlignment } from './cardAlignment';
import { makePerson, makeTree, type Relation } from './model';
import { partnerConnectors } from './partnerConnectors';

const card = (id: string, x: number, y: number, width = 180, height = 136) => ({
  id,
  type: 'person',
  position: { x, y },
  measured: { width, height },
});
const partner: Relation = {
  id: 'couple',
  type: 'partner',
  personA: 'a',
  personB: 'b',
  status: 'current',
  union: 'married',
};

describe('card alignment', () => {
  it('snaps horizontal and vertical axes independently to different cards', () => {
    const moving = card('moving', 104, 294);
    const result = cardAlignment(
      [moving],
      [moving, card('above', 100, -200), card('right', 600, 300)],
      1,
    );
    expect(result.offset).toEqual({ x: -4, y: 6 });
    expect(result.guides.map(({ axis, position }) => ({ axis, position }))).toEqual([
      { axis: 'x', position: 190 },
      { axis: 'y', position: 368 },
    ]);
  });

  it('chooses the nearest alignment, including at negative coordinates', () => {
    expect(
      cardAlignment([card('moving', -104, 250)], [card('far', -110, 0), card('near', -102, 0)], 1)
        .offset,
    ).toEqual({ x: 2, y: 0 });
  });

  it.each([0.05, 0.5, 1, 2])(
    'uses screen pixels at zoom %f and releases beyond the threshold',
    (zoom) => {
      const target = card('target', 0, 0);
      expect(cardAlignment([card('moving', 7 / zoom, 1000)], [target], zoom).offset.x).toBe(
        -7 / zoom,
      );
      const result = cardAlignment([card('moving', 9 / zoom, 1000)], [target], zoom);
      expect(result.offset).toEqual({ x: 0, y: 0 });
      expect(result.guides).toEqual([]);
    },
  );

  it('uses measured widths for centers', () => {
    expect(
      cardAlignment([card('moving', 154, 500, 100)], [card('target', 100, 0, 200)], 1).offset.x,
    ).toBe(-4);
  });

  it.each([104, 204])('does not snap matching edges at %i on either axis', (position) => {
    expect(
      cardAlignment(
        [card('moving', position, position, 100, 100)],
        [card('target', 100, 100, 200, 200)],
        1,
      ),
    ).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
  });

  it('uses measured heights for center alignment and default sizes before measurement', () => {
    expect(
      cardAlignment([card('moving', 600, 154, 180, 100)], [card('target', 0, 100, 180, 200)], 1)
        .offset.y,
    ).toBe(-4);
    expect(
      cardAlignment(
        [{ id: 'moving', type: 'person', position: { x: 104, y: 500 } }],
        [card('target', 100, 0)],
        1,
      ).offset.x,
    ).toBe(-4);
  });

  it('ignores every moving card and connectors as targets', () => {
    const moving = [card('a', 100, 200), card('b', 105, 205)];
    const connector = { ...card('connector', 102, 202), type: 'partnerConnector' };
    expect(cardAlignment(moving, [...moving, connector], 1)).toEqual({
      offset: { x: 0, y: 0 },
      guides: [],
    });
  });

  it('aligns any member of a group with one shared offset', () => {
    const moving = [card('a', 20, 300), card('b', 104, 500)];
    const { offset } = cardAlignment(moving, [...moving, card('target', 100, 0)], 1);
    expect(offset).toEqual({ x: -4, y: 0 });
    expect(moving.map((node) => node.position.x + offset.x)).toEqual([16, 100]);
    expect(moving.map((node) => node.position.x)).toEqual([20, 104]);
  });

  it('aligns a card center to a stationary partner heart on both axes', () => {
    const result = cardAlignment(
      [card('moving', 206, 494)],
      [card('a', 0, 0), card('b', 400, 0), card('other', 900, 500)],
      1,
      [partner],
    );
    expect(result.offset).toEqual({ x: -6, y: 6 });
    expect(result.guides.map(({ axis, position }) => ({ axis, position }))).toEqual([
      { axis: 'x', position: 290 },
      { axis: 'y', position: 568 },
    ]);
    const horizontal = cardAlignment(
      [card('moving', 900, 106)],
      [card('a', 0, 0), card('b', 400, 200)],
      1,
      [partner],
    );
    expect(horizontal.offset.y).toBe(-6);
    expect(horizontal.guides[0]).toMatchObject({ axis: 'y', position: 168, start: 282, end: 1088 });
  });

  it('uses the rendered heart position with live positions, measured sizes, and staggered partners', () => {
    const a = { ...makePerson('A'), id: 'a' };
    const b = { ...makePerson('B'), id: 'b' };
    const positions = new Map([
      ['a', { x: 700, y: 200 }],
      ['b', { x: 350, y: 0 }],
    ]);
    const sizes = new Map([['a', { width: 220, height: 180 }]]);
    const [heart] = partnerConnectors(
      { ...makeTree(), people: [a, b], relations: [partner] },
      positions,
      () => {},
      sizes,
    );
    const result = cardAlignment(
      [card('moving', heart.position.x - 90 + 6, 1000)],
      [card('a', 700, 200, 220, 180), card('b', 350, 0)],
      1,
      [partner],
    );
    expect(result.offset).toEqual({ x: -6, y: 0 });
    expect(result.guides[0]).toMatchObject({ axis: 'x', position: heart.position.x });
  });

  it.each([0.05, 0.5, 1, 2])('uses screen pixels for heart snapping at zoom %f', (zoom) => {
    const nodes = [card('a', 0, 0), card('b', 1000, 0)];
    expect(
      cardAlignment([card('moving', 500 + 7 / zoom, 1000)], nodes, zoom, [partner]).offset.x,
    ).toBe(-7 / zoom);
    expect(
      cardAlignment([card('moving', 500 + 9 / zoom, 1000)], nodes, zoom, [partner]).guides,
    ).toEqual([]);
  });

  it('does not snap to a heart attached to a moving card, including within a group', () => {
    const moving = [card('a', 600, 500), card('moving', 200, 1000)];
    const nodes = [card('a', 0, 0), card('b', 400, 0), moving[1]];
    // The old a/b midpoint would otherwise attract the unrelated moving card.
    expect(cardAlignment(moving, nodes, 1, [partner])).toEqual({
      offset: { x: 0, y: 0 },
      guides: [],
    });
  });

  it('aligns a moving couple by its heart, preserving the space between partners', () => {
    const moving = [card('a', 6, 300), card('b', 406, 300)];
    const result = cardAlignment(moving, [...moving, card('target', 200, 0)], 1, [partner]);
    expect(result.offset).toEqual({ x: -6, y: 0 });
    expect(result.guides[0]).toMatchObject({ axis: 'x', position: 290 });
  });

  it('aligns moving and stationary couple hearts to each other', () => {
    const moving = [card('c', 6, 500), card('d', 406, 500)];
    const result = cardAlignment(moving, [...moving, card('a', -100, 0), card('b', 500, 0)], 1, [
      partner,
      { ...partner, id: 'moving-couple', personA: 'c', personB: 'd' },
    ]);
    expect(result.offset).toEqual({ x: -6, y: 0 });
    expect(result.guides[0]).toMatchObject({ axis: 'x', position: 290 });
  });

  it('ignores incomplete and non-partner relationships', () => {
    const nodes = [card('a', 0, 0), card('b', 400, 0)];
    for (const relation of [
      { ...partner, personB: 'missing' },
      { id: 'parent', type: 'parent', parentId: 'a', childId: 'b', kind: 'biological' } as Relation,
    ]) {
      expect(cardAlignment([card('moving', 206, 1000)], nodes, 1, [relation]).guides).toEqual([]);
    }
  });

  it('does nothing without moving cards or targets', () => {
    expect(cardAlignment([], [card('target', 0, 0)], 1).guides).toEqual([]);
    expect(cardAlignment([card('moving', 4, 4)], [], 1).offset).toEqual({ x: 0, y: 0 });
  });
});
