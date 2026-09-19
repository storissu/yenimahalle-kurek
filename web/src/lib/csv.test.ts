import { describe, expect, it } from 'vitest';
import { csvFileContent, escapeCell, toCsv } from './csv';

describe('escapeCell', () => {
  it('leaves ordinary text and Turkish letters alone', () => {
    expect(escapeCell('Çağla Şahin')).toBe('Çağla Şahin');
    expect(escapeCell('12')).toBe('12');
  });

  it('quotes cells containing the separator, quotes or line breaks', () => {
    expect(escapeCell('a;b')).toBe('"a;b"');
    expect(escapeCell('7" tekne')).toBe('"7"" tekne"');
    expect(escapeCell('iki\nsatır')).toBe('"iki\nsatır"');
  });

  it('defuses spreadsheet formulas', () => {
    expect(escapeCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(escapeCell('+90 555')).toBe("'+90 555");
    expect(escapeCell('@ali')).toBe("'@ali");
    expect(escapeCell('-cmd')).toBe("'-cmd");
  });

  it('keeps real numbers, even negative ones, as numbers', () => {
    expect(escapeCell('-3')).toBe('-3');
    expect(escapeCell('2,5')).toBe('2,5');
  });
});

describe('toCsv / csvFileContent', () => {
  const rows = [
    ['Sıra', 'Ad Soyad', 'Seans'],
    ['1', 'Ali Yılmaz', '3'],
    ['2', 'Becca; Kaya', '1'],
  ];

  it('uses ";" separators and CRLF line ends', () => {
    expect(toCsv(rows)).toBe('Sıra;Ad Soyad;Seans\r\n1;Ali Yılmaz;3\r\n2;"Becca; Kaya";1');
  });

  it('adds a UTF-8 byte-order mark and a final newline for Excel', () => {
    const content = csvFileContent(rows);
    expect(content.startsWith('﻿')).toBe(true);
    expect(content.endsWith('\r\n')).toBe(true);
  });

  it('handles an empty table', () => {
    expect(toCsv([])).toBe('');
  });
});
