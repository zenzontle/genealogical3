import {
  assertValidLifeDates,
  dateYearLabel,
  personAgeLabel,
  relationLabel,
  type Tree,
} from "./model";
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
  downloadBlob(
    new Blob([JSON.stringify({ ...tree, version: 2 }, null, 2)], {
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
  if (!tree.people.length)
    throw Error("Add a person before exporting an image.");
  const cardW = 220,
    cardH = 108,
    pad = 90;
  const minX = Math.min(...tree.people.map((p) => p.x)),
    minY = Math.min(...tree.people.map((p) => p.y));
  const maxX = Math.max(...tree.people.map((p) => p.x + cardW)),
    maxY = Math.max(...tree.people.map((p) => p.y + cardH));
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
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f7f5ef";
  ctx.fillRect(0, 0, width, height);
  const at = (id: string) => tree.people.find((p) => p.id === id)!;
  const px = (p: (typeof tree.people)[number]) => p.x - minX + pad,
    py = (p: (typeof tree.people)[number]) => p.y - minY + pad;
  ctx.font = "12px system-ui";
  ctx.lineWidth = 2;
  for (const r of tree.relations) {
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
        ? "#958469"
        : r.type === "partner"
          ? "#ad796e"
          : "#92968b";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
    ctx.stroke();
    const label = relationLabel(r);
    const lx = (x1 + x2) / 2,
      ly = (y1 + y2) / 2;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "#f7f5ef";
    ctx.fillRect(lx - tw / 2 - 6, ly - 12, tw + 12, 19);
    ctx.fillStyle = "#625849";
    ctx.fillText(label, lx - tw / 2, ly + 2);
  }
  for (const p of tree.people) {
    const x = px(p),
      y = py(p);
    ctx.fillStyle = "#fffdfa";
    ctx.strokeStyle = "#dcd5ca";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8e2d7";
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
      ctx.fillStyle = "#7b6d58";
      ctx.font = "bold 20px Georgia";
      ctx.textAlign = "center";
      ctx.fillText((p.name[0] || "?").toUpperCase(), x + 42, y + 50);
      ctx.textAlign = "start";
    }
    ctx.fillStyle = "#27251f";
    ctx.font = "bold 16px Georgia";
    ctx.fillText(p.name.slice(0, 18), x + 78, y + 32, 130);
    ctx.fillStyle = "#6c665e";
    ctx.font = "12px system-ui";
    const life = `${dateYearLabel(p.born) || "?"}${p.died.precision === "unknown" ? "" : ` – ${dateYearLabel(p.died)}`}`;
    ctx.fillText(life, x + 78, y + 70, 130);
    if (p.nickname)
      ctx.fillText(`“${p.nickname.slice(0, 24)}”`, x + 78, y + 51, 130);
    ctx.fillStyle = "#65755e";
    ctx.font = "11px system-ui";
    ctx.fillText(personAgeLabel(p), x + 78, y + 91, 110);
    if (p.sex === "male" || p.sex === "female") {
      const sx = x + 201,
        sy = y + 87;
      ctx.strokeStyle = "#65755e";
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
