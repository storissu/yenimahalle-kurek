/** The number to hand to a `tel:` link: digits and a leading "+" only ("0555 123 45 67" → "tel:05551234567"). */
export function telHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits ? `tel:${raw.startsWith('+') ? '+' : ''}${digits}` : null;
}
