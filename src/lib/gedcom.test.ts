import { describe, expect, it } from 'vitest';
import {
  decodeAnsel,
  decodeGedcom,
  formatGedcomDate,
  gedcomToTree,
  looksLikeGedcom,
  parseGedcom,
  parseGedcomDate,
  treeToGedcom,
} from './gedcom';
import {
  makePerson,
  makeTree,
  uid,
  validateTree,
  type ParentKind,
  type Person,
  type Relation,
  type Tree,
} from './model';

const gedcom = (...lines: string[]) =>
  ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n');
const byName = (tree: Tree, name: string) => tree.people.find((p) => p.name === name)!;
/** Relations as readable, order-independent tuples. */
const links = (tree: Tree) => {
  const name = (id: string) => tree.people.find((p) => p.id === id)!.name;
  return tree.relations
    .map((r) =>
      r.type === 'parent'
        ? `${name(r.parentId)} → ${name(r.childId)} (${r.kind})`
        : r.type === 'partner'
          ? `${[name(r.personA), name(r.personB)].sort().join(' + ')} (${r.status}, ${r.union})`
          : `${name(r.personA)} ? ${name(r.personB)}`,
    )
    .sort();
};

describe('parseGedcom', () => {
  it('nests lines by level and folds CONT and CONC into values', () => {
    const { records, skippedLines } = parseGedcom(
      [
        '0 HEAD',
        '0 @I1@ INDI',
        '1 NOTE First line con',
        '2 CONC tinued',
        '2 CONT Second line with @@ sign',
        '2 CONT',
        '2 CONT Fourth',
        '1 FAMS @F1@',
        '0 TRLR',
      ].join('\r\n'),
    );
    expect(skippedLines).toBe(0);
    expect(records.map((r) => r.tag)).toEqual(['HEAD', 'INDI', 'TRLR']);
    const [note, fams] = records[1].children;
    expect(note.value).toBe('First line continued\nSecond line with @ sign\n\nFourth');
    expect(note.children).toEqual([]);
    expect(fams).toMatchObject({ tag: 'FAMS', value: '@F1@' });
  });
  it('skips unreadable lines and anything nested under them', () => {
    const { records, skippedLines } = parseGedcom(
      [
        '0 HEAD',
        '0 @I1@ INDI',
        '1 NAME A',
        '1 ???',
        '2 GIVN wrong parent',
        '3 SKIPPED',
        '1 SEX F',
      ].join('\n'),
    );
    expect(skippedLines).toBe(3);
    expect(records[1].children.map((c) => [c.tag, c.children.length])).toEqual([
      ['NAME', 0],
      ['SEX', 0],
    ]);
  });
  it('accepts leading whitespace, lone carriage returns and lowercase tags', () => {
    const { records } = parseGedcom('0 HEAD\r  0 @I1@ indi\r  1 name Ann /Lee/\r');
    expect(records[1]).toMatchObject({ tag: 'INDI', xref: '@I1@' });
    expect(records[1].children[0]).toMatchObject({ tag: 'NAME', value: 'Ann /Lee/' });
  });
  it('rejects files that do not start with a header', () => {
    expect(() => parseGedcom('{"version": 2}')).toThrow('This is not a GEDCOM file.');
    expect(() => parseGedcom('0 @I1@ INDI\n0 HEAD')).toThrow('This is not a GEDCOM file.');
  });
});

describe('decodeGedcom', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  it('honors byte-order marks', () => {
    expect(decodeGedcom(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('0 HEAD é')]))).toBe('0 HEAD é');
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...'0 HEAD é'].flatMap((c) => [c.charCodeAt(0), 0]),
    ]);
    expect(decodeGedcom(utf16)).toBe('0 HEAD é');
    const bare16 = new Uint8Array([...'0 HEAD'].flatMap((c) => [c.charCodeAt(0), 0]));
    expect(decodeGedcom(bare16)).toBe('0 HEAD');
  });
  it('decodes ANSEL, moving combining marks after their base letter', () => {
    expect(decodeAnsel(new Uint8Array([0x4a, 0x6f, 0x73, 0xe2, 0x65, 0x20, 0xa1, 0xb2]))).toBe(
      'José Łø',
    );
    expect(decodeAnsel(new Uint8Array([0xe8, 0x75, 0xf0, 0x63, 0xff]))).toBe('üç�');
    const file = new Uint8Array([
      ...bytes('0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME M'),
      0xe8,
      0x75,
    ]);
    expect(decodeGedcom(file).endsWith('NAME Mü')).toBe(true);
  });
  it('recognizes a GEDCOM header in any encoding', () => {
    expect(looksLikeGedcom(bytes('0 HEAD\n1 CHAR UTF-8'))).toBe(true);
    expect(looksLikeGedcom(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('\n0 HEAD')]))).toBe(true);
    const utf16 = new Uint8Array([...'0 HEAD'].flatMap((c) => [0, c.charCodeAt(0)]));
    expect(looksLikeGedcom(utf16)).toBe(true);
    expect(looksLikeGedcom(bytes('{"version": 2}'))).toBe(false);
    expect(looksLikeGedcom(bytes('0 HEADING'))).toBe(false);
  });
  it('falls back to Windows-1252 for files that are not valid UTF-8', () => {
    const file = new Uint8Array([...bytes('0 HEAD\n1 CHAR UTF-8\n1 NOTE Ren'), 0xe9]);
    expect(decodeGedcom(file).endsWith('René')).toBe(true);
    const ansi = new Uint8Array([...bytes('0 HEAD\n1 CHAR ANSI\n1 NOTE '), 0x80]);
    expect(decodeGedcom(ansi).endsWith('€')).toBe(true);
  });
});

describe('GEDCOM dates', () => {
  it.each([
    ['12 MAR 1850', { precision: 'full', value: '1850-03-12' }, true],
    ['@#DGREGORIAN@ 1 jan 1900', { precision: 'full', value: '1900-01-01' }, true],
    ['1850', { precision: 'year', year: 1850 }, true],
    ['MAR 1850', { precision: 'year', year: 1850 }, false],
    ['ABT 1850', { precision: 'about', year: 1850 }, true],
    ['EST. 1850', { precision: 'about', year: 1850 }, true],
    ['CAL 5 JUN 1850', { precision: 'about', year: 1850 }, false],
    ['', { precision: 'unknown' }, true],
    ['BET 1850 AND 1860', { precision: 'unknown' }, false],
    ['BEF 1850', { precision: 'unknown' }, false],
    ['AFT 1850', { precision: 'unknown' }, false],
    ['31 FEB 1850', { precision: 'unknown' }, false],
    ['1700/01', { precision: 'unknown' }, false],
    ['@#DJULIAN@ 1 JAN 1700', { precision: 'unknown' }, false],
    ['(the spring after the flood)', { precision: 'unknown' }, false],
    ['0', { precision: 'unknown' }, false],
    ['12 1850', { precision: 'unknown' }, false],
  ])('reads %j', (raw, date, exact) => {
    expect(parseGedcomDate(raw)).toEqual({ date, exact });
  });
  it('writes every representable date so it reads back the same', () => {
    for (const date of [
      { precision: 'full', value: '0850-01-05' },
      { precision: 'year', year: 1850 },
      { precision: 'about', year: 7 },
    ] as const) {
      expect(parseGedcomDate(formatGedcomDate(date))).toEqual({ date, exact: true });
    }
    expect(formatGedcomDate({ precision: 'full', value: '1850-03-12' })).toBe('12 MAR 1850');
  });
});

describe('gedcomToTree', () => {
  const sample = gedcom(
    '0 @N1@ NOTE Shared note',
    '1 CONT second line',
    '0 @I1@ INDI',
    '1 NAME John /Smith/ Jr.',
    '2 NICK Jack',
    '1 SEX M',
    '1 BIRT',
    '2 DATE 12 MAR 1850',
    '2 PLAC Boston, Massachusetts',
    '1 DEAT',
    '2 DATE BET 1900 AND 1910',
    '1 OCCU Farmer',
    '2 DATE 1880',
    '1 SOUR @S1@',
    '1 OBJE @O1@',
    '1 NOTE @N1@',
    '1 FAMS @F1@',
    '0 @I2@ INDI',
    '1 NAME Mary /Jones/',
    '1 SEX F',
    '1 BIRT',
    '2 DATE ABT 1852',
    '1 BURI',
    '2 PLAC Salem',
    '1 FAMS @F1@',
    '0 @I3@ INDI',
    '1 NAME Ann /Smith/',
    '1 SEX F',
    '1 FAMC @F1@',
    '2 PEDI adopted',
    '0 @I4@ INDI',
    '1 NAME Bob /Smith/',
    '1 SEX X',
    '1 NOTE Inline note',
    '0 @I5@ INDI',
    '1 NAME Cy',
    '1 FAMC @F1@',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 WIFE @I2@',
    '1 MARR',
    '2 DATE 1 JUN 1875',
    '2 PLAC Salem',
    '1 DIV Y',
    '1 CHIL @I3@',
    '1 CHIL @I4@',
    '2 _FREL Natural',
    '2 _MREL Step',
    '1 CHIL @I99@',
    '0 @S1@ SOUR',
    '1 TITL Census',
  );

  it('maps people, families and the facts it has no field for', () => {
    const { tree, warnings } = gedcomToTree(sample, 'Smith family');
    expect(tree.name).toBe('Smith family');
    expect(tree.people.map((p) => p.name)).toEqual([
      'John Smith Jr.',
      'Mary Jones',
      'Ann Smith',
      'Bob Smith',
      'Cy',
    ]);
    const john = byName(tree, 'John Smith Jr.');
    expect(john).toMatchObject({
      firstName: 'John',
      lastName: 'Smith Jr.',
      nickname: 'Jack',
      sex: 'male',
      born: { precision: 'full', value: '1850-03-12' },
      died: { precision: 'unknown' },
      lifeStatus: 'deceased',
      portrait: null,
    });
    expect(john.notes).toBe(
      [
        'Shared note\nsecond line',
        [
          'Birth place: Boston, Massachusetts',
          'Death date: BET 1900 AND 1910',
          'Occupation: Farmer, 1880',
          'Married Mary Jones: 1 JUN 1875, Salem',
        ].join('\n'),
      ].join('\n\n'),
    );
    const mary = byName(tree, 'Mary Jones');
    expect(mary).toMatchObject({
      sex: 'female',
      born: { precision: 'about', year: 1852 },
      lifeStatus: 'deceased',
      notes: 'Burial: Salem\nMarried John Smith Jr.: 1 JUN 1875, Salem',
    });
    expect(byName(tree, 'Bob Smith')).toMatchObject({ sex: 'other', notes: 'Inline note' });
    expect(byName(tree, 'Ann Smith').lifeStatus).toBeUndefined();
    expect(links(tree)).toEqual([
      'John Smith Jr. + Mary Jones (former, married)',
      'John Smith Jr. → Ann Smith (adoptive)',
      'John Smith Jr. → Bob Smith (biological)',
      // Cy is only linked from the person's side, with FAMC.
      'John Smith Jr. → Cy (unspecified)',
      'Mary Jones → Ann Smith (adoptive)',
      'Mary Jones → Bob Smith (step)',
      'Mary Jones → Cy (unspecified)',
    ]);
    expect(warnings).toEqual([
      "1 date the editor can't represent was kept in notes.",
      '1 source citation was not imported.',
      '1 media link was not imported.',
      '1 link to missing people was skipped.',
    ]);
    expect(tree.homePersonId).toBeNull();
    expect(validateTree(tree)).toEqual(tree);
  });

  it('lays people out by generation instead of stacking them', () => {
    const { tree } = gedcomToTree(sample, 'Smith family');
    const john = byName(tree, 'John Smith Jr.');
    const ann = byName(tree, 'Ann Smith');
    expect(ann.y).toBeGreaterThan(john.y);
    expect(new Set(tree.people.map((p) => `${p.x},${p.y}`)).size).toBe(tree.people.length);
    expect(tree.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('skips parent links that would form an ancestry cycle', () => {
    const { tree, warnings } = gedcomToTree(
      gedcom(
        '0 @A@ INDI',
        '1 NAME A',
        '0 @B@ INDI',
        '1 NAME B',
        '0 @F1@ FAM',
        '1 HUSB @A@',
        '1 CHIL @B@',
        '0 @F2@ FAM',
        '1 HUSB @B@',
        '1 CHIL @A@',
        '1 CHIL @B@',
      ),
      'Loop',
    );
    expect(links(tree)).toEqual(['A → B (unspecified)']);
    expect(warnings).toEqual([
      '1 parent link that would make someone their own ancestor was skipped.',
    ]);
  });

  it('keeps a death date that precedes the birth in the notes', () => {
    const { tree, warnings } = gedcomToTree(
      gedcom('0 @A@ INDI', '1 NAME A', '1 BIRT', '2 DATE 1900', '1 DEAT', '2 DATE 1850'),
      'Dates',
    );
    expect(tree.people[0]).toMatchObject({
      born: { precision: 'year', year: 1900 },
      died: { precision: 'unknown' },
      lifeStatus: 'deceased',
      notes: 'Death date: 1850',
    });
    expect(warnings).toEqual(["1 date the editor can't represent was kept in notes."]);
  });

  it('reads names from their parts when the name has no surname slashes', () => {
    const { tree } = gedcomToTree(
      gedcom(
        '0 @A@ INDI',
        '1 NAME Dr. Jean Paul Sartre',
        '2 NPFX Dr.',
        '2 GIVN Jean Paul',
        '2 SURN Sartre',
        '0 @B@ INDI',
        '1 NAME /Unknown/',
        '0 @C@ INDI',
      ),
      'Names',
    );
    expect(tree.people.map((p) => [p.name, p.firstName, p.lastName])).toEqual([
      ['Dr. Jean Paul Sartre', 'Dr. Jean Paul', 'Sartre'],
      ['Unknown', '', 'Unknown'],
      ['', '', ''],
    ]);
  });

  it('reads GEDCOM 7 shared notes, uppercase pedigrees and void pointers', () => {
    const { tree, warnings } = gedcomToTree(
      [
        '0 HEAD',
        '1 GEDC',
        '2 VERS 7.0',
        '0 @N1@ SNOTE Shared',
        '0 @A@ INDI',
        '1 NAME A',
        '1 SNOTE @N1@',
        '0 @B@ INDI',
        '1 NAME B',
        '1 FAMC @F1@',
        '2 PEDI FOSTER',
        '0 @F1@ FAM',
        '1 HUSB @VOID@',
        '1 WIFE @A@',
        '1 CHIL @B@',
        '0 TRLR',
      ].join('\n'),
      'Seven',
    );
    expect(byName(tree, 'A').notes).toBe('Shared');
    expect(links(tree)).toEqual(['A → B (guardian)']);
    expect(warnings).toEqual([]);
  });

  it('rejects files without people or with more than a tree can hold', () => {
    expect(() => gedcomToTree(gedcom(), 'Empty')).toThrow('This GEDCOM file has no people in it.');
    const many = Array.from({ length: 2001 }, (_, i) => `0 @I${i}@ INDI`);
    expect(() => gedcomToTree(gedcom(...many), 'Many')).toThrow(
      'This GEDCOM file has 2,001 people. A tree can hold up to 2,000.',
    );
  });
});

describe('treeToGedcom', () => {
  const person = (name: string, details: Partial<Person> = {}): Person => ({
    ...makePerson(name),
    ...details,
  });
  const parent = (
    parentId: string,
    childId: string,
    kind: ParentKind = 'biological',
  ): Relation => ({
    id: uid(),
    type: 'parent',
    parentId,
    childId,
    kind,
  });
  const partner = (
    personA: string,
    personB: string,
    status: 'current' | 'former' | 'unspecified',
    union: 'married' | 'unmarried' | 'unspecified',
  ): Relation => ({ id: uid(), type: 'partner', personA, personB, status, union });

  const build = () => {
    const ada = person('Ada Lovelace', {
      sex: 'female',
      born: { precision: 'full', value: '1815-12-10' },
      died: { precision: 'full', value: '1852-11-27' },
      nickname: 'Enchantress',
      notes: `Mathematician @ heart.\nWrote the first program.\n${'long '.repeat(80).trim()}`,
      portrait: 'data:image/png;base64,AAAA',
    });
    const william = person('William King', {
      sex: 'male',
      born: { precision: 'year', year: 1805 },
    });
    const byron = person('Byron King', { sex: 'male', lifeStatus: 'deceased' });
    const annabella = person('Annabella King', { born: { precision: 'about', year: 1836 } });
    const ralph = person('Ralph King', { sex: 'other', lifeStatus: 'living' });
    const solo = person('Solo', { firstName: 'Solo', lastName: '' });
    const rhea = person('Rhea Ńowak', { sex: 'female' });
    const tom = person('Tom Ńowak');
    const tree: Tree = {
      ...makeTree('Lovelace'),
      people: [ada, william, byron, annabella, ralph, solo, rhea, tom],
      homePersonId: ada.id,
      relations: [
        partner(ada.id, william.id, 'current', 'married'),
        parent(ada.id, byron.id),
        parent(william.id, byron.id),
        // Different kinds of link to one child keep their own families.
        parent(ada.id, annabella.id, 'biological'),
        parent(william.id, annabella.id, 'step'),
        // Two parents who aren't partners mustn't become a couple.
        parent(ada.id, ralph.id, 'adoptive'),
        parent(solo.id, ralph.id, 'guardian'),
        partner(solo.id, rhea.id, 'former', 'married'),
        partner(rhea.id, tom.id, 'former', 'unmarried'),
        partner(byron.id, annabella.id, 'unspecified', 'unspecified'),
        {
          id: uid(),
          type: 'unassigned',
          personA: tom.id,
          personB: solo.id,
          sourceHandle: 'right',
          targetHandle: 'left',
        },
      ],
    };
    return validateTree(tree);
  };

  it('round-trips everything GEDCOM can hold', () => {
    const tree = build();
    const { text, warnings } = treeToGedcom(tree, new Date('2026-11-28T12:00:00Z'));
    expect(warnings).toEqual([
      "1 photo isn't included in GEDCOM files.",
      "1 connection without a relationship type isn't included.",
    ]);
    const { tree: copy, warnings: importWarnings } = gedcomToTree(text, 'Lovelace');
    expect(importWarnings).toEqual([]);
    const comparable = (t: Tree) =>
      t.people.map(({ id: _id, x: _x, y: _y, portrait: _portrait, ...rest }) => rest);
    expect(comparable(copy)).toEqual(comparable(tree));
    expect(links(copy)).toEqual(links(tree).filter((link) => !link.includes(' ? ')));
    expect(byName(copy, 'Ada Lovelace').id).toBe(copy.homePersonId);
  });

  it('writes a valid 5.5.1 header and keeps lines within limits', () => {
    const { text } = treeToGedcom(build(), new Date('2026-11-28T12:00:00Z'));
    const lines = text.trimEnd().split('\n');
    expect(lines.slice(0, 9)).toEqual([
      '0 HEAD',
      '1 SOUR GENEALOGICAL3',
      '2 NAME genealogical3',
      '1 DATE 28 NOV 2026',
      '1 SUBM @U1@',
      '1 GEDC',
      '2 VERS 5.5.1',
      '2 FORM LINEAGE-LINKED',
      '1 CHAR UTF-8',
    ]);
    expect(lines.at(-1)).toBe('0 TRLR');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(255);
      expect(line).toMatch(/^\d+( @[^@]+@)? [A-Z0-9_]+( .*)?$/);
    }
    for (const line of lines.filter((l) => / CONC /.test(l)))
      expect(line).not.toMatch(/ CONC (\s|.*\s$)/);
    expect(text).toContain('1 NOTE Mathematician @@ heart.\n2 CONT Wrote the first program.');
    expect(text).toContain(
      '1 NAME Ada /Lovelace/\n2 GIVN Ada\n2 SURN Lovelace\n2 NICK Enchantress',
    );
    expect(text).toContain('1 NAME Solo\n2 GIVN Solo\n');
  });

  it('refuses to export invalid life dates, like a JSON export', () => {
    const tree = {
      ...makeTree(),
      people: [
        person('A', {
          born: { precision: 'year', year: 1900 },
          died: { precision: 'year', year: 1800 },
        }),
      ],
    };
    expect(() => treeToGedcom(tree)).toThrow('Death cannot be before birth.');
  });
});
