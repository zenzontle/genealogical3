import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeScreen } from './HomeScreen';
import { duplicateTree, makePerson, makeTree, type Tree } from './model';

function render(
  libraryState: 'loading' | 'ready' | 'error',
  library: Tree[] = [],
  duplicatingTreeId: string | null = null,
) {
  return renderToStaticMarkup(
    <HomeScreen
      library={library}
      libraryState={libraryState}
      duplicatingTreeId={duplicatingTreeId}
      onRetryLibrary={vi.fn()}
      onDuplicateTree={vi.fn()}
      onCreateTree={vi.fn()}
      onImportTree={vi.fn()}
      onOpenTree={vi.fn()}
      onRenameTree={vi.fn()}
      onRemoveTree={vi.fn()}
    />,
  );
}

describe('homepage library hierarchy', () => {
  it('withholds the hero and empty-library invitation while initial storage is loading', () => {
    const html = render('loading');
    expect(html).toContain('Loading your family trees');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('class="hero"');
    expect(html).not.toContain('Your first story starts here');
  });

  it('offers retry when storage fails instead of presenting an empty library', () => {
    const html = render('error');
    expect(html).toContain('could not be loaded');
    expect(html).toContain('Retry');
    expect(html).not.toContain('class="hero"');
    expect(html).not.toContain('Your first story starts here');
  });

  it('keeps the marketing hero and empty-library experience once an empty library has loaded', () => {
    const html = render('ready');
    expect(html).toContain('class="hero"');
    expect(html).toContain('Your first story starts here');
    expect(html).toContain('<h2 id="library-heading">Your family trees</h2>');
  });

  it('leads with a single workspace h1 and gives each saved tree a static preview and actions', () => {
    const a = makePerson('A');
    const tree = { ...makeTree('Family history'), people: [a], homePersonId: a.id };
    const html = render('ready', [tree]);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="library-heading">Your family trees</h1>');
    expect(html).not.toContain('class="hero"');
    expect(html).toContain('class="tree-preview"');
    expect(html).toContain('aria-hidden="true" focusable="false"');
    for (const action of ['Open', 'Duplicate', 'Rename', 'Delete'])
      expect(html).toContain(`aria-label="${action} Family history"`);
    expect(html).toContain('1 person');
    expect(html).toContain('preview-person-home');
    expect(html).toContain('id="how-it-works"');
    expect(html).toContain('id="privacy"');
  });

  it('provides an empty-tree preview and disables duplicate buttons during persistence', () => {
    const tree = makeTree('Empty');
    const html = render('ready', [tree, makeTree('Other')], tree.id);
    expect(html).toContain('No people yet');
    expect(html).toMatch(/aria-label="Duplicate Empty"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Duplicate Other"[^>]*disabled/);
    expect(html).toContain('Duplicating…');
    expect(html).not.toContain('class="hero"');
  });

  it('renders local portraits with separate clipping definitions for an original and its copy', () => {
    const person = { ...makePerson('Portrait'), portrait: 'data:image/png;base64,portrait' };
    const tree = { ...makeTree('Portrait tree'), people: [person] };
    const html = render('ready', [tree, duplicateTree(tree)]);
    expect(html.match(/<image href="data:image\/png;base64,portrait"/g)).toHaveLength(2);
    const clipIds = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
    expect(clipIds).toHaveLength(4);
    expect(new Set(clipIds).size).toBe(4);
  });
});
