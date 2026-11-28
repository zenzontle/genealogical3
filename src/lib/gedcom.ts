import {
  assertValidLifeDates,
  lifeDatesError,
  makeTree,
  normalizeHomePerson,
  treeDocumentVersion,
  uid,
  validateTree,
  type DateValue,
  type ParentKind,
  type Person,
  type Relation,
  type Tree,
} from './model';
import { displayName } from './personNames';
import { arrangeTree } from './treeLayout';

/**
 * GEDCOM is the interchange format most genealogy apps read and write. Import accepts
 * 5.5, 5.5.1 and 7.0 lineage-linked files; export writes 5.5.1, which every major app
 * reads. Details the tree model has no field for are kept in each person's notes rather
 * than dropped.
 */

export type GedcomNode = {
  level: number;
  xref: string;
  tag: string;
  value: string;
  children: GedcomNode[];
};

// ---------------------------------------------------------------------------
// Decoding

// ANSEL (ANSI Z39.47) as used by GEDCOM 5.5: spacing characters, then combining marks,
// which ANSEL writes before their base letter and Unicode after it.
const anselSpacing: Record<number, number> = {
  0xa1: 0x141,
  0xa2: 0xd8,
  0xa3: 0x110,
  0xa4: 0xde,
  0xa5: 0xc6,
  0xa6: 0x152,
  0xa7: 0x2b9,
  0xa8: 0xb7,
  0xa9: 0x266d,
  0xaa: 0xae,
  0xab: 0xb1,
  0xac: 0x1a0,
  0xad: 0x1af,
  0xae: 0x2bc,
  0xb0: 0x2bb,
  0xb1: 0x142,
  0xb2: 0xf8,
  0xb3: 0x111,
  0xb4: 0xfe,
  0xb5: 0xe6,
  0xb6: 0x153,
  0xb7: 0x2ba,
  0xb8: 0x131,
  0xb9: 0xa3,
  0xba: 0xf0,
  0xbc: 0x1a1,
  0xbd: 0x1b0,
  0xc0: 0xb0,
  0xc1: 0x2113,
  0xc2: 0x2117,
  0xc3: 0xa9,
  0xc4: 0x266f,
  0xc5: 0xbf,
  0xc6: 0xa1,
  0xc7: 0xdf,
  0xc8: 0x20ac,
};
const anselCombining: Record<number, number> = {
  0xe0: 0x309,
  0xe1: 0x300,
  0xe2: 0x301,
  0xe3: 0x302,
  0xe4: 0x303,
  0xe5: 0x304,
  0xe6: 0x306,
  0xe7: 0x307,
  0xe8: 0x308,
  0xe9: 0x30c,
  0xea: 0x30a,
  0xeb: 0xfe20,
  0xec: 0xfe21,
  0xed: 0x315,
  0xee: 0x30b,
  0xef: 0x310,
  0xf0: 0x327,
  0xf1: 0x328,
  0xf2: 0x323,
  0xf3: 0x324,
  0xf4: 0x325,
  0xf5: 0x333,
  0xf6: 0x332,
  0xf7: 0x326,
  0xf8: 0x31c,
  0xf9: 0x32e,
  0xfa: 0xfe22,
  0xfb: 0xfe23,
  0xfe: 0x313,
};

export function decodeAnsel(bytes: Uint8Array): string {
  let out = '';
  let marks = '';
  for (const byte of bytes) {
    const mark = anselCombining[byte];
    if (mark) {
      marks += String.fromCharCode(mark);
      continue;
    }
    const code = byte < 0x80 ? byte : (anselSpacing[byte] ?? 0xfffd);
    out += String.fromCharCode(code) + marks;
    marks = '';
  }
  return (out + marks).normalize('NFC');
}

const decode = (encoding: string, bytes: Uint8Array, fatal = false) =>
  new TextDecoder(encoding, { fatal }).decode(bytes);

/** Whether a file's first bytes are a GEDCOM header, in any of the encodings it allows. */
export function looksLikeGedcom(bytes: Uint8Array): boolean {
  const start = decodeGedcom(bytes.subarray(0, 64));
  return /^\s*0[ \t]+HEAD\b/.test(start);
}

/** Text of a GEDCOM file, honoring its byte-order mark or declared character set. */
export function decodeGedcom(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return decode('utf-8', bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode('utf-16le', bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode('utf-16be', bytes.subarray(2));
  // "0 HEAD" in UTF-16 without a byte-order mark.
  if (bytes[0] === 0x30 && bytes[1] === 0) return decode('utf-16le', bytes);
  if (bytes[0] === 0 && bytes[1] === 0x30) return decode('utf-16be', bytes);
  const head = decode('windows-1252', bytes.subarray(0, 8192));
  const charset = /^[ \t]*1[ \t]+CHAR[ \t]+([^\s]+)/im.exec(head)?.[1]?.toUpperCase();
  if (charset === 'ANSEL') return decodeAnsel(bytes);
  if (charset === 'ANSI' || charset === 'ASCII' || charset === 'IBMPC' || charset === 'MACINTOSH')
    return decode('windows-1252', bytes);
  try {
    return decode('utf-8', bytes, true);
  } catch {
    // Many files declare UTF-8 but were saved by tools that wrote Windows-1252.
    return decode('windows-1252', bytes);
  }
}

// ---------------------------------------------------------------------------
// Parsing

const lineSyntax = /^[ \t]*(\d{1,2})(?:[ \t]+(@[^@\s]+@))?[ \t]+([A-Za-z0-9_]+)(?:[ \t](.*))?$/;
const isPointer = (value: string) => /^@[^@#\s][^@]*@$/.test(value);

/** The records of a GEDCOM file, with CONT and CONC lines folded into their values. */
export function parseGedcom(text: string): { records: GedcomNode[]; skippedLines: number } {
  const records: GedcomNode[] = [];
  const stack: GedcomNode[] = [];
  let skippedLines = 0;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    if (!raw.trim()) continue;
    const match = lineSyntax.exec(raw);
    const level = match ? Number(match[1]) : -1;
    if (!match || level > stack.length) {
      skippedLines++;
      // Lines nested under an unreadable one are skipped too, not given to its sibling.
      const guess = /^[ \t]*(\d{1,2})/.exec(raw);
      if (guess) stack.length = Math.min(stack.length, Number(guess[1]));
      continue;
    }
    const node: GedcomNode = {
      level,
      xref: match[2] ?? '',
      tag: match[3].toUpperCase(),
      value: match[4] ?? '',
      children: [],
    };
    stack.length = level;
    if (level === 0) records.push(node);
    else stack[level - 1].children.push(node);
    stack.push(node);
  }
  if (records[0]?.tag !== 'HEAD')
    throw Error('This is not a GEDCOM file. It should start with a 0 HEAD line.');
  const fold = (node: GedcomNode) => {
    let value = isPointer(node.value) ? node.value : node.value.replace(/@@/g, '@');
    const children: GedcomNode[] = [];
    for (const child of node.children) {
      const text = child.value.replace(/@@/g, '@');
      if (child.tag === 'CONT') value += `\n${text}`;
      else if (child.tag === 'CONC') value += text;
      else children.push(fold(child));
    }
    return { ...node, value, children };
  };
  return { records: records.map(fold), skippedLines };
}

const child = (node: GedcomNode | undefined, tag: string) =>
  node?.children.find((c) => c.tag === tag);
const childValue = (node: GedcomNode | undefined, tag: string) =>
  child(node, tag)?.value.trim() ?? '';
const childrenOf = (node: GedcomNode, tag: string) => node.children.filter((c) => c.tag === tag);

// ---------------------------------------------------------------------------
// Dates

const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The closest date value for a GEDCOM date, and whether it is exact. Ranges, bounds,
 * phrases and other calendars become unknown dates; the caller keeps their text.
 */
export function parseGedcomDate(raw: string): { date: DateValue; exact: boolean } {
  const unknown = { date: { precision: 'unknown' } as DateValue, exact: !raw.trim() };
  let text = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  text = text.replace(/^(@#DGREGORIAN@|GREGORIAN) /, '');
  const approximate = /^(ABT|CAL|EST)\.? /.exec(text);
  if (approximate) text = text.slice(approximate[0].length);
  const match = /^(?:(\d{1,2}) )?(?:([A-Z]{3}) )?(\d{1,4})$/.exec(text);
  if (!match) return unknown;
  const [, dayText, monthText, yearText] = match;
  const year = Number(yearText);
  const month = monthText ? months.indexOf(monthText) + 1 : 0;
  if (year < 1 || (monthText && !month) || (dayText && !month)) return unknown;
  if (approximate) return { date: { precision: 'about', year }, exact: !month };
  if (!dayText) return { date: { precision: 'year', year }, exact: !month };
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${dayText.padStart(2, '0')}`;
  const valid = new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return valid ? { date: { precision: 'full', value }, exact: true } : unknown;
}

export function formatGedcomDate(date: DateValue): string {
  if (date.precision === 'unknown') return '';
  if (date.precision === 'year') return String(date.year);
  if (date.precision === 'about') return `ABT ${date.year}`;
  const [year, month, day] = date.value.split('-').map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Import

export type GedcomImport = {
  tree: Tree;
  /** Short sentences about what could not be carried over, for the import summary. */
  warnings: string[];
};

const factLabels: Record<string, string> = {
  BIRT: 'Birth',
  CHR: 'Christening',
  BAPM: 'Baptism',
  DEAT: 'Death',
  BURI: 'Burial',
  CREM: 'Cremation',
  ADOP: 'Adoption',
  OCCU: 'Occupation',
  RESI: 'Residence',
  EDUC: 'Education',
  RELI: 'Religion',
  TITL: 'Title',
  NATI: 'Nationality',
  EMIG: 'Emigration',
  IMMI: 'Immigration',
  NATU: 'Naturalization',
  GRAD: 'Graduation',
  RETI: 'Retirement',
  CENS: 'Census',
  EVEN: 'Event',
  FACT: 'Fact',
};
const familyFactLabels: Record<string, string> = {
  ENGA: 'Engaged to',
  MARR: 'Married',
  DIV: 'Divorced from',
  ANUL: 'Annulment with',
};

/** "Occupation: Farmer, 1880, Ohio" or "" when the fact has no details. */
function factLine(label: string, node: GedcomNode, { withDate = true } = {}) {
  const value = node.value === 'Y' ? '' : node.value.trim();
  const type = childValue(node, 'TYPE');
  const details = [
    value,
    withDate ? childValue(node, 'DATE') : '',
    childValue(node, 'PLAC'),
  ].filter(Boolean);
  if (!details.length) return '';
  return `${(node.tag === 'EVEN' || node.tag === 'FACT') && type ? type : label}: ${details.join(', ')}`;
}

function personName(indi: GedcomNode) {
  const name = child(indi, 'NAME');
  const raw = name?.value.trim() ?? '';
  const nickname = childValue(name, 'NICK') || childValue(indi, 'NICK');
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');
  let firstName: string;
  let lastName: string;
  const slashed = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(raw);
  if (slashed) {
    firstName = slashed[1].trim().replace(/\s+/g, ' ');
    lastName = join(slashed[2].trim(), slashed[3].trim()).replace(/\s+/g, ' ');
  } else if (child(name, 'GIVN') || child(name, 'SURN')) {
    firstName = join(childValue(name, 'NPFX'), childValue(name, 'GIVN'));
    lastName = join(childValue(name, 'SURN'), childValue(name, 'NSFX'));
  } else {
    firstName = raw.replace(/\s+/g, ' ');
    lastName = '';
  }
  return { name: join(firstName, lastName), firstName, lastName, nickname };
}

const sexes: Record<string, Person['sex']> = { M: 'male', F: 'female', X: 'other' };
const pedigrees: Record<string, ParentKind> = {
  BIRTH: 'biological',
  NATURAL: 'biological',
  BIOLOGICAL: 'biological',
  ADOPTED: 'adoptive',
  STEP: 'step',
  FOSTER: 'guardian',
  GUARDIAN: 'guardian',
};
const parentKind = (value: string): ParentKind | undefined => pedigrees[value.trim().toUpperCase()];

export function gedcomToTree(text: string, name: string): GedcomImport {
  const { records, skippedLines } = parseGedcom(text);
  const head = records[0];
  const notesById = new Map(
    records
      .filter((r) => (r.tag === 'NOTE' || r.tag === 'SNOTE') && r.xref)
      .map((r) => [r.xref, r.value]),
  );
  const individuals = records.filter((r) => r.tag === 'INDI' && r.xref);
  const families = records.filter((r) => r.tag === 'FAM');
  if (!individuals.length) throw Error('This GEDCOM file has no people in it.');
  if (individuals.length > 2000)
    throw Error(
      `This GEDCOM file has ${individuals.length.toLocaleString('en-US')} people. A tree can hold up to 2,000.`,
    );

  const people: Person[] = [];
  const personIds = new Map<string, string>();
  const extraNotes = new Map<string, string[]>();
  const pedigreeByFamily = new Map<string, ParentKind>();
  const childXrefsByFamily = new Map<string, string[]>();
  let datesInNotes = 0;
  let sourceCitations = 0;
  let mediaLinks = 0;
  const noteText = (node: GedcomNode) =>
    (isPointer(node.value) ? notesById.get(node.value) : node.value)?.trim() ?? '';

  for (const indi of individuals) {
    if (personIds.has(indi.xref)) continue;
    const id = uid();
    personIds.set(indi.xref, id);
    const facts: string[] = [];
    const dateOf = (tag: 'BIRT' | 'DEAT') => {
      const [event, ...repeats] = childrenOf(indi, tag);
      for (const repeat of repeats) {
        const line = factLine(factLabels[tag], repeat);
        if (line) facts.push(line);
      }
      if (!event) return { date: { precision: 'unknown' } as DateValue, recorded: false };
      const raw = childValue(event, 'DATE');
      const { date, exact } = parseGedcomDate(raw);
      if (!exact) {
        facts.push(`${factLabels[tag]} date: ${raw}`);
        datesInNotes++;
      }
      const place = childValue(event, 'PLAC');
      if (place) facts.push(`${factLabels[tag]} place: ${place}`);
      return { date, recorded: true };
    };
    const born = dateOf('BIRT');
    const died = dateOf('DEAT');
    for (const node of indi.children) {
      if (node.tag === 'SOUR') sourceCitations++;
      else if (node.tag === 'OBJE') mediaLinks++;
      else if (node.tag in factLabels && node.tag !== 'BIRT' && node.tag !== 'DEAT') {
        const line = factLine(factLabels[node.tag], node);
        if (line) facts.push(line);
      }
      if (node.tag === 'FAMC' && isPointer(node.value)) {
        childXrefsByFamily.set(node.value, [
          ...(childXrefsByFamily.get(node.value) ?? []),
          indi.xref,
        ]);
        const kind =
          parentKind(childValue(node, 'PEDI')) ?? parentKind(childValue(node, '_G3_PEDI'));
        if (kind) pedigreeByFamily.set(`${node.value} ${indi.xref}`, kind);
      }
      sourceCitations += node.children.filter((c) => c.tag === 'SOUR').length;
    }
    const notes = indi.children
      .filter((c) => c.tag === 'NOTE' || c.tag === 'SNOTE')
      .map(noteText)
      .filter(Boolean);
    extraNotes.set(id, facts);
    const deceased =
      died.recorded || indi.children.some((c) => c.tag === 'BURI' || c.tag === 'CREM');
    const living = childValue(indi, '_G3_LIVING') === 'Y' && !deceased;
    const person: Person = {
      id,
      ...personName(indi),
      born: born.date,
      died: died.date,
      ...(living ? { lifeStatus: 'living' as const } : {}),
      sex: sexes[childValue(indi, 'SEX').toUpperCase()] ?? '',
      notes: notes.join('\n\n'),
      portrait: null,
      x: 0,
      y: 0,
    };
    if (lifeDatesError(person)) {
      // Keep the birth date and move the conflicting death date into the notes.
      facts.push(`Death date: ${formatGedcomDate(person.died)}`);
      datesInNotes++;
      person.died = { precision: 'unknown' };
    }
    // A death date already implies it; without one, the record still says they died.
    if (deceased && person.died.precision === 'unknown') person.lifeStatus = 'deceased';
    people.push(person);
  }

  const relations: Relation[] = [];
  const partners = new Map<string, Extract<Relation, { type: 'partner' }>>();
  const parentLinks = new Set<string>();
  const childrenByParent = new Map<string, Set<string>>();
  let cycles = 0;
  let brokenLinks = 0;
  const createsCycle = (parentId: string, childId: string) => {
    const seen = new Set<string>();
    const pending = [childId];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === parentId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(childrenByParent.get(id) ?? []));
    }
    return false;
  };
  const addParent = (parentId: string, childId: string, kind: ParentKind) => {
    const key = `${parentId} ${childId}`;
    if (parentId === childId || parentLinks.has(key)) return;
    if (createsCycle(parentId, childId)) {
      cycles++;
      return;
    }
    parentLinks.add(key);
    childrenByParent.set(parentId, (childrenByParent.get(parentId) ?? new Set()).add(childId));
    relations.push({ id: uid(), type: 'parent', parentId, childId, kind });
  };
  const nameOf = new Map(people.map((p) => [p.id, displayName(p)]));
  const statuses = ['current', 'former'] as const;
  const unions = ['married', 'unmarried'] as const;

  for (const fam of families) {
    const spouse = (tag: string) => {
      const pointer = childValue(fam, tag);
      if (!pointer || pointer === '@VOID@') return undefined;
      const id = personIds.get(pointer);
      if (!id) brokenLinks++;
      return id;
    };
    const husband = spouse('HUSB');
    const wife = spouse('WIFE');
    sourceCitations += childrenOf(fam, 'SOUR').length;
    mediaLinks += childrenOf(fam, 'OBJE').length;
    if (husband && wife && husband !== wife) {
      const key = [husband, wife].sort().join(' ');
      const married = fam.children.some((c) => c.tag === 'MARR');
      const ended = fam.children.some((c) => c.tag === 'DIV' || c.tag === 'ANUL');
      const status = statuses.find((s) => s === childValue(fam, '_G3_STATUS'));
      const union = unions.find((u) => u === childValue(fam, '_G3_UNION'));
      if (!partners.has(key)) {
        const relation: Extract<Relation, { type: 'partner' }> = {
          id: uid(),
          type: 'partner',
          personA: husband,
          personB: wife,
          status: status ?? (ended ? 'former' : 'unspecified'),
          union: union ?? (married ? 'married' : 'unspecified'),
        };
        partners.set(key, relation);
        relations.push(relation);
      }
      for (const node of fam.children) {
        const label = familyFactLabels[node.tag];
        if (!label) continue;
        for (const [self, other] of [
          [husband, wife],
          [wife, husband],
        ]) {
          // A bare MARR or DIV is already the partnership's union or status.
          const line = factLine(`${label} ${nameOf.get(other)}`, node);
          if (line) extraNotes.get(self)!.push(line);
        }
      }
    }
    // Some apps record a child only on one side, as CHIL here or FAMC on the person.
    const childLinks = new Map<string, GedcomNode | undefined>(
      childrenOf(fam, 'CHIL').map((c) => [c.value.trim(), c]),
    );
    for (const xref of childXrefsByFamily.get(fam.xref) ?? [])
      if (!childLinks.has(xref)) childLinks.set(xref, undefined);
    for (const [xref, chil] of childLinks) {
      if (xref === '@VOID@') continue;
      const childId = personIds.get(xref);
      if (!childId) {
        brokenLinks++;
        continue;
      }
      const pedigree = pedigreeByFamily.get(`${fam.xref} ${xref}`);
      if (husband)
        addParent(
          husband,
          childId,
          parentKind(childValue(chil, '_FREL')) ?? pedigree ?? 'unspecified',
        );
      if (wife)
        addParent(
          wife,
          childId,
          parentKind(childValue(chil, '_MREL')) ?? pedigree ?? 'unspecified',
        );
    }
  }
  if (relations.length > 20_000) throw Error('This GEDCOM file has too many relationships.');

  for (const person of people) {
    const facts = extraNotes.get(person.id)!;
    if (facts.length) person.notes = [person.notes, facts.join('\n')].filter(Boolean).join('\n\n');
  }
  const homeXref = childValue(head, '_G3_HOME');
  const tree: Tree = {
    ...makeTree(name.trim() || 'Imported tree'),
    people,
    relations,
    homePersonId: personIds.get(homeXref) ?? null,
  };
  const arranged = arrangeTree({ ...tree, version: treeDocumentVersion(tree) });
  const were = (count: number) => (count === 1 ? 'was' : 'were');
  const warnings = [
    datesInNotes &&
      `${plural(datesInNotes, 'date')} the editor can't represent ${were(datesInNotes)} kept in notes.`,
    sourceCitations &&
      `${plural(sourceCitations, 'source citation')} ${were(sourceCitations)} not imported.`,
    mediaLinks && `${plural(mediaLinks, 'media link')} ${were(mediaLinks)} not imported.`,
    cycles &&
      `${plural(cycles, 'parent link')} that would make someone their own ancestor ${were(cycles)} skipped.`,
    brokenLinks && `${plural(brokenLinks, 'link')} to missing people ${were(brokenLinks)} skipped.`,
    skippedLines && `${plural(skippedLines, 'unreadable line')} ${were(skippedLines)} skipped.`,
  ].filter((w): w is string => !!w);
  // The same checks as a JSON import, so a GEDCOM can never store what JSON would reject.
  return { tree: validateTree(arranged), warnings };
}

const plural = (count: number, noun: string) =>
  `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Export

// Doubling every @ can at most double a chunk, which keeps lines under 5.5.1's 255 limit.
const maxLineValue = 120;

/** Lines for a text value, split with CONT at newlines and CONC within long lines. */
function textLines(level: number, tag: string, text: string, xref = ''): string[] {
  const clean = (value: string) =>
    // GEDCOM 5.5.1 requires every @ in a value to be doubled; control characters aren't allowed.
    value.replace(/(?!\t)\p{Cc}/gu, ' ').replace(/@/g, '@@');
  const lines: string[] = [];
  text.split(/\r\n|\r|\n/).forEach((paragraph, index) => {
    const chunks: string[] = [];
    let rest = [...paragraph];
    while (rest.length > maxLineValue) {
      // Split between two non-space characters, since readers may trim a line's edges.
      let cut = maxLineValue;
      while (cut > maxLineValue / 2 && (rest[cut - 1] === ' ' || rest[cut] === ' ')) cut--;
      chunks.push(rest.slice(0, cut).join(''));
      rest = rest.slice(cut);
    }
    chunks.push(rest.join(''));
    chunks.forEach((chunk, part) => {
      const [lineLevel, lineTag] =
        index === 0 && part === 0 ? [level, tag] : [level + 1, part === 0 ? 'CONT' : 'CONC'];
      const prefix = `${lineLevel}${index === 0 && part === 0 && xref ? ` ${xref}` : ''} ${lineTag}`;
      lines.push(chunk ? `${prefix} ${clean(chunk)}` : prefix);
    });
  });
  return lines;
}

const kindPedigree: Record<ParentKind, string> = {
  biological: 'birth',
  adoptive: 'adopted',
  guardian: 'foster',
  step: '',
  unspecified: '',
};

export type GedcomExport = { text: string; warnings: string[] };

export function treeToGedcom(tree: Tree, now = new Date()): GedcomExport {
  assertValidLifeDates(tree);
  const { people, relations, homePersonId } = normalizeHomePerson(tree);
  const indiIds = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));
  const sexById = new Map(people.map((p) => [p.id, p.sex]));

  type Family = { husband?: string; wife?: string; children: string[]; partner?: Relation };
  const families: Family[] = [];
  const familyByPartners = new Map<string, Family>();
  const familyBySoloParent = new Map<string, Family>();
  const familyLinks = new Map<string, { family: Family; kind: ParentKind }[]>();
  const spouseFamilies = new Map<string, Family[]>();
  const addSpouse = (personId: string, family: Family) =>
    spouseFamilies.set(personId, [...(spouseFamilies.get(personId) ?? []), family]);
  const pairKey = (a: string, b: string) => [a, b].sort().join(' ');

  for (const relation of relations) {
    if (relation.type !== 'partner') continue;
    const key = pairKey(relation.personA, relation.personB);
    if (familyByPartners.has(key)) continue;
    // HUSB and WIFE are positional in GEDCOM 5.5.1; follow recorded sexes where they fit.
    const swap =
      sexById.get(relation.personA) === 'female' && sexById.get(relation.personB) === 'male';
    const family: Family = {
      husband: swap ? relation.personB : relation.personA,
      wife: swap ? relation.personA : relation.personB,
      children: [],
      partner: relation,
    };
    familyByPartners.set(key, family);
    families.push(family);
    addSpouse(relation.personA, family);
    addSpouse(relation.personB, family);
  }
  const parentsOf = new Map<string, Extract<Relation, { type: 'parent' }>[]>();
  for (const relation of relations)
    if (relation.type === 'parent')
      parentsOf.set(relation.childId, [...(parentsOf.get(relation.childId) ?? []), relation]);
  const link = (childId: string, family: Family, kind: ParentKind) => {
    family.children.push(childId);
    familyLinks.set(childId, [...(familyLinks.get(childId) ?? []), { family, kind }]);
  };
  for (const [childId, links] of parentsOf) {
    const remaining = [...links];
    // Parents who are partners with the same kind of link share their couple's family.
    for (let i = 0; i < remaining.length; i++)
      for (let j = i + 1; j < remaining.length; j++) {
        const family = familyByPartners.get(pairKey(remaining[i].parentId, remaining[j].parentId));
        if (!family || remaining[i].kind !== remaining[j].kind) continue;
        link(childId, family, remaining[i].kind);
        remaining.splice(j, 1);
        remaining.splice(i, 1);
        i = -1;
        break;
      }
    // Anyone else gets a one-parent family, so no partnership is implied that wasn't recorded.
    for (const { parentId, kind } of remaining) {
      const key = `${parentId} ${kind}`;
      let family = familyBySoloParent.get(key);
      if (!family) {
        family =
          sexById.get(parentId) === 'female'
            ? { wife: parentId, children: [] }
            : { husband: parentId, children: [] };
        familyBySoloParent.set(key, family);
        families.push(family);
        addSpouse(parentId, family);
      }
      link(childId, family, kind);
    }
  }
  const famIds = new Map(families.map((f, i) => [f, `@F${i + 1}@`]));

  const lines = [
    '0 HEAD',
    '1 SOUR GENEALOGICAL3',
    '2 NAME genealogical3',
    `1 DATE ${formatGedcomDate({ precision: 'full', value: now.toISOString().slice(0, 10) })}`,
    '1 SUBM @U1@',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
    ...(homePersonId ? [`1 _G3_HOME ${indiIds.get(homePersonId)}`] : []),
    '0 @U1@ SUBM',
    '1 NAME Not recorded',
  ];
  for (const person of people) {
    lines.push(`0 ${indiIds.get(person.id)} INDI`);
    // Slashes delimit the surname, so they can't appear inside a name part.
    const first = person.firstName.replace(/\//g, ' ').trim();
    const last = person.lastName.replace(/\//g, ' ').trim();
    if (first || last || person.nickname) {
      lines.push(...textLines(1, 'NAME', last ? `${first} /${last}/`.trim() : first));
      if (first) lines.push(...textLines(2, 'GIVN', first));
      if (last) lines.push(...textLines(2, 'SURN', last));
      if (person.nickname) lines.push(...textLines(2, 'NICK', person.nickname));
    }
    // X is GEDCOM 7's value for neither; 5.5.1 readers that don't know it treat it as unknown.
    const sex = { male: 'M', female: 'F', other: 'X', '': '' }[person.sex];
    if (sex) lines.push(`1 SEX ${sex}`);
    if (person.born.precision !== 'unknown')
      lines.push('1 BIRT', `2 DATE ${formatGedcomDate(person.born)}`);
    if (person.died.precision !== 'unknown')
      lines.push('1 DEAT', `2 DATE ${formatGedcomDate(person.died)}`);
    else if (person.lifeStatus === 'deceased') lines.push('1 DEAT Y');
    if (person.lifeStatus === 'living') lines.push('1 _G3_LIVING Y');
    for (const { family, kind } of familyLinks.get(person.id) ?? []) {
      lines.push(`1 FAMC ${famIds.get(family)}`);
      if (kindPedigree[kind]) lines.push(`2 PEDI ${kindPedigree[kind]}`);
      else if (kind === 'step') lines.push('2 _G3_PEDI step');
    }
    for (const family of spouseFamilies.get(person.id) ?? [])
      lines.push(`1 FAMS ${famIds.get(family)}`);
    if (person.notes.trim()) lines.push(...textLines(1, 'NOTE', person.notes));
  }
  for (const family of families) {
    lines.push(`0 ${famIds.get(family)} FAM`);
    if (family.husband) lines.push(`1 HUSB ${indiIds.get(family.husband)}`);
    if (family.wife) lines.push(`1 WIFE ${indiIds.get(family.wife)}`);
    const partner = family.partner?.type === 'partner' ? family.partner : undefined;
    if (partner?.union === 'married') lines.push('1 MARR Y');
    if (partner?.union === 'married' && partner.status === 'former') lines.push('1 DIV Y');
    // Keep what MARR and DIV can't say, so a re-import restores it.
    if (
      partner &&
      partner.status !== 'unspecified' &&
      !(partner.union === 'married' && partner.status === 'former')
    )
      lines.push(`1 _G3_STATUS ${partner.status}`);
    if (partner?.union === 'unmarried') lines.push('1 _G3_UNION unmarried');
    for (const childId of family.children) lines.push(`1 CHIL ${indiIds.get(childId)}`);
  }
  lines.push('0 TRLR');

  const photos = people.filter((p) => p.portrait).length;
  const unassigned = relations.filter((r) => r.type === 'unassigned').length;
  const warnings = [
    photos &&
      `${plural(photos, 'photo')} ${photos === 1 ? "isn't" : "aren't"} included in GEDCOM files.`,
    unassigned &&
      `${plural(unassigned, 'connection')} without a relationship type ${unassigned === 1 ? "isn't" : "aren't"} included.`,
  ].filter((w): w is string => !!w);
  return { text: `${lines.join('\n')}\n`, warnings };
}
