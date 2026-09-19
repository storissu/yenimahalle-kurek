/** Lower-cases with Turkish rules and drops Turkish diacritics, so "isik" finds "Işık" and "SAHIN" finds "Şahin". */
export function foldTurkish(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replaceAll('ı', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c');
}

/** True when every word of `query` appears in one of `fields` (an empty query matches everything). */
export function matchesQuery(fields: string[], query: string): boolean {
  const words = foldTurkish(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map(foldTurkish);
  return words.every((w) => haystack.some((f) => f.includes(w)));
}
