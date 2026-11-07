import { describe, expect, it } from 'vitest';
import {
  layoutPdfPages,
  pdfMargin,
  pdfMinScale,
  pdfTileOverlap,
  type PdfLayout,
  type PdfRegion,
} from './pdfLayout';

function expectTilesCover(layout: PdfLayout, width: number, height: number) {
  const overlap = pdfTileOverlap / layout.scale;
  const contentWidth = layout.pageWidth - pdfMargin * 2,
    contentHeight = layout.pageHeight - pdfMargin * 2;
  expect(layout.regions).toHaveLength(layout.rows * layout.columns);
  layout.regions.forEach((region, index) => {
    expect(region.row).toBe(Math.floor(index / layout.columns));
    expect(region.column).toBe(index % layout.columns);
    expect(region.sw * layout.scale).toBeLessThanOrEqual(contentWidth + 1e-9);
    expect(region.sh * layout.scale).toBeLessThanOrEqual(contentHeight + 1e-9);
    expect([region.x, region.y]).toEqual([pdfMargin, pdfMargin]);
    const right = layout.regions[index + 1];
    if (right && right.row === region.row)
      expect(region.sx + region.sw - right.sx).toBeCloseTo(overlap);
    const below = layout.regions[index + layout.columns];
    if (below) expect(region.sy + region.sh - below.sy).toBeCloseTo(overlap);
  });
  const last = layout.regions.at(-1)!;
  expect(last.sx + last.sw).toBeCloseTo(width);
  expect(last.sy + last.sh).toBeCloseTo(height);
  // Every tile but the last in each direction is full, so no page is mostly empty.
  expect(last.sw).toBeGreaterThan(overlap);
  expect(last.sh).toBeGreaterThan(overlap);
}

describe('PDF page layout', () => {
  it('centers a small tree on one portrait page at its on-screen size', () => {
    expect(layoutPdfPages(360, 316)).toEqual({
      orientation: 'portrait',
      pageWidth: 612,
      pageHeight: 792,
      scale: 1,
      rows: 1,
      columns: 1,
      regions: [{ sx: 0, sy: 0, sw: 360, sh: 316, x: 126, y: 238, row: 0, column: 0 }],
    });
  });

  it('turns the page to keep a wide tree on one page above the legibility floor', () => {
    const layout = layoutPdfPages(900, 400);
    expect(layout).toMatchObject({ orientation: 'landscape', scale: 0.8, rows: 1, columns: 1 });
    expect(layout.regions[0]).toMatchObject({ x: 36, y: 36 + (540 - 320) / 2 });
  });

  it('shrinks a tree that fits a page only below its on-screen size', () => {
    const layout = layoutPdfPages(1080, 500);
    expect(layout).toMatchObject({ orientation: 'landscape', scale: 2 / 3, regions: [{}] });
  });

  it('keeps portrait for a tall tree', () => {
    expect(layoutPdfPages(400, 1000)).toMatchObject({ orientation: 'portrait', regions: [{}] });
  });

  it('tiles a tree too wide for one page at the floor scale with overlapping edges', () => {
    const layout = layoutPdfPages(3000, 400);
    expect(layout).toMatchObject({
      orientation: 'landscape',
      scale: pdfMinScale,
      rows: 1,
      columns: 3,
    });
    expectTilesCover(layout, 3000, 400);
  });

  it('tiles a large tree in a grid using the orientation with fewer pages', () => {
    const layout = layoutPdfPages(2400, 3200);
    // Portrait needs 3 columns × 3 rows; landscape needs 3 × 4.
    expect(layout).toMatchObject({ orientation: 'portrait', rows: 3, columns: 3 });
    expectTilesCover(layout, 2400, 3200);
    expectTilesCover(layoutPdfPages(5000, 900), 5000, 900);
  });

  it('adds no extra tile when the tree exactly fills whole tiles', () => {
    const tile = 720 / pdfMinScale,
      step = tile - pdfTileOverlap / pdfMinScale;
    const layout = layoutPdfPages(tile + step, 500);
    expect(layout).toMatchObject({ orientation: 'landscape', columns: 2, rows: 1 });
    expectTilesCover(layout, tile + step, 500);
  });

  it('ends tiles between cards so every card prints whole on some page', () => {
    // A 14 × 11 grid of cards, 220 px apart across and 260 px down, as Arrange spaces them.
    const cards = Array.from({ length: 14 * 11 }, (_, i) => ({
      x: 90 + (i % 14) * 220,
      y: 90 + Math.floor(i / 14) * 260,
      width: 180,
      height: 136,
    }));
    const width = 90 * 2 + 13 * 220 + 180,
      height = 90 * 2 + 10 * 260 + 136;
    const layout = layoutPdfPages(width, height, cards);
    expect(layout.regions.length).toBeGreaterThan(1);
    expectTilesCover(layout, width, height);
    const inside = (card: (typeof cards)[number], r: PdfRegion) =>
      card.x >= r.sx &&
      card.y >= r.sy &&
      card.x + card.width <= r.sx + r.sw &&
      card.y + card.height <= r.sy + r.sh;
    expect(cards.filter((card) => !layout.regions.some((r) => inside(card, r)))).toEqual([]);
    // Without cards, the same tree splits through some of them.
    const plain = layoutPdfPages(width, height);
    expect(cards.some((card) => !plain.regions.some((r) => inside(card, r)))).toBe(true);
  });

  it('keeps moving a tile edge left until it clears overlapping cards', () => {
    // The landscape tile edge (1,107.7 px) falls in the right card; clearing it lands in the left.
    const cards = [
      { x: 850, y: 100, width: 180, height: 136 },
      { x: 1000, y: 100, width: 180, height: 136 },
    ];
    const layout = layoutPdfPages(3000, 400, cards);
    expect(layout.orientation).toBe('landscape');
    expect(layout.regions[0].sx + layout.regions[0].sw).toBeLessThanOrEqual(850);
    expectTilesCover(layout, 3000, 400);
  });

  it('cuts through a card rather than leave a tile less than half full', () => {
    const banner = { x: 100, y: 100, width: 2800, height: 100 };
    const layout = layoutPdfPages(3000, 400, [banner]);
    expect(layout.regions[0].sw).toBeCloseTo(720 / pdfMinScale);
    expectTilesCover(layout, 3000, 400);
  });
});
