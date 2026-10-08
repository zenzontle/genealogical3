import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TreePreview } from './TreePreview';
import { makePerson, makeTree, type Tree } from './model';
import { treePreview } from './treePreviewLayout';

function fixture(count: number): Tree {
  return {
    ...makeTree(),
    people: Array.from({ length: count }, (_, i) => ({
      ...makePerson(`Person ${i}`, i * 200, 0),
      portrait: 'data:image/png;base64,portrait',
    })),
  };
}

function partners(tree: Tree, count: number): Tree {
  const relations: Tree['relations'] = [];
  for (let i = 0; i < tree.people.length; i++) {
    for (let j = i + 1; j < tree.people.length; j++) {
      relations.push({
        id: `${i}:${j}`,
        type: 'partner',
        personA: tree.people[i].id,
        personB: tree.people[j].id,
        status: 'unspecified',
        union: 'unspecified',
      });
      if (relations.length === count) return { ...tree, relations };
    }
  }
  return { ...tree, relations };
}

describe('bounded library previews', () => {
  it('retains detailed previews up to 24 people and 32 relationships', () => {
    const tree = partners(fixture(24), 32);
    expect(treePreview(tree)).not.toBeNull();
    const html = renderToStaticMarkup(<TreePreview tree={tree} />);
    expect(html.match(/class="preview-person"/g)).toHaveLength(24);
    expect(html.match(/class="preview-link preview-link-partner"/g)).toHaveLength(32);
    expect(html.match(/<image /g)).toHaveLength(24);
  });

  it('uses constant-size summaries for larger trees without rendering people, paths or portraits', () => {
    const summarySizes: number[] = [];
    for (const count of [25, 2000]) {
      const tree = fixture(count);
      const original = structuredClone(tree);
      expect(treePreview(tree)).toBeNull();
      const html = renderToStaticMarkup(<TreePreview tree={tree} />);
      expect(html).toContain(`${count} people · 0 connections`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain('preview-person');
      expect(html).not.toContain('preview-link');
      expect(html).not.toContain('<image');
      summarySizes.push((html.match(/<[a-z][^>]*>/g) || []).length);
      expect(tree).toEqual(original);
    }
    expect(summarySizes[0]).toBe(summarySizes[1]);
    expect(summarySizes[1]).toBeLessThan(10);
  });

  it('also summarizes dense relationships even when there are few people', () => {
    const tree = partners(fixture(9), 33);
    expect(treePreview(tree)).toBeNull();
    const html = renderToStaticMarkup(<TreePreview tree={tree} />);
    expect(html).toContain('9 people · 33 connections');
    expect(html).not.toContain('preview-link');
    expect(html).not.toContain('<image');
  });
});
