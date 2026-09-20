import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'a', label: 'Yanıtlar' },
  { id: 'b', label: 'Program' },
];

describe('Tabs', () => {
  it('is a normal segmented control by default: quiet selected tab', () => {
    render(<Tabs label="Bölümler" idPrefix="x" tabs={tabs} value="a" onChange={vi.fn()} />);
    const selected = screen.getByRole('tab', { name: 'Yanıtlar' });
    expect(selected.className).toContain('bg-surface');
    expect(selected.className).not.toContain('bg-primary');
    expect(selected.className).toContain('min-h-11');
  });

  it('the prominent variant is taller, bolder and fills the selected tab with the primary colour', () => {
    const onChange = vi.fn();
    render(<Tabs variant="prominent" label="Bölümler" idPrefix="x" tabs={tabs} value="a" onChange={onChange} />);
    const selected = screen.getByRole('tab', { name: 'Yanıtlar' });
    const other = screen.getByRole('tab', { name: 'Program' });
    expect(selected.className).toContain('bg-primary');
    expect(selected.className).toContain('text-primary-fg');
    expect(selected.className).toContain('min-h-12');
    expect(selected.className).toContain('text-base');
    expect(other.className).not.toContain('bg-primary');
    fireEvent.click(other);
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
