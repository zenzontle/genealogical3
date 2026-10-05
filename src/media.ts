import {
  assertValidLifeDates,
  dateYearLabel,
  normalizeHomePerson,
  personAgeLabel,
  personCardHeight,
  relationLabel,
  type Tree,
} from "./model";
import { relationshipIcons } from "./relationshipIcons";
import { calculateKinships } from "./kinship";
import {
  connectorPath,
  connectorPoints,
  familyConnectors,
  partnerGeometry,
} from "./familyConnectors";
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const safeName = (name: string) =>
  name
    .trim()
    .replace(/[^a-z0-9-_ ]/gi, "")
    .replace(/\s+/g, "-") || "family-tree";
export function exportJson(tree: Tree) {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  downloadBlob(
    new Blob([JSON.stringify({ ...normalized, version: 2 }, null, 2)], {
      type: "application/json",
    }),
    `${safeName(tree.name)}.json`,
  );
}
export async function portraitData(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size > 20_000_000)
    throw Error("Choose an image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Could not process the image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error("A portrait could not be loaded."));
    img.src = src;
  });
export async function exportPng(tree: Tree) {
  assertValidLifeDates(tree);
  tree = normalizeHomePerson(tree);
  if (!tree.people.length)
    throw Error("Add a person before exporting an image.");
  const cardW = 220,
    cardH = personCardHeight(tree.homePersonId !== null),
    pad = 90;
  const size = { width: cardW, height: cardH };
  const families = familyConnectors(tree.people, tree.relations, size);
  const points = connectorPoints(families);
  const groupedIds = new Set(families.flatMap((family) => family.relationIds));
  const minX = Math.min(
      ...tree.people.map((p) => p.x),
      ...points.map((p) => p.x),
    ),
    minY = Math.min(...tree.people.map((p) => p.y), ...points.map((p) => p.y));
  const maxX = Math.max(
      ...tree.people.map((p) => p.x + cardW),
      ...points.map((p) => p.x),
    ),
    maxY = Math.max(
      ...tree.people.map((p) => p.y + cardH),
      ...points.map((p) => p.y),
    );
  const width = maxX - minX + pad * 2,
    height = maxY - minY + pad * 2;
  const scale = Math.min(
    2,
    8192 / width,
    8192 / height,
    Math.sqrt(28_000_000 / (width * height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("PNG export is unavailable in this browser.");
  const styles = getComputedStyle(document.documentElement);
  const palette = {
    background: styles.getPropertyValue("--bg").trim(),
    surface: styles.getPropertyValue("--surface").trim(),
    border: styles.getPropertyValue("--border").trim(),
    avatar: styles.getPropertyValue("--accent-surface").trim(),
    text: styles.getPropertyValue("--text").trim(),
    muted: styles.getPropertyValue("--text-muted").trim(),
    accent: styles.getPropertyValue("--accent").trim(),
    copper: styles.getPropertyValue("--copper").trim(),
    partner: styles.getPropertyValue("--partner").trim(),
  };
  ctx.scale(scale, scale);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  const kinships = calculateKinships(tree);
  const people = new Map(tree.people.map((p) => [p.id, p]));
  const at = (id: string) => people.get(id)!;
  if (tree.homePersonId !== null) {
    ctx.fillStyle = palette.copper;
    ctx.font = "14px system-ui";
    ctx.fillText(
      fitCanvasText(
        ctx,
        `Relationships to home: ${at(tree.homePersonId).name || "Unnamed person"}`,
        width - pad * 2,
      ),
      pad,
      40,
    );
  }
  const px = (p: (typeof tree.people)[number]) => p.x - minX + pad,
    py = (p: (typeof tree.people)[number]) => p.y - minY + pad;
  ctx.font = "12px system-ui";
  ctx.lineWidth = 2;
  ctx.save();
  ctx.translate(pad - minX, pad - minY);
  ctx.strokeStyle = palette.copper;
  for (const family of families) {
    const paths = [
      family.stem,
      family.bar,
      ...family.branches.map((b) => b.points),
    ];
    ctx.stroke(new Path2D(paths.map(connectorPath).join(" ")));
  }
  ctx.restore();
  for (const r of tree.relations) {
    if (groupedIds.has(r.id)) continue;
    const a = at(r.type === "parent" ? r.parentId : r.personA),
      b = at(r.type === "parent" ? r.childId : r.personB);
    const anchor = (side: "top" | "bottom" | "left" | "right") =>
      side === "top"
        ? [cardW / 2, 0]
        : side === "bottom"
          ? [cardW / 2, cardH]
          : side === "left"
            ? [0, cardH / 2]
            : [cardW, cardH / 2];
    const [ax, ay] = anchor(
      r.type === "parent"
        ? "bottom"
        : r.type === "unassigned"
          ? r.sourceHandle
          : "right",
    );
    const [bx, by] = anchor(
      r.type === "parent"
        ? "top"
        : r.type === "unassigned"
          ? r.targetHandle
          : "left",
    );
    const x1 = px(a) + ax,
      y1 = py(a) + ay,
      x2 = px(b) + bx,
      y2 = py(b) + by;
    ctx.strokeStyle =
      r.type === "parent"
        ? palette.copper
        : r.type === "partner"
          ? palette.partner
          : palette.muted;
    let lx = (x1 + x2) / 2,
      ly = (y1 + y2) / 2;
    if (r.type === "partner") {
      const geometry = partnerGeometry(a, b, size);
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
    if (r.type === "partner") {
      const icon = relationshipIcons.partner;
      ctx.save();
      ctx.translate(lx - 12, ly - 12);
      ctx.fillStyle = palette.background;
      ctx.fillRect(-4, -4, 32, 32);
      ctx.strokeStyle = icon.color;
      ctx.fillStyle = icon.fill;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of icon.paths) {
        const path = new Path2D(d);
        if (icon.fill !== "none") ctx.fill(path);
        ctx.stroke(path);
      }
      ctx.restore();
    } else if (r.type === "unassigned") {
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
    ctx.fillStyle = palette.surface;
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.avatar;
    ctx.beginPath();
    ctx.arc(x + 42, y + 43, 26, 0, Math.PI * 2);
    ctx.fill();
    if (p.portrait) {
      const img = await loadImage(p.portrait);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 42, y + 43, 26, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x + 16, y + 17, 52, 52);
      ctx.restore();
    } else {
      ctx.fillStyle = palette.accent;
      ctx.font = "bold 20px Georgia";
      ctx.textAlign = "center";
      ctx.fillText((p.name[0] || "?").toUpperCase(), x + 42, y + 50);
      ctx.textAlign = "start";
    }
    ctx.fillStyle = palette.text;
    ctx.font = "bold 16px Georgia";
    ctx.fillText(p.name.slice(0, 18), x + 78, y + 32, 130);
    ctx.fillStyle = palette.muted;
    ctx.font = "12px system-ui";
    const life = `${dateYearLabel(p.born) || "?"}${p.died.precision === "unknown" ? "" : ` – ${dateYearLabel(p.died)}`}`;
    ctx.fillText(life, x + 78, y + 70, 130);
    if (p.nickname)
      ctx.fillText(`“${p.nickname.slice(0, 24)}”`, x + 78, y + 51, 130);
    ctx.fillStyle = palette.accent;
    ctx.font = "11px system-ui";
    ctx.fillText(personAgeLabel(p), x + 78, y + 91, 110);
    const kinship = kinships.get(p.id);
    if (kinship) {
      ctx.fillStyle = palette.copper;
      ctx.font = "11px system-ui";
      const isHome = p.id === tree.homePersonId;
      if (isHome) {
        ctx.strokeStyle = palette.copper;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 17, y + 119);
        ctx.lineTo(x + 23, y + 114);
        ctx.lineTo(x + 29, y + 119);
        ctx.lineTo(x + 29, y + 126);
        ctx.lineTo(x + 17, y + 126);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillText(
        fitCanvasText(ctx, kinship.primary.label, isHome ? 145 : 112),
        x + (isHome ? 35 : 78),
        y + 123,
      );
    }
    if (p.sex === "male" || p.sex === "female") {
      const sx = x + 201,
        sy = y + cardH - 21;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      if (p.sex === "male") {
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
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw Error("Could not render the PNG.");
  downloadBlob(blob, `${safeName(tree.name)}.png`);
}
function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0,
    high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, middle)}…`).width <= width)
      low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}…`;
}
