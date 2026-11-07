import {
  assertValidLifeDates,
  personLifeLabel,
  normalizeHomePerson,
  personCardSize,
  relationLabel,
  treeDocumentVersion,
  type Tree,
} from './model';
import { relationshipIcons } from './relationshipIcons';
import { calculateKinships } from './kinship';
import { connectionHandles } from './connectionHandles';
import {
  connectorPath,
  connectorPoints,
  familyConnectors,
  partnerGeometry,
} from './familyConnectors';
import { buildPdf, type PdfImagePage } from './pdf';
import { fitOnPage, layoutPdfPages, pdfMargin } from './pdfLayout';
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const safeName = (name: string) =>
  name
    .normalize('NFC')
    .trim()
    // Keep letters and digits from any script; drop characters filesystems reject.
    .replace(/[^\p{L}\p{M}\p{N}\-_ ]/gu, '')
    .replace(/\s+/g, '-') || 'family-tree';
export function exportJson(tree: Tree) {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  downloadBlob(
    new Blob(
      [JSON.stringify({ ...normalized, version: treeDocumentVersion(normalized) }, null, 2)],
      {
        type: 'application/json',
      },
    ),
    `${safeName(tree.name)}.json`,
  );
}
export async function portraitData(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 20_000_000) throw Error('Choose an image smaller than 20 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Could not process the image.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error('A portrait could not be loaded.'));
    img.src = src;
  });
export async function exportPng(tree: Tree) {
  assertValidLifeDates(tree);
  tree = normalizeHomePerson(tree);
  if (!tree.people.length) throw Error('Add a person before exporting an image.');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('PNG export is unavailable in this browser.');
  const drawing = await prepareTreeDrawing(tree, ctx);
  const { width, height } = drawing;
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(28_000_000 / (width * height)));
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  ctx.scale(scale, scale);
  drawing.draw(ctx);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Could not render the PNG.');
  downloadBlob(blob, `${safeName(tree.name)}.png`);
}
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
/** PDF pages are rasterized at 200 dpi. */
const pdfPixelsPerPoint = 200 / 72;
/** About 100 MB of JPEG; larger trees should be arranged or split first. */
export const maxPdfPages = 50;
export async function exportPdf(tree: Tree) {
  assertValidLifeDates(tree);
  tree = normalizeHomePerson(tree);
  if (!tree.people.length) throw Error('Add a person before exporting a PDF.');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('PDF export is unavailable in this browser.');
  const drawing = await prepareTreeDrawing(tree, ctx);
  const layout = layoutPdfPages(drawing.width, drawing.height, drawing.cards);
  const { pageWidth, pageHeight, regions } = layout;
  const tiled = regions.length > 1;
  const total = regions.length + (tiled ? 1 : 0);
  if (total > maxPdfPages)
    throw Error(
      `This tree needs ${total} PDF pages, more than the limit of ${maxPdfPages}. Use Arrange to make it more compact, or split it into smaller trees.`,
    );
  const k = pdfPixelsPerPoint;
  canvas.width = Math.round(pageWidth * k);
  canvas.height = Math.round(pageHeight * k);
  /** Maps tree pixel (sx, sy) to page point (x, y) at `scale` points per tree pixel. */
  const place = (scale: number, x: number, y: number, sx = 0, sy = 0) =>
    ctx.setTransform(scale * k, 0, 0, scale * k, (x - sx * scale) * k, (y - sy * scale) * k);
  const pages: PdfImagePage[] = [];
  const render = async (paint: () => void, footer?: string) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    paint();
    ctx.restore();
    if (footer) {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = '#4a4a4a';
      ctx.font = '8px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(footer, pageWidth / 2, pageHeight - pdfMargin / 2);
      ctx.restore();
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) throw Error('Could not render the PDF.');
    pages.push({
      width: pageWidth,
      height: pageHeight,
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    });
  };
  if (tiled) {
    const fit = fitOnPage(drawing.width, drawing.height, pageWidth, pageHeight);
    await render(
      () => {
        place(fit.scale, fit.x, fit.y);
        drawing.draw(ctx);
        // Outline each tile, labelled with its page number, in page points.
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.lineWidth = 0.75;
        ctx.setLineDash([4, 3]);
        ctx.font = 'bold 9px system-ui';
        regions.forEach((region, index) => {
          const x = fit.x + region.sx * fit.scale,
            y = fit.y + region.sy * fit.scale;
          ctx.strokeStyle = '#333333';
          ctx.strokeRect(x, y, region.sw * fit.scale, region.sh * fit.scale);
          const label = String(index + 2);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x + 2, y + 2, ctx.measureText(label).width + 6, 12);
          ctx.fillStyle = '#1a1a1a';
          ctx.fillText(label, x + 5, y + 11);
        });
      },
      `Page 1 of ${total} · overview: ${count(layout.rows, 'row')} × ${count(layout.columns, 'column')}`,
    );
  }
  for (const [index, region] of regions.entries()) {
    await render(
      () => {
        place(layout.scale, region.x, region.y, region.sx, region.sy);
        ctx.beginPath();
        ctx.rect(region.sx, region.sy, region.sw, region.sh);
        ctx.clip();
        drawing.draw(ctx);
      },
      tiled
        ? `Page ${index + 2} of ${total} · row ${region.row + 1}, column ${region.column + 1}`
        : undefined,
    );
  }
  downloadBlob(
    new Blob([buildPdf(pages, { title: tree.name })], { type: 'application/pdf' }),
    `${safeName(tree.name)}.pdf`,
  );
}
/** A tree measured for drawing: its size in tree pixels, padding included, and a painter. */
export type TreeDrawing = {
  width: number;
  height: number;
  /** Each person's card, in the same coordinates `draw` uses. */
  cards: { x: number; y: number; width: number; height: number }[];
  /** Paints the whole tree with its top-left corner at the context's origin. */
  draw(ctx: CanvasRenderingContext2D): void;
};
/** Measures `tree` with `ctx` and loads its portraits; expects a normalized, non-empty tree. */
export async function prepareTreeDrawing(
  tree: Tree,
  ctx: CanvasRenderingContext2D,
): Promise<TreeDrawing> {
  const cardW = personCardSize.width,
    cardH = personCardSize.height,
    pad = 90;
  const size = { width: cardW, height: cardH };
  const kinships = calculateKinships(tree);
  const layouts = new Map(
    tree.people.map((p) => {
      let top = 80;
      const rows: {
        text: string;
        y: number;
        font: string;
        color: 'text' | 'muted' | 'copper';
      }[] = [];
      ctx.font = '16px Georgia';
      rows.push(
        ...wrapCardText(ctx, p.name || 'Unnamed', 44, 18).map((line) => ({
          ...line,
          font: '16px Georgia',
          color: 'text' as const,
        })),
      );
      const addText = (
        text: string,
        font: string,
        color: (typeof rows)[number]['color'],
        lineHeight: number,
        gap = 0,
      ) => {
        if (!text) return;
        ctx.font = font;
        top += gap;
        rows.push({
          text: fitCanvasText(ctx, text, cardW - 24),
          y: top + lineHeight * 0.8,
          font,
          color,
        });
        top += lineHeight;
      };
      addText(p.nickname ? `"${p.nickname}"` : '', '11px system-ui', 'copper', 12);
      addText(personLifeLabel(p), '11px system-ui', 'muted', 14, 2);
      const kinship = kinships.get(p.id);
      if (kinship && p.id !== tree.homePersonId && kinship.paths.length) {
        addText(kinship.primary.label, '11px system-ui', 'copper', 14, 2);
      }
      return [p.id, { rows, height: cardH }] as const;
    }),
  );
  const sizes = new Map(
    tree.people.map((p) => [p.id, { width: cardW, height: layouts.get(p.id)!.height }]),
  );
  const families = familyConnectors(tree.people, tree.relations, size, sizes);
  const points = connectorPoints(families);
  const groupedIds = new Set(families.flatMap((family) => family.relationIds));
  const minX = Math.min(...tree.people.map((p) => p.x), ...points.map((p) => p.x)),
    minY = Math.min(...tree.people.map((p) => p.y), ...points.map((p) => p.y));
  const maxX = Math.max(...tree.people.map((p) => p.x + cardW), ...points.map((p) => p.x)),
    maxY = Math.max(
      ...tree.people.map((p) => p.y + sizes.get(p.id)!.height),
      ...points.map((p) => p.y),
    );
  const width = maxX - minX + pad * 2,
    height = maxY - minY + pad * 2;
  const portraits = new Map(
    await Promise.all(
      tree.people.flatMap((p) =>
        p.portrait ? [loadImage(p.portrait).then((img) => [p.id, img] as const)] : [],
      ),
    ),
  );
  // Keep downloaded trees legible on paper, independently of the editor theme.
  const palette = {
    background: '#ffffff',
    surface: '#ffffff',
    border: '#777777',
    avatar: '#f2f2f2',
    text: '#1a1a1a',
    muted: '#4a4a4a',
    accent: '#333333',
    copper: '#4a4a4a',
    partner: '#4a4a4a',
  };
  const people = new Map(tree.people.map((p) => [p.id, p]));
  const at = (id: string) => people.get(id)!;
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);
    if (tree.homePersonId !== null) {
      ctx.fillStyle = palette.copper;
      ctx.font = '14px system-ui';
      ctx.fillText(
        fitCanvasText(
          ctx,
          `Relationships to home: ${at(tree.homePersonId).name || 'Unnamed person'}`,
          width - pad * 2,
        ),
        pad,
        40,
      );
    }
    const px = (p: (typeof tree.people)[number]) => p.x - minX + pad,
      py = (p: (typeof tree.people)[number]) => p.y - minY + pad;
    ctx.font = '12px system-ui';
    ctx.lineWidth = 2;
    ctx.save();
    ctx.translate(pad - minX, pad - minY);
    ctx.strokeStyle = palette.copper;
    for (const family of families) {
      const paths = [
        family.stem,
        family.bar,
        ...family.additionalPaths,
        ...family.branches.map((b) => b.points),
      ];
      ctx.stroke(new Path2D(paths.map(connectorPath).join(' ')));
    }
    ctx.restore();
    for (const r of tree.relations) {
      if (groupedIds.has(r.id)) continue;
      const a = at(r.type === 'parent' ? r.parentId : r.personA),
        b = at(r.type === 'parent' ? r.childId : r.personB);
      const aSize = sizes.get(a.id)!,
        bSize = sizes.get(b.id)!;
      const handles = connectionHandles(
        r,
        { x: a.x + aSize.width / 2, y: a.y + aSize.height / 2 },
        { x: b.x + bSize.width / 2, y: b.y + bSize.height / 2 },
      );
      const anchor = (side: 'top' | 'bottom' | 'left' | 'right', height: number) =>
        side === 'top'
          ? [cardW / 2, 0]
          : side === 'bottom'
            ? [cardW / 2, height]
            : side === 'left'
              ? [0, height / 2]
              : [cardW, height / 2];
      const [ax, ay] = anchor(handles.sourceHandle, aSize.height);
      const [bx, by] = anchor(handles.targetHandle, bSize.height);
      const x1 = px(a) + ax,
        y1 = py(a) + ay,
        x2 = px(b) + bx,
        y2 = py(b) + by;
      ctx.strokeStyle =
        r.type === 'parent'
          ? palette.copper
          : r.type === 'partner'
            ? palette.partner
            : palette.muted;
      let lx = (x1 + x2) / 2,
        ly = (y1 + y2) / 2;
      if (r.type === 'partner') {
        const geometry = partnerGeometry(a, b, size, sizes);
        ctx.save();
        ctx.translate(pad - minX, pad - minY);
        ctx.stroke(new Path2D(geometry.path));
        ctx.restore();
        lx = geometry.midpoint.x - minX + pad;
        ly = geometry.midpoint.y - minY + pad;
      } else {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
        ctx.stroke();
      }
      if (r.type === 'partner') {
        const icon = relationshipIcons.partner;
        ctx.save();
        ctx.translate(lx - 12, ly - 12);
        ctx.fillStyle = palette.background;
        ctx.fillRect(-4, -4, 32, 32);
        ctx.strokeStyle = palette.partner;
        ctx.fillStyle = palette.partner;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const d of icon.paths) {
          const path = new Path2D(d);
          ctx.fill(path);
          ctx.stroke(path);
        }
        ctx.restore();
      } else if (r.type === 'unassigned') {
        const label = relationLabel(r);
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = palette.background;
        ctx.fillRect(lx - tw / 2 - 6, ly - 12, tw + 12, 19);
        ctx.fillStyle = palette.muted;
        ctx.fillText(label, lx - tw / 2, ly + 2);
      }
    }
    for (const p of tree.people) {
      const x = px(p),
        y = py(p);
      const layout = layouts.get(p.id)!;
      ctx.fillStyle = palette.surface;
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, layout.height, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = palette.avatar;
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + 24, 16, 0, Math.PI * 2);
      ctx.fill();
      const img = portraits.get(p.id);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + cardW / 2, y + 24, 16, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x + cardW / 2 - 16, y + 8, 32, 32);
        ctx.restore();
      } else {
        ctx.fillStyle = palette.accent;
        ctx.font = 'bold 18px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText((p.name[0] || '?').toUpperCase(), x + cardW / 2, y + 30);
        ctx.textAlign = 'start';
      }
      if (p.id === tree.homePersonId) {
        ctx.strokeStyle = palette.copper;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 15);
        ctx.lineTo(x + 16, y + 8);
        ctx.lineTo(x + 24, y + 15);
        ctx.lineTo(x + 24, y + 24);
        ctx.lineTo(x + 8, y + 24);
        ctx.closePath();
        ctx.stroke();
      }
      for (const row of layout.rows) {
        ctx.fillStyle = palette[row.color];
        ctx.font = row.font;
        const textWidth = ctx.measureText(row.text).width;
        const textX = x + (cardW - textWidth) / 2;
        ctx.fillText(row.text, textX, y + row.y);
      }
      if (p.sex === 'male' || p.sex === 'female') {
        const sx = x + cardW - 20,
          sy = y + 16;
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        if (p.sex === 'male') {
          ctx.moveTo(sx + 3, sy - 3);
          ctx.lineTo(sx + 8, sy - 8);
          ctx.moveTo(sx + 3, sy - 8);
          ctx.lineTo(sx + 8, sy - 8);
          ctx.lineTo(sx + 8, sy - 3);
        } else {
          ctx.moveTo(sx, sy + 4);
          ctx.lineTo(sx, sy + 11);
          ctx.moveTo(sx - 3, sy + 8);
          ctx.lineTo(sx + 3, sy + 8);
        }
        ctx.stroke();
      }
    }
  };
  const cards = tree.people.map((p) => ({
    x: p.x - minX + pad,
    y: p.y - minY + pad,
    width: cardW,
    height: layouts.get(p.id)!.height,
  }));
  return { width, height, cards, draw };
}
// Names occupy at most two lines; the final line truncates remaining text.
function wrapCardText(
  ctx: CanvasRenderingContext2D,
  text: string,
  top: number,
  lineHeight: number,
) {
  const lines: { text: string; y: number }[] = [];
  let remaining = text.trim();
  while (remaining && lines.length < 2) {
    const width = personCardSize.width - 24;
    if (lines.length === 1) {
      lines.push({
        text: fitCanvasText(ctx, remaining, width),
        y: top + lineHeight * 0.8,
      });
      break;
    }
    let end = 0;
    for (const character of remaining) {
      const next = end + character.length;
      if (ctx.measureText(remaining.slice(0, next)).width > width && end > 0) break;
      end = next;
    }
    if (end < remaining.length) {
      const space = remaining.lastIndexOf(' ', end);
      if (space > 0) end = space;
    }
    lines.push({
      text: remaining.slice(0, end).trimEnd(),
      y: top + lineHeight * 0.8,
    });
    remaining = remaining.slice(end).trimStart();
    top += lineHeight;
  }
  return lines;
}
function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0,
    high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, middle)}…`).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}…`;
}
