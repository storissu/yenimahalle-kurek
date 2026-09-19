// CSV for spreadsheets. Turkish-locale Excel expects ";" as the separator and a UTF-8 BOM to read
// Turkish letters correctly, so both are used. Cells that a spreadsheet would treat as a formula
// (=, +, -, @) are prefixed with an apostrophe so exported names can never run code.

const NEEDS_QUOTES = /[;"\r\n]/;
const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCell(value: string): string {
  const safe = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Rows → CSV text with ";" separators and CRLF line ends (no BOM). */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(';')).join('\r\n');
}

/** Ready to save as a file: BOM + content + trailing newline. */
const BOM = String.fromCharCode(0xfeff); // UTF-8 byte-order mark, so Excel reads Turkish letters correctly
export const csvFileContent = (rows: string[][]): string => BOM + toCsv(rows) + '\r\n';

/**
 * Hands the file to the user: the share sheet where the browser can share files (phones, installed apps),
 * otherwise a normal download. Resolves to what happened; a cancelled share counts as "cancelled".
 */
export async function saveCsv(filename: string, rows: string[][]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const content = csvFileContent(rows);
  const file = new File([content], filename, { type: 'text/csv;charset=utf-8' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return 'cancelled';
      // fall through to a normal download
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
