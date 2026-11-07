/** US Letter in PDF points (1/72 in). */
export const letterPage = { width: 612, height: 792 } as const;
export const pdfMargin = 36;
/** Largest scale, in points per tree pixel: never enlarge a tree past its on-screen size. */
export const pdfMaxScale = 1;
/** Smallest legible scale: 11 px card text prints at about 7 pt. */
export const pdfMinScale = 0.65;
/** Points shared between neighbouring tiles, so connectors line up when pages are joined. */
export const pdfTileOverlap = 18;
/** Tree pixels kept clear between a tile's edge and a card that continues on the next page. */
const seamGap = 6;

/** A card's rectangle in tree pixels; tile edges avoid cutting through cards where they can. */
export type PdfObstacle = { x: number; y: number; width: number; height: number };

/** A rectangle of the tree, in tree pixels, and where it lands on its page, in points. */
export type PdfRegion = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  x: number;
  y: number;
  row: number;
  column: number;
};

export type PdfLayout = {
  orientation: 'portrait' | 'landscape';
  pageWidth: number;
  pageHeight: number;
  /** Points per tree pixel. */
  scale: number;
  rows: number;
  columns: number;
  /** Row-major, one region per page; a single region means the tree fits on one page. */
  regions: PdfRegion[];
};

const orientations = [
  { orientation: 'portrait', pageWidth: letterPage.width, pageHeight: letterPage.height },
  { orientation: 'landscape', pageWidth: letterPage.height, pageHeight: letterPage.width },
] as const;

/**
 * Splits `length` into tiles of at most `tile`, each starting `overlap` before the previous one
 * ends. A tile ends just before the first card it would cut, so that card prints whole on the
 * next page, unless that would leave the tile less than half full.
 */
function tiles(length: number, tile: number, overlap: number, spans: [number, number][]) {
  const result: { start: number; size: number }[] = [];
  let start = 0;
  // The tolerance keeps an exact fit from adding an empty row or column.
  while (length - start > tile + 1e-9) {
    const full = start + tile;
    let end = full;
    for (let cut = true; cut;) {
      cut = false;
      for (const [a, b] of spans)
        if (a - seamGap < end && end < b) {
          end = a - seamGap;
          cut = true;
        }
    }
    if (end - start < tile / 2) end = full;
    result.push({ start, size: end - start });
    start = end - overlap;
  }
  result.push({ start, size: length - start });
  return result;
}

/** Scale and offset, in points, that fit a `width` × `height` tree inside one page's margins. */
export function fitOnPage(width: number, height: number, pageWidth: number, pageHeight: number) {
  const contentWidth = pageWidth - pdfMargin * 2,
    contentHeight = pageHeight - pdfMargin * 2;
  const scale = Math.min(pdfMaxScale, contentWidth / width, contentHeight / height);
  return {
    scale,
    x: pdfMargin + (contentWidth - width * scale) / 2,
    y: pdfMargin + (contentHeight - height * scale) / 2,
  };
}

function layoutFor(
  width: number,
  height: number,
  obstacles: PdfObstacle[],
  { orientation, pageWidth, pageHeight }: (typeof orientations)[number],
): PdfLayout {
  const fit = fitOnPage(width, height, pageWidth, pageHeight);
  if (fit.scale >= pdfMinScale) {
    return {
      orientation,
      pageWidth,
      pageHeight,
      scale: fit.scale,
      rows: 1,
      columns: 1,
      regions: [{ sx: 0, sy: 0, sw: width, sh: height, x: fit.x, y: fit.y, row: 0, column: 0 }],
    };
  }
  const scale = pdfMinScale,
    overlap = pdfTileOverlap / scale;
  const columns = tiles(
    width,
    (pageWidth - pdfMargin * 2) / scale,
    overlap,
    obstacles.map((o) => [o.x, o.x + o.width]),
  );
  const rows = tiles(
    height,
    (pageHeight - pdfMargin * 2) / scale,
    overlap,
    obstacles.map((o) => [o.y, o.y + o.height]),
  );
  return {
    orientation,
    pageWidth,
    pageHeight,
    scale,
    rows: rows.length,
    columns: columns.length,
    regions: rows.flatMap((r, row) =>
      columns.map((c, column) => ({
        sx: c.start,
        sy: r.start,
        sw: c.size,
        sh: r.size,
        x: pdfMargin,
        y: pdfMargin,
        row,
        column,
      })),
    ),
  };
}

/**
 * Lays a `width` × `height` tree out on Letter pages: on one page when it fits at a legible
 * scale, otherwise tiled at the smallest legible scale, with tile edges placed between
 * `obstacles` (cards). Picks the orientation needing fewer pages, then the larger scale, then
 * portrait.
 */
export function layoutPdfPages(
  width: number,
  height: number,
  obstacles: PdfObstacle[] = [],
): PdfLayout {
  const [portrait, landscape] = orientations.map((o) => layoutFor(width, height, obstacles, o));
  if (landscape.regions.length !== portrait.regions.length)
    return landscape.regions.length < portrait.regions.length ? landscape : portrait;
  return landscape.scale > portrait.scale ? landscape : portrait;
}
