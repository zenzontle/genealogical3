import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPng, exportJson, portraitData } from './media';
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
