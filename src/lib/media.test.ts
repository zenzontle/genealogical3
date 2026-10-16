import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPng, exportJson, portraitData } from './media';
import { connectorPath, familyConnectors } from './familyConnectors';
import { makePerson, makeTree, personCardSize, type Relation } from './model';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('portable portrait processing', () => {
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

describe('shared connectors in PNG exports', () => {
  it.each([
    { hasHome: false, count: 1 },
    { hasHome: true, count: 1 },
    { hasHome: false, count: 2 },
    { hasHome: true, count: 2 },
  ])(
    'uses canvas geometry and includes connector extents (home=$hasHome, children=$count)',
    async ({ hasHome, count }) => {
      const a = makePerson('A', 0, 0),
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
      vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: () => '#123456',
      }));
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
    },
  );
});
