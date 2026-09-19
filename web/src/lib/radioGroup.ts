import type { KeyboardEvent } from 'react';

/**
 * Keyboard support for groups built from `<button role="radio">` (the WAI-ARIA radio-group pattern):
 * arrow keys move between the options (wrapping), Home/End jump to the first/last one.
 *
 * `activate: true` also selects the option that receives focus (right for choices that only change local
 * state, e.g. Geldi/Gelmedi or the deadline presets). `activate: false` only moves focus and leaves Space/Enter
 * to commit — right when choosing saves to the server (the RSVP), so arrowing through never writes anything.
 */
export function radioGroupKeys({ activate }: { activate: boolean }) {
  return (event: KeyboardEvent<HTMLElement>): void => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key as 'ArrowRight'];
    const isEdge = event.key === 'Home' || event.key === 'End';
    if (step === undefined && !isEdge) return;

    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter((radio) => !radio.disabled);
    if (radios.length === 0) return;
    const current = radios.findIndex((radio) => radio === document.activeElement || radio.contains(document.activeElement));
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (Math.max(current, 0) + (step ?? 0) + radios.length) % radios.length;

    event.preventDefault();
    const target = radios[next];
    if (!target) return;
    target.focus();
    if (activate) target.click();
  };
}

/** Roving tab stop: only the checked option (or the first one when nothing is checked yet) is reachable with Tab. */
export const radioTabIndex = (checked: boolean, anyChecked: boolean, index: number): 0 | -1 => (checked || (!anyChecked && index === 0) ? 0 : -1);
