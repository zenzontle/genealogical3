import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseExportScale,
  exportPdf,
  exportPng,
  exportJson,
  largePngWarning,
  maxPdfPages,
  pngCanvasLimits,
  portraitData,
  safeName,
} from './media';
import { connectorPath, familyConnectors } from './familyConnectors';
import { makePerson, makeTree, personCardSize, validateTree, type Relation } from './model';
import { relationshipIcons } from './relationshipIcons';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('portable portrait processing', () => {
  it('exports and reimports approximate birth and death years with a version 3 document', async () => {
    let output!: Blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      output = blob as Blob;
      return 'blob:dates';
    });
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
    vi.useFakeTimers();
    const person = {
      ...makePerson(),
      born: { precision: 'about' as const, year: 1920 },
      died: { precision: 'about' as const, year: 1980 },
    };
    const tree = { ...makeTree(), people: [person] };
    exportJson(tree);
    expect(validateTree(JSON.parse(await output.text()))).toEqual({ ...tree, version: 3 });
    vi.clearAllTimers();
  });
  it.each([
    [2048, 1024, 512, 256],
    [600, 1200, 256, 512],
    [80, 160, 80, 160],
    [512, 512, 512, 512],
  ])(
    'processes %s × %s once to %s × %s JPEG at quality 0.82',
    async (width, height, expectedWidth, expectedHeight) => {
      const bitmap = { width, height, close: vi.fn() };
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => bitmap),
      );
      const drawImage = vi.fn(),
        toDataURL = vi.fn(() => 'data:image/jpeg;base64,processed');
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL };
      vi.stubGlobal('document', { createElement: () => canvas });
      expect(await portraitData(new File(['photo'], 'photo.png', { type: 'image/png' }))).toBe(
        'data:image/jpeg;base64,processed',
      );
      expect(canvas.width).toBe(expectedWidth);
      expect(canvas.height).toBe(expectedHeight);
      expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, expectedWidth, expectedHeight);
      expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
      expect(bitmap.close).toHaveBeenCalledOnce();
    },
  );

  it('exports local portraits embedded in a self-contained portable JSON document', async () => {
    let output!: Blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      output = blob as Blob;
      return 'blob:export';
    });
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) });
    vi.useFakeTimers();
    const tree = {
      ...makeTree('Portable'),
      updatedAt: 100,
      dataUpdatedAt: 80,
      people: [{ ...makePerson('Alex'), portrait: 'data:image/jpeg;base64,processed' }],
    };
    exportJson(tree);
    expect(JSON.parse(await output.text())).toEqual(tree);
    expect(JSON.parse(await output.text())).not.toHaveProperty('photoFolderId');
    vi.clearAllTimers();
  });
});

describe('print-friendly PNG exports', () => {
  it.each([
    { hasHome: false, count: 1 },
    { hasHome: true, count: 1 },
    { hasHome: false, count: 2 },
    { hasHome: true, count: 2 },
  ])(
    'uses print colors and preserves canvas geometry (home=$hasHome, children=$count)',
    async ({ hasHome, count }) => {
      const a = makePerson('Alex', 0, 0),
        b = makePerson('B', 350, 0);
      const c = makePerson('C', 0, -100),
        d = makePerson('D', 400, 260);
      a.sex = 'male';
      const relations: Relation[] = [
        {
          id: 'couple',
          type: 'partner',
          personA: a.id,
          personB: b.id,
          status: 'current',
          union: 'married',
        },
        ...[c, d].slice(0, count).flatMap((child) =>
          [a, b].map((parent) => ({
            id: `${parent.id}-${child.id}`,
            type: 'parent' as const,
            parentId: parent.id,
            childId: child.id,
            kind: 'unspecified' as const,
          })),
        ),
      ];
      const tree = {
        ...makeTree(),
        people: [a, b, ...[c, d].slice(0, count)],
        relations,
        homePersonId: hasHome ? a.id : null,
      };
      const original = structuredClone(tree);
      const unrelated = makePerson('Unrelated', 200, 100);
      unrelated.lifeStatus = 'deceased';
      unrelated.born = { precision: 'year', year: 1930 };
      const unassigned: Relation = {
        id: 'unassigned',
        type: 'unassigned',
        personA: a.id,
        personB: unrelated.id,
        sourceHandle: 'left',
        targetHandle: 'top',
      };
      const ctx = {
        fillStyle: '',
        strokeStyle: '',
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        stroke: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        roundRect: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        closePath: vi.fn(),
        measureText: (text: string) => ({ width: text.length * 6 }),
        scale: vi.fn(),
        getImageData: () => ({ data: [255, 255, 255, 255] }),
      };
      // Record the active color at draw time, before subsequent operations change it.
      ctx.fillRect.mockImplementation(() => ctx.fillStyle);
      ctx.fill.mockImplementation(() => ctx.fillStyle);
      ctx.fillText.mockImplementation(() => ctx.fillStyle);
      ctx.stroke.mockImplementation(() => ctx.strokeStyle);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'])),
      };
      const anchor = {
        href: '',
        download: '',
        click: vi.fn(),
        remove: vi.fn(),
      };
      vi.useFakeTimers();
      vi.stubGlobal('document', {
        documentElement: {},
        createElement: (tag: string) => (tag === 'canvas' ? canvas : anchor),
        body: { append: vi.fn() },
      });
      const getComputedStyle = vi.fn(() => ({
        getPropertyValue: () => (hasHome ? '#ffffff' : '#123456'),
      }));
      vi.stubGlobal('getComputedStyle', getComputedStyle);
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });
      vi.stubGlobal(
        'Path2D',
        class {
          constructor(public path: string) {}
        },
      );
      await exportPng(tree);
      expect(getComputedStyle).not.toHaveBeenCalled();
      expect(ctx.fillRect.mock.results.map(({ value }) => value)).toEqual(['#ffffff', '#ffffff']);
      expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, canvas.width / 2, canvas.height / 2]);
      expect(ctx.fill.mock.results.map(({ value }) => value)).toEqual([
        '#4a4a4a',
        ...tree.people.flatMap(() => ['#ffffff', '#f2f2f2']),
      ]);
      expect(ctx.fill.mock.calls[0][0]).toEqual({ path: relationshipIcons.partner.paths[0] });
      const heartStroke = ctx.stroke.mock.calls.findIndex(
        ([path]) => path?.path === relationshipIcons.partner.paths[0],
      );
      expect(heartStroke).toBeGreaterThanOrEqual(0);
      expect(ctx.stroke.mock.results[heartStroke].value).toBe('#4a4a4a');
      expect(ctx.stroke.mock.results.slice(0, 2).map(({ value }) => value)).toEqual([
        '#4a4a4a',
        '#4a4a4a',
      ]);
      expect(ctx.stroke.mock.results.filter(({ value }) => value === '#777777')).toHaveLength(
        tree.people.length,
      );
      expect(
        ctx.stroke.mock.results.every(({ value }) =>
          ['#333333', '#4a4a4a', '#777777'].includes(value),
        ),
      ).toBe(true);
      expect(
        ctx.fillText.mock.results.every(({ value }) =>
          ['#1a1a1a', '#333333', '#4a4a4a'].includes(value),
        ),
      ).toBe(true);
      const nameRow = ctx.fillText.mock.calls.findIndex(([text]) => text === a.name);
      expect(ctx.fillText.mock.results[nameRow].value).toBe('#1a1a1a');
      const { width, height } = personCardSize;
      const [family] = familyConnectors(tree.people, tree.relations, personCardSize);
      const expected = [
        family.stem,
        family.bar,
        ...family.additionalPaths,
        ...family.branches.map((branch) => branch.points),
      ]
        .map(connectorPath)
        .join(' ');
      expect(ctx.stroke.mock.calls[0][0]).toEqual({ path: expected });
      expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
      expect(ctx.translate).toHaveBeenCalledWith(90, 190);
      expect(canvas.width).toBe(((count === 1 ? 350 : 400) + width + 180) * 2);
      expect(canvas.height).toBe(((count === 1 ? 0 : 260) + height + 100 + 180) * 2);
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(tree).toEqual(original);
      expect(ctx.arc).toHaveBeenCalledWith(90 + width - 20, 206, 4, 0, Math.PI * 2);
      ctx.fillText.mockClear();
      await exportPng({
        ...tree,
        homePersonId: a.id,
        people: [...tree.people, unrelated],
        relations: [...tree.relations, unassigned],
      });
      expect(ctx.fillText.mock.calls.map(([text]) => text)).not.toContain(
        'Relationship not established',
      );
      expect(ctx.fillText.mock.calls.map(([text]) => text)).not.toContain('Home person');
      expect(ctx.moveTo).toHaveBeenCalledWith(98, 205);
      expect(ctx.lineTo).toHaveBeenCalledWith(106, 198);
      expect(ctx.fillText.mock.calls.map(([text]) => text)).toContain('1930 — Deceased');
      const dateRow = ctx.fillText.mock.calls.findIndex(([text]) => text === '1930 — Deceased');
      expect(ctx.fillText.mock.results[dateRow].value).toBe('#4a4a4a');
      expect(ctx.fillRect.mock.results.every(({ value }) => value === '#ffffff')).toBe(true);
      expect(ctx.stroke.mock.results.every(({ value }) => value !== '#123456')).toBe(true);
      expect(ctx.fillText.mock.calls.some(([text]) => text.startsWith('Age '))).toBe(false);
      c.name =
        'Jorge Alejandro Maximiliano Sebastián Fernández Villaseñor Montemayor Valderrama Santamaría Domínguez';
      c.nickname = 'Vilo';
      c.lifeStatus = 'living';
      c.born = { precision: 'year', year: 1987 };
      ctx.fillText.mockClear();
      ctx.roundRect.mockClear();
      await exportPng(tree);
      const nameRows = ctx.fillText.mock.calls.filter(([text]) =>
        c.name.split(' ').some((word) => text.includes(word)),
      );
      expect(nameRows.map(([text]) => text).join(' ')).not.toBe(c.name);
      expect(nameRows.at(-1)![0]).toMatch(/…$/);
      expect(nameRows.every(([text]) => text.length * 6 <= width - 24)).toBe(true);
      expect(nameRows.every((args) => args.length === 3)).toBe(true);
      expect(nameRows.length).toBe(2);
      expect(
        nameRows.every(([text, x]) => Math.abs(x + text.length * 3 - (90 + width / 2)) < 1),
      ).toBe(true);
      const card = ctx.roundRect.mock.calls.find(([x, y]) => x === 90 && y === 90)!;
      expect(card[3]).toBe(height);
      expect(ctx.roundRect.mock.calls.every(([, , w, h]) => w === width && h === height)).toBe(
        true,
      );
      expect(ctx.fillText.mock.calls.map(([text]) => text)).toContain('"Vilo"');
      expect(ctx.fillText.mock.calls.map(([text]) => text)).toContain('1987');
      expect(ctx.fillText.mock.calls.some(([text]) => text.startsWith('Age '))).toBe(false);
      expect(nameRows.every(([, , y]) => y >= card[1] + 44)).toBe(true);
      expect(nameRows.every(([, , y]) => y < card[1] + card[3] - 20)).toBe(true);
      c.born = { precision: 'about', year: 1910 };
      c.died = { precision: 'about', year: 1980 };
      c.lifeStatus = 'deceased';
      ctx.fillText.mockClear();
      ctx.roundRect.mockClear();
      await exportPng(tree);
      const dateRows = ctx.fillText.mock.calls
        .map(([text]) => text)
        .filter((text) => /About|1910|1980/.test(text));
      expect(dateRows.join(' ')).toBe('About 1910 — About 1980');
      expect(dateRows.every((text) => !text.includes('…') && text.length * 6 <= width - 24)).toBe(
        true,
      );
      const expanded = ctx.roundRect.mock.calls.find(([x, y]) => x === 90 && y === 90)!;
      const lastDateRow = ctx.fillText.mock.calls.find(([text]) => text.includes('About 1980'))!;
      expect(lastDateRow[2]).toBeLessThan(expanded[1] + expanded[3] - 8);
    },
  );
});

describe('large PNG exports', () => {
  /** Two people in a row whose drawing is `width` tree pixels wide, padding included. */
  const wideTree = (width: number) => ({
    ...makeTree('Wide'),
    people: [makePerson('First', 0, 0), makePerson('Last', width - 360, 0)],
  });
  type Attempt = { width: number; height: number; released: boolean };
  type Failure = 'none' | 'null-blob' | 'context-lost' | 'no-context' | 'blank' | 'throws';
  /** Each render attempt gets a canvas; `failures[n]` decides how the nth attempt goes. */
  function stubCanvases(...failures: Failure[]) {
    const attempts: Attempt[] = [];
    let created = 0;
    const makeContext = (failure: Failure) =>
      new Proxy(
        {
          isContextLost: () => failure === 'context-lost',
          getImageData: () => {
            if (failure === 'throws') throw Error('Out of memory');
            return { data: [0, 0, 0, failure === 'blank' ? 0 : 255] };
          },
          measureText: (text: string) => ({ width: text.length * 6 }),
        } as Record<string, unknown>,
        {
          get: (target, prop: string) => (prop in target ? target[prop] : () => undefined),
          set: (target, prop: string, value) => {
            target[prop] = value;
            return true;
          },
        },
      );
    const makeCanvas = () => {
      // The first canvas only measures text; render attempts follow it.
      const index = created++ - 1;
      const failure = failures[index] ?? 'none';
      const ctx = makeContext(failure);
      const attempt: Attempt = { width: 0, height: 0, released: false };
      if (index >= 0) attempts.push(attempt);
      return {
        get width() {
          return attempt.width;
        },
        set width(value: number) {
          if (value === 0) attempt.released = true;
          else attempt.width = value;
        },
        get height() {
          return attempt.height;
        },
        set height(value: number) {
          if (value !== 0) attempt.height = value;
        },
        getContext: () => (failure === 'no-context' ? null : ctx),
        toBlob: (callback: (blob: Blob | null) => void) =>
          callback(failure === 'null-blob' ? null : new Blob(['png'])),
      };
    };
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : anchor),
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:png', revokeObjectURL: vi.fn() });
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(public path: string) {}
      },
    );
    return { attempts, anchor };
  }

  it.each([
    ['small trees get the 2× target', 1000, 800, 0, 2],
    ['the side limit caps very wide trees', 40_000, 316, 0, 16_384 / 40_000],
    ['the area limit caps squarish trees', 10_000, 10_000, 0, 0.8],
    ['smaller limits shrink the scale', 10_000, 10_000, 3, Math.sqrt(16_777_216 / 100_000_000)],
  ])('chooses the export scale: %s', (_, width, height, tier, expected) => {
    expect(chooseExportScale(width, height, pngCanvasLimits[tier])).toBeCloseTo(expected, 10);
  });

  it('never exceeds the limits it was given', () => {
    for (const limits of pngCanvasLimits)
      for (const [width, height] of [
        [100_000, 300],
        [300, 100_000],
        [50_000, 50_000],
      ]) {
        const scale = chooseExportScale(width, height, limits);
        expect(Math.max(width, height) * scale).toBeLessThanOrEqual(limits.maxSide + 1e-6);
        expect(width * height * scale * scale).toBeLessThanOrEqual(limits.maxArea * (1 + 1e-9));
      }
  });

  it('keeps a tree legible on a larger canvas, with no warning', async () => {
    const { attempts, anchor } = stubCanvases();
    // Today's 8192 px cap would draw this at 0.66; the largest canvas holds it at 1.33.
    await expect(exportPng(wideTree(12_360))).resolves.toBeUndefined();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].width).toBeGreaterThanOrEqual(16_383);
    expect(attempts[0].width).toBeLessThanOrEqual(16_384);
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it.each(['null-blob', 'context-lost', 'no-context', 'blank', 'throws'] as const)(
    'falls back to the next canvas size after a %s failure',
    async (failure) => {
      const { attempts, anchor } = stubCanvases(failure);
      // 11,000 px fits the first two sizes at or above 1×, so the fallback stays legible.
      await expect(exportPng(wideTree(11_000))).resolves.toBeUndefined();
      expect(attempts).toHaveLength(2);
      expect(attempts[0].width).toBeCloseTo(16_384, -1);
      expect(attempts[1].width).toBeCloseTo(12_288, -1);
      expect(attempts[0].released).toBe(true);
      expect(attempts[1].released).toBe(false);
      expect(anchor.click).toHaveBeenCalledOnce();
    },
  );

  it('warns when the working canvas puts the text below the legibility floor', async () => {
    const { attempts } = stubCanvases('null-blob');
    // Legible on the largest canvas, which fails; the next one only reaches 0.99×.
    await expect(exportPng(wideTree(12_360))).resolves.toBe(largePngWarning);
    expect(attempts).toHaveLength(2);
  });

  it('still exports a tree too large for any canvas to keep legible, with a warning', async () => {
    const { attempts, anchor } = stubCanvases();
    await expect(exportPng(wideTree(40_000))).resolves.toBe(largePngWarning);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].width).toBeLessThanOrEqual(16_384);
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it('accepts exactly the legibility floor without a warning', async () => {
    stubCanvases();
    await expect(exportPng(wideTree(16_384))).resolves.toBeUndefined();
  });

  it('skips sizes that give the same scale and reports when every size fails', async () => {
    const { attempts, anchor } = stubCanvases('null-blob', 'null-blob', 'null-blob', 'null-blob');
    // Very wide: the two 8192 px sizes both give the same side-limited scale.
    await expect(exportPng(wideTree(12_360))).rejects.toThrow('Could not render the PNG.');
    expect(attempts).toHaveLength(3);
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it('tries a small tree once when it fails, since every size gives the same scale', async () => {
    const { attempts } = stubCanvases('null-blob');
    await expect(exportPng(wideTree(1000))).rejects.toThrow('Could not render the PNG.');
    expect(attempts).toHaveLength(1);
  });

  it('falls all the way to the size iOS Safari supports for a large, squarish tree', async () => {
    const { attempts } = stubCanvases('null-blob', 'null-blob', 'null-blob');
    const people = [makePerson('First', 0, 0), makePerson('Last', 9000, 9000)];
    await expect(exportPng({ ...makeTree(), people })).resolves.toBe(largePngWarning);
    expect(attempts).toHaveLength(4);
    expect(attempts[3].width * attempts[3].height).toBeLessThanOrEqual(16_777_216);
  });
});

describe('PDF exports', () => {
  /** Stubs a canvas whose context records every call; JPEG pages are 4 fake bytes each. */
  function stubCanvas() {
    const calls: { method: string; args: unknown[] }[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
        return (...args: unknown[]) => calls.push({ method: prop, args });
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    });
    const toBlob = vi.fn<(callback: (blob: Blob) => void, type: string, quality?: number) => void>(
      (callback) => {
        calls.push({ method: 'toBlob', args: [] });
        callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]));
      },
    );
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob };
    const anchor = { href: '', download: '', click: vi.fn() };
    let output: Blob | undefined;
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? canvas : anchor),
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        output = blob;
        return 'blob:pdf';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(public path: string) {}
      },
    );
    const texts = () =>
      calls.filter(({ method }) => method === 'fillText').map(({ args }) => args[0]);
    const pdf = async () =>
      Array.from(new Uint8Array(await output!.arrayBuffer()), (b) => String.fromCharCode(b)).join(
        '',
      );
    return { calls, canvas, toBlob, anchor, texts, pdf, output: () => output };
  }
  const row = (count: number) =>
    Array.from({ length: count }, (_, i) => makePerson(`P${i}`, i * 220, 0));

  it('downloads a small tree as one 200 dpi Letter page without page labels', async () => {
    const stub = stubCanvas();
    await exportPdf({ ...makeTree('Curie family'), people: row(1) });
    expect([stub.canvas.width, stub.canvas.height]).toEqual([1700, 2200]);
    expect(stub.toBlob).toHaveBeenCalledOnce();
    expect(stub.toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', 0.92]);
    expect(stub.anchor.download).toBe('Curie-family.pdf');
    expect(stub.output()!.type).toBe('application/pdf');
    const text = await stub.pdf();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 1 ');
    expect(text).toContain('/MediaBox [0 0 612 792]');
    expect(stub.texts()).toContain('P0');
    expect(stub.texts().some((t) => String(t).startsWith('Page '))).toBe(false);
    // The tree is drawn at its on-screen size, centered: 1 pt per tree pixel at 200/72 px per pt.
    const k = 200 / 72;
    const width = 180 + 180,
      height = 136 + 180;
    expect(stub.calls).toContainEqual({
      method: 'setTransform',
      args: [k, 0, 0, k, (36 + (540 - width) / 2) * k, (36 + (720 - height) / 2) * k],
    });
  });

  it('tiles a wide tree after an overview page, labelling each tile', async () => {
    const stub = stubCanvas();
    const images: { source: string }[] = [];
    vi.stubGlobal(
      'Image',
      class {
        onload = () => {};
        set src(src: string) {
          images.push(Object.assign(this, { source: src }));
          queueMicrotask(() => this.onload());
        }
      },
    );
    const people = row(30);
    people[3].portrait = 'data:image/jpeg;base64,photo';
    await exportPdf({ ...makeTree('Wide'), people });
    // 6,740 tree px wide: seven landscape tiles at 0.65 pt/px, plus the overview.
    expect([stub.canvas.width, stub.canvas.height]).toEqual([2200, 1700]);
    expect(stub.toBlob).toHaveBeenCalledTimes(8);
    const labels = stub.texts().filter((t) => String(t).startsWith('Page '));
    expect(labels).toEqual([
      'Page 1 of 8 · overview: 1 row × 7 columns',
      ...Array.from({ length: 7 }, (_, i) => `Page ${i + 2} of 8 · row 1, column ${i + 1}`),
    ]);
    // Each tile clips to its region (portraits add their own circular clips).
    expect(stub.calls.filter(({ method }) => method === 'rect')).toHaveLength(7);
    expect(stub.calls.filter(({ method }) => method === 'strokeRect')).toHaveLength(7);
    // Every person is drawn on the overview and on each tile (clipped to its region).
    expect(stub.texts().filter((t) => t === 'P0')).toHaveLength(8);
    const text = await stub.pdf();
    expect(text).toContain('/Count 8 ');
    expect(text.match(/\/MediaBox \[0 0 792 612\]/g)).toHaveLength(8);
    // The portrait loads once and is drawn on every page, in place of the initial.
    expect(images.map(({ source }) => source)).toEqual(['data:image/jpeg;base64,photo']);
    const drawn = stub.calls.filter(({ method }) => method === 'drawImage');
    expect(drawn).toHaveLength(8);
    expect(drawn.every(({ args }) => args[0] === images[0])).toBe(true);
    expect(stub.texts().filter((t) => t === 'P')).toHaveLength(29 * 8);
    // Clips, dashes and transforms stay inside each page's save/restore, so none leak forward.
    let depth = 0;
    for (const { method } of stub.calls) {
      if (method === 'save') depth++;
      if (method === 'restore') depth--;
      if (['clip', 'setLineDash', 'setTransform'].includes(method))
        expect(depth).toBeGreaterThan(0);
      if (method === 'toBlob') expect(depth).toBe(0);
    }
  });

  it(`refuses trees needing more than ${maxPdfPages} pages before rendering any`, async () => {
    const stub = stubCanvas();
    await expect(exportPdf({ ...makeTree(), people: row(300) })).rejects.toThrow(
      /needs \d+ PDF pages, more than the limit of 50\. Use Arrange/,
    );
    expect(stub.toBlob).not.toHaveBeenCalled();
    expect(stub.anchor.click).not.toHaveBeenCalled();
  });

  it('requires at least one person', async () => {
    stubCanvas();
    await expect(exportPdf(makeTree())).rejects.toThrow('Add a person before exporting a PDF.');
  });
});

describe('export filenames', () => {
  it('keeps letters from any script and removes unsafe characters', () => {
    expect(safeName('Familia Peña')).toBe('Familia-Peña');
    expect(safeName('王家 族谱')).toBe('王家-族谱');
    expect(safeName('Fami\u006c\u0303ia')).toBe('Fami\u006c\u0303ia'.normalize('NFC'));
    expect(safeName('a/b:c*?"<>|')).toBe('abc');
    expect(safeName('  ///  ')).toBe('family-tree');
  });
});
