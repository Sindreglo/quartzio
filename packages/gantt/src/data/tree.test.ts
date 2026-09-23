import { describe, expect, it } from 'vitest';
import { createProjectState } from './normalize';
import { getTreeIndex } from './tree';

const state = createProjectState({
  tasks: [
    { id: 'a', children: [{ id: 'a1', children: [{ id: 'a1x' }] }, { id: 'a2' }] },
    { id: 'b' },
    // Listed out of depth-first order on purpose: sibling order is relative order in the list.
    { id: 'b2', parentId: 'b' },
    { id: 'c' },
    { id: 'b1', parentId: 'b' },
  ],
});
const tree = getTreeIndex(state.tasks);

describe('getTreeIndex', () => {
  it('lists children in sibling order', () => {
    expect(tree.children(null)).toEqual(['a', 'b', 'c']);
    expect(tree.children('b')).toEqual(['b2', 'b1']);
    expect(tree.children('a2')).toEqual([]);
  });

  it('walks ancestors and descendants', () => {
    expect(tree.ancestors('a1x')).toEqual(['a1', 'a']);
    expect(tree.descendants('a')).toEqual(['a1', 'a1x', 'a2']);
    expect(tree.depth('a1x')).toBe(2);
    expect(tree.isLeaf('a1x')).toBe(true);
    expect(tree.isLeaf('a')).toBe(false);
  });

  it('flattens the tree depth-first', () => {
    expect(tree.flatten()).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b2', 'b1', 'c']);
  });

  it('is cached per table', () => {
    expect(getTreeIndex(state.tasks)).toBe(tree);
  });
});
