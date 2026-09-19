import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { radioGroupKeys, radioTabIndex } from './radioGroup';

function Group({ activate, onPick, initial }: { activate: boolean; onPick?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  const options = ['a', 'b', 'c'];
  return (
    <div role="radiogroup" aria-label="grup" onKeyDown={radioGroupKeys({ activate })}>
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          tabIndex={radioTabIndex(value === o, value !== undefined, i)}
          disabled={o === 'disabled'}
          onClick={() => {
            setValue(o);
            onPick?.(o);
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('radioTabIndex', () => {
  it('keeps exactly one option in the tab order', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i === 1, true, i))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map((i) => radioTabIndex(false, false, i))).toEqual([0, -1, -1]); // nothing chosen yet → the first
  });
});

describe('radioGroupKeys', () => {
  it('moves focus with the arrow keys, wrapping around, and selects when activate is on', () => {
    const onPick = vi.fn();
    render(<Group activate onPick={onPick} initial="a" />);
    radio('a').focus();
    fireEvent.keyDown(radio('a'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(radio('b'));
    expect(radio('b')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radio('b'), { key: 'ArrowDown' });
    fireEvent.keyDown(radio('c'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(radio('a')); // wrapped
    fireEvent.keyDown(radio('a'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(radio('c'));
    expect(onPick).toHaveBeenLastCalledWith('c');
  });

  it('with activate off (choices that save to the server) only moves focus — nothing is chosen until Enter/Space', () => {
    const onPick = vi.fn();
    render(<Group activate={false} onPick={onPick} />);
    radio('a').focus();
    fireEvent.keyDown(radio('a'), { key: 'ArrowRight' });
    fireEvent.keyDown(radio('b'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(radio('c'));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(radio('c'));
    expect(onPick).toHaveBeenCalledWith('c');
  });

  it('Home and End jump to the ends, and other keys are left alone', () => {
    render(<Group activate={false} initial="b" />);
    radio('b').focus();
    fireEvent.keyDown(radio('b'), { key: 'End' });
    expect(document.activeElement).toBe(radio('c'));
    fireEvent.keyDown(radio('c'), { key: 'Home' });
    expect(document.activeElement).toBe(radio('a'));
    const event = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    radio('a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
