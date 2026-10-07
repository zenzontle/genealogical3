import type { Person, Relation, Tree } from './model';

type FamilyLink = Exclude<Relation, { type: 'unassigned' }>;
export type KinshipStep = {
  personId: string;
  direction: 'up' | 'down' | 'partner';
  relation: FamilyLink;
};
export type KinshipMatch = { label: string; steps: KinshipStep[] };
export type KinshipResult = {
  primary: KinshipMatch;
  alternatives: KinshipMatch[];
  paths: KinshipMatch[];
  truncated: boolean;
};
type Route = {
  previous?: Route;
  step?: KinshipStep;
  up: number;
  down: number;
  family: boolean;
  key: string;
};
const MAX_PATHS = 5;
const terms = (sex: Person['sex'], male: string, female: string, neutral: string) =>
  sex === 'male' ? male : sex === 'female' ? female : neutral;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const greatPrefix = (count: number) =>
  count === 0 ? '' : count === 1 ? 'Great-' : `${count}× great-`;
const ordinal = (n: number) => {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${suffix}`;
};
function familyLabel(up: number, down: number, sex: Person['sex']): string {
  if (down === 0) {
    const parent = terms(sex, 'father', 'mother', 'parent');
    if (up === 1) return parent;
    return `${greatPrefix(up - 2)}grand${parent}`;
  }
  if (up === 0) {
    if (down === 1) return terms(sex, 'son', 'daughter', 'child');
    return `${greatPrefix(down - 2)}${terms(sex, 'grandson', 'granddaughter', 'grandchild')}`;
  }
  if (up === 1 && down === 1) return terms(sex, 'brother', 'sister', 'sibling');
  if (down === 1) return `${greatPrefix(up - 2)}${terms(sex, 'uncle', 'aunt', 'aunt/uncle')}`;
  if (up === 1) return `${greatPrefix(down - 2)}${terms(sex, 'nephew', 'niece', 'niece/nephew')}`;
  const removed = Math.abs(up - down);
  const removal =
    removed === 0
      ? ''
      : removed === 1
        ? ' once removed'
        : removed === 2
          ? ' twice removed'
          : ` ${removed} times removed`;
  return `${ordinal(Math.min(up, down) - 1)} cousin${removal}`;
}
export function partnerKinshipLabel(
  r: Extract<Relation, { type: 'partner' }>,
  sex: Person['sex'],
): string {
  const term = r.union === 'married' ? terms(sex, 'husband', 'wife', 'spouse') : 'partner';
  return r.status === 'former' ? `${r.union === 'married' ? 'ex-' : 'former '}${term}` : term;
}
function stepLabel(step: KinshipStep, sex: Person['sex']): string {
  const r = step.relation;
  if (r.type === 'partner') return partnerKinshipLabel(r, sex);
  if (r.kind === 'guardian') return step.direction === 'up' ? 'guardian' : 'ward';
  const term =
    step.direction === 'up'
      ? terms(sex, 'father', 'mother', 'parent')
      : terms(sex, 'son', 'daughter', 'child');
  return r.kind === 'step' ? `step${term}` : term;
}
const capitalize = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);
function routeSteps(route: Route): KinshipStep[] {
  const steps: KinshipStep[] = [];
  for (let current: Route | undefined = route; current?.step; current = current.previous)
    steps.push(current.step);
  return steps.reverse();
}
function labelRoute(route: Route, person: Person, people: Map<string, Person>): string {
  if (route.family) return capitalize(familyLabel(route.up, route.down, person.sex));
  return capitalize(
    routeSteps(route)
      .map((step) => stepLabel(step, people.get(step.personId)!.sex))
      .join(' → '),
  );
}
function routePriority(route: Route): number {
  if (route.family) return 0;
  if (!route.previous?.step && route.step?.direction === 'partner') return 1;
  return 2;
}

/** Only shortest recorded paths are considered. The distance graph is acyclic,
 * even when partner links form cycles; five representatives bound branching. */
export function calculateKinships(
  tree: Pick<Tree, 'people' | 'relations' | 'homePersonId'>,
): Map<string, KinshipResult> {
  const results = new Map<string, KinshipResult>();
  const people = new Map(tree.people.map((p) => [p.id, p]));
  const homeId = tree.homePersonId;
  if (homeId === null || !people.has(homeId)) return results;
  const links = new Map<string, KinshipStep[]>(tree.people.map((p) => [p.id, []]));
  for (const relation of tree.relations) {
    if (relation.type === 'unassigned') continue;
    if (relation.type === 'parent') {
      links.get(relation.childId)?.push({ personId: relation.parentId, direction: 'up', relation });
      links
        .get(relation.parentId)
        ?.push({ personId: relation.childId, direction: 'down', relation });
    } else {
      links
        .get(relation.personA)
        ?.push({ personId: relation.personB, direction: 'partner', relation });
      links
        .get(relation.personB)
        ?.push({ personId: relation.personA, direction: 'partner', relation });
    }
  }
  const distances = new Map([[homeId, 0]]);
  const queue = [homeId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    // Stable ordering also makes route selection independent of document order.
    links
      .get(id)!
      .sort(
        (a, b) => compareText(a.relation.id, b.relation.id) || compareText(a.personId, b.personId),
      );
    for (const step of links.get(id)!) {
      if (!distances.has(step.personId)) {
        distances.set(step.personId, distances.get(id)! + 1);
        queue.push(step.personId);
      }
    }
  }
  const routes = new Map<string, Route[]>([[homeId, [{ up: 0, down: 0, family: true, key: '' }]]]);
  const omitted = new Set<string>();
  for (const id of queue.slice(1)) {
    const candidates: Route[] = [];
    // Reverse each adjacent step to find its predecessor in the shortest graph.
    for (const reverse of links.get(id)!) {
      const predecessor = reverse.personId;
      if (distances.get(predecessor) !== distances.get(id)! - 1) continue;
      if (omitted.has(predecessor)) omitted.add(id);
      const direction =
        reverse.direction === 'up' ? 'down' : reverse.direction === 'down' ? 'up' : 'partner';
      const step: KinshipStep = { ...reverse, personId: id, direction };
      for (const previous of routes.get(predecessor)!) {
        const family =
          previous.family &&
          step.relation.type === 'parent' &&
          ['biological', 'adoptive', 'unspecified'].includes(step.relation.kind) &&
          !(direction === 'up' && previous.down > 0);
        candidates.push({
          previous,
          step,
          family,
          up: previous.up + Number(direction === 'up'),
          down: previous.down + Number(direction === 'down'),
          key: `${previous.key}/${step.relation.id}:${id}`,
        });
      }
    }
    candidates.sort((a, b) => routePriority(a) - routePriority(b) || compareText(a.key, b.key));
    // Give distinct labels a representative before using slots for duplicate ties.
    const labels = new Set<string>();
    const distinct: Route[] = [],
      duplicates: Route[] = [];
    for (const route of candidates) {
      const label = labelRoute(route, people.get(id)!, people);
      if (labels.has(label)) duplicates.push(route);
      else {
        labels.add(label);
        distinct.push(route);
      }
    }
    const retained = [...distinct, ...duplicates].slice(0, MAX_PATHS);
    // Only an all-up family prefix can remain a named family route after going
    // up again. Preserve it even if many collateral ties fill the five slots.
    const ancestor = candidates.find((route) => route.family && route.down === 0);
    if (ancestor && !retained.includes(ancestor)) retained[MAX_PATHS - 1] = ancestor;
    routes.set(id, retained);
    if (candidates.length > MAX_PATHS) omitted.add(id);
  }
  for (const person of tree.people) {
    if (person.id === homeId) {
      const primary = { label: 'Home person', steps: [] };
      results.set(person.id, {
        primary,
        alternatives: [],
        paths: [],
        truncated: false,
      });
      continue;
    }
    const paths = (routes.get(person.id) || []).map((route) => ({
      label: labelRoute(route, person, people),
      steps: routeSteps(route),
    }));
    const distinct = paths.filter(
      (path, i) => paths.findIndex((other) => other.label === path.label) === i,
    );
    const primary = distinct[0] || {
      label: 'Relationship not established',
      steps: [],
    };
    results.set(person.id, {
      primary,
      alternatives: distinct.slice(1),
      paths,
      truncated: omitted.has(person.id),
    });
  }
  return results;
}

export function describeKinshipPath(home: Person, match: KinshipMatch, people: Person[]): string {
  const names = new Map(people.map((p) => [p.id, p]));
  return [
    home.name || 'Unnamed person',
    ...match.steps.map((step) => {
      const person = names.get(step.personId)!;
      const r = step.relation;
      const detail = r.type === 'parent' ? r.kind : `${r.status}, ${r.union}`;
      return `${stepLabel(step, person.sex)} (${detail}): ${person.name || 'Unnamed person'}`;
    }),
  ].join(' → ');
}
