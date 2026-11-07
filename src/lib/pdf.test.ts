import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf';

/** One character per byte, so string offsets equal byte offsets. */
const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

function parseXref(text: string) {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.startsWith('xref\n', start)).toBe(true);
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(start))!;
  expect(first).toBe('0');
  const table = text.slice(start + `xref\n0 ${count}\n`.length);
  const entries = Array.from({ length: Number(count) }, (_, id) =>
    table.slice(id * 20, id * 20 + 20),
  );
  return { start, count: Number(count), entries };
}

describe('PDF writer', () => {
  // Bytes that look like PDF syntax must not confuse the structure.
  const jpeg = (fill: number) =>
    new Uint8Array([0xff, 0xd8, fill, ...new TextEncoder().encode(' endobj xref '), 0xff, 0xd9]);
  const pages = [
    { width: 612, height: 792, jpeg: jpeg(1), pixelWidth: 1700, pixelHeight: 2200 },
    { width: 792, height: 612, jpeg: jpeg(2), pixelWidth: 2200, pixelHeight: 1700 },
  ];

  it('writes an xref table whose offsets point at each object', () => {
    const bytes = buildPdf(pages, { title: 'Curie family' });
    const text = latin1(bytes);
    expect(text.startsWith('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')).toBe(true);
    const { count, entries } = parseXref(text);
    expect(count).toBe(4 + pages.length * 3);
    expect(entries[0]).toBe('0000000000 65535 f \n');
    entries.slice(1).forEach((entry, index) => {
      expect(entry).toMatch(/^\d{10} 00000 n \n$/);
      expect(text.startsWith(`${index + 1} 0 obj\n`, Number(entry.slice(0, 10)))).toBe(true);
    });
    expect(text).toContain(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>`);
  });

  it('places one full-page JPEG on each page in order', () => {
    const text = latin1(buildPdf(pages, { title: 'Curie family' }));
    expect(text).toContain('<< /Type /Pages /Count 2 /Kids [4 0 R 7 0 R] >>');
    expect(text).toContain('4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ');
    expect(text).toContain('7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] ');
    expect(text).toContain('/Resources << /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>');
    const content = 'q 612 0 0 792 0 0 cm /Im1 Do Q';
    expect(text).toContain(
      `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    expect(text).toContain(
      `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1700 /Height 2200 /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${pages[0].jpeg.length} >>\nstream\n` +
        `${latin1(pages[0].jpeg)}\nendstream`,
    );
    expect(text).toContain('/Width 2200 /Height 1700');
    expect(text.indexOf(latin1(pages[0].jpeg))).toBeLessThan(text.indexOf(latin1(pages[1].jpeg)));
  });

  it('stores any title as UTF-16 hex', () => {
    const text = latin1(buildPdf(pages.slice(0, 1), { title: 'Peña (王) \\' }));
    expect(text).toContain('/Title <FEFF0050006500F1006100200028738B00290020005C>');
  });
});
