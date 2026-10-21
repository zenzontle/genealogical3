import { describe, expect, it } from 'vitest';
import { cardAlignment } from './cardAlignment';

const card = (id: string, x: number, y: number, width = 180, height = 136) => ({
  id,
  type: 'person',
  position: { x, y },
  measured: { width, height },
});

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

  it.each([
    [104, 100], // left edges
    [154, 100], // centers
    [204, 100], // right edges
  ])('uses measured widths for corresponding edges and centers (%i, %i)', (movingX, targetX) => {
    expect(
      cardAlignment([card('moving', movingX, 500, 100)], [card('target', targetX, 0, 200)], 1)
        .offset.x,
    ).toBe(-4);
  });

  it('uses measured heights for bottom alignment and default sizes before measurement', () => {
    expect(
      cardAlignment([card('moving', 600, 204, 180, 100)], [card('target', 0, 100, 180, 200)], 1)
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

  it('does nothing without moving cards or targets', () => {
    expect(cardAlignment([], [card('target', 0, 0)], 1).guides).toEqual([]);
    expect(cardAlignment([card('moving', 4, 4)], [], 1).offset).toEqual({ x: 0, y: 0 });
  });
});
