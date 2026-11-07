/** A page showing one JPEG image across its whole area. */
export type PdfImagePage = {
  /** Page size in points. */
  width: number;
  height: number;
  /** Baseline JPEG data with three (RGB) components, as canvas `toBlob('image/jpeg')` writes. */
  jpeg: Uint8Array;
  /** Image size in pixels. */
  pixelWidth: number;
  pixelHeight: number;
};

const encoder = new TextEncoder();

/** A PDF text string: UTF-16BE with a byte order mark, written as hex so nothing needs escaping. */
function textString(text: string) {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

const number = (value: number) => String(Math.round(value * 1000) / 1000);

/** Writes a PDF with one image per page. Object 1 is the catalog, 2 the page tree, 3 the info. */
export function buildPdf(
  pages: PdfImagePage[],
  { title }: { title: string },
): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...parts: (string | Uint8Array)[]) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    parts.forEach(write);
    write('\nendobj\n');
  };
  // The binary comment tells transfer tools the file isn't plain text.
  write('%PDF-1.4\n%');
  write(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]));
  write('\n');
  const pageId = (index: number) => 4 + index * 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`,
  );
  object(3, `<< /Title ${textString(title)} /Producer (genealogical3) >>`);
  pages.forEach((page, index) => {
    const id = pageId(index);
    const w = number(page.width),
      h = number(page.height);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im1 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    object(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      '\nendstream',
    );
  });
  const xref = length;
  const count = offsets.length;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const output = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}
