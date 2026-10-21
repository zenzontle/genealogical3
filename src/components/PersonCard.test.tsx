// @vitest-environment jsdom
import type { NodeProps } from '@xyflow/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonCard, type PersonNode } from './PersonCard';
import { makePerson } from '../lib/model';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
}));
afterEach(cleanup);

function props(count: number, active = true, selected = true): NodeProps<PersonNode> {
  return {
    selected,
    data: {
      person: makePerson('Alex'),
      selected: active,
      deleteCount: count,
      homeName: null,
      isHome: false,
      onSelect: vi.fn(),
      onDelete: vi.fn(),
    },
  } as unknown as NodeProps<PersonNode>;
}

describe('approximate years on person cards', () => {
  it('renders About for both life dates and retains the complete tooltip', () => {
    const node = props(1);
    node.data.person.born = { precision: 'about', year: 1920 };
    node.data.person.died = { precision: 'about', year: 1980 };
    render(<PersonCard {...node} />);
    const label = 'About 1920 — About 1980';
    expect(screen.getByText(label).title).toBe(label);
    expect(screen.queryByText(/Died at/)).toBeNull();
  });
});

describe('person deletion control', () => {
  it('preserves the single person label and tooltip without a badge', () => {
    const node = props(1);
    render(<PersonCard {...node} />);
    const control = screen.getByRole('button', { name: 'Delete Alex' });
    expect(control.title).toBe('Delete person');
    expect(control.querySelector('.person-delete-count')).toBeNull();
    fireEvent.click(control);
    expect(node.data.onDelete).toHaveBeenCalledWith(node.data.person.id);
    expect(node.data.onSelect).not.toHaveBeenCalled();
  });
  it('labels a group and places the count outside the card content', () => {
    render(<PersonCard {...props(123)} />);
    const control = screen.getByRole('button', { name: 'Delete 123 selected people' });
    expect(control.title).toBe('Delete 123 selected people');
    expect(control.querySelector('.person-delete-count')?.textContent).toBe('123');
    expect(control.querySelector('.person-delete-count')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.person-card .person-delete-count')).toBeNull();
  });
  it.each([
    [false, true],
    [true, false],
  ])('requires both the anchor and actual selection (%s, %s)', (active, selected) => {
    render(<PersonCard {...props(2, active, selected)} />);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });
});
