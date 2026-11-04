/**
 * teletext.mjs  --  pure page model and layout helpers
 * No fetch, no Date.now(), no side-effects.
 * All output is printable ASCII (codes 32-126), exactly 40 columns x 24 rows.
 */

// ---------------------------------------------------------------------------
// ASCII transliteration
// ---------------------------------------------------------------------------

/** Map of Unicode code-points -> ASCII replacement strings. */
const ACCENT_MAP = {
  // Latin with diacritics (NFD base letters keep themselves; we target composed)
  0x00c0: 'A', 0x00c1: 'A', 0x00c2: 'A', 0x00c3: 'A', 0x00c4: 'A', 0x00c5: 'A',
  0x00c6: 'AE',
  0x00c7: 'C',
  0x00c8: 'E', 0x00c9: 'E', 0x00ca: 'E', 0x00cb: 'E',
  0x00cc: 'I', 0x00cd: 'I', 0x00ce: 'I', 0x00cf: 'I',
  0x00d0: 'D',
  0x00d1: 'N',
  0x00d2: 'O', 0x00d3: 'O', 0x00d4: 'O', 0x00d5: 'O', 0x00d6: 'O', 0x00d8: 'O',
  0x00d9: 'U', 0x00da: 'U', 0x00db: 'U', 0x00dc: 'U',
  0x00dd: 'Y',
  0x00de: 'TH',
  0x00df: 'ss',
  0x00e0: 'a', 0x00e1: 'a', 0x00e2: 'a', 0x00e3: 'a', 0x00e4: 'a', 0x00e5: 'a',
  0x00e6: 'ae',
  0x00e7: 'c',
  0x00e8: 'e', 0x00e9: 'e', 0x00ea: 'e', 0x00eb: 'e',
  0x00ec: 'i', 0x00ed: 'i', 0x00ee: 'i', 0x00ef: 'i',
  0x00f0: 'd',
  0x00f1: 'n',
  0x00f2: 'o', 0x00f3: 'o', 0x00f4: 'o', 0x00f5: 'o', 0x00f6: 'o', 0x00f8: 'o',
  0x00f9: 'u', 0x00fa: 'u', 0x00fb: 'u', 0x00fc: 'u',
  0x00fd: 'y', 0x00fe: 'th', 0x00ff: 'y',
  // Common additional
  0x0100: 'A', 0x0101: 'a', // Amacron
  0x0102: 'A', 0x0103: 'a',
  0x0104: 'A', 0x0105: 'a',
  0x0106: 'C', 0x0107: 'c',
  0x010c: 'C', 0x010d: 'c',
  0x010e: 'D', 0x010f: 'd',
  0x0110: 'D', 0x0111: 'd',
  0x0112: 'E', 0x0113: 'e',
  0x0118: 'E', 0x0119: 'e',
  0x011a: 'E', 0x011b: 'e',
  0x011e: 'G', 0x011f: 'g',
  0x0130: 'I', 0x0131: 'i',
  0x0141: 'L', 0x0142: 'l',
  0x0143: 'N', 0x0144: 'n',
  0x0147: 'N', 0x0148: 'n',
  0x014c: 'O', 0x014d: 'o',
  0x0150: 'O', 0x0151: 'o',
  0x0152: 'OE', 0x0153: 'oe',
  0x0158: 'R', 0x0159: 'r',
  0x015a: 'S', 0x015b: 's',
  0x015e: 'S', 0x015f: 's',
  0x0160: 'S', 0x0161: 's',
  0x0162: 'T', 0x0163: 't',
  0x0164: 'T', 0x0165: 't',
  0x016e: 'U', 0x016f: 'u',
  0x0170: 'U', 0x0171: 'u',
  0x0178: 'Y',
  0x0179: 'Z', 0x017a: 'z',
  0x017b: 'Z', 0x017c: 'z',
  0x017d: 'Z', 0x017e: 'z',
  // Punctuation / typographic
  0x2018: "'", 0x2019: "'",
  0x201c: '"', 0x201d: '"',
  0x2013: '-', 0x2014: '-',
  0x2026: '...',
  0x00b7: '.',  // middle dot
  0x00b0: ' ',  // degree sign -> space (context will add deg if needed)
  0x00d7: 'x',  // multiplication sign
  0x00f7: '/',  // division sign
  0x00b1: '+/-',
};

/**
 * Convert any string to printable ASCII (codes 32-126).
 * 1. NFD-normalize so combining marks separate from base letters.
 * 2. Replace known code-points via ACCENT_MAP.
 * 3. Drop combining diacritical marks (U+0300-U+036F).
 * 4. Drop anything still outside 32-126.
 * @param {string} s
 * @returns {string}
 */
export function toAscii(s) {
  if (typeof s !== 'string') return '';
  // NFD normalize to split composed characters
  const nfd = s.normalize('NFD');
  let out = '';
  for (let i = 0; i < nfd.length; i++) {
    const cp = nfd.codePointAt(i);
    // Skip the low surrogate of a surrogate pair
    if (cp > 0xFFFF) { i++; }
    // Combining diacritical marks -- drop
    if (cp >= 0x0300 && cp <= 0x036F) continue;
    const mapped = ACCENT_MAP[cp];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (cp >= 32 && cp <= 126) {
      out += nfd[i];
    }
    // else: drop
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

const WIDTH = 40;
const HEIGHT = 24;
const BODY_ROWS = 22; // rows 2-23 (0-indexed: 1 to 22)

/**
 * Pad or truncate string to exactly n characters using spaces.
 * @param {string} s
 * @param {number} [n=40]
 * @returns {string}
 */
export function pad(s, n = WIDTH) {
  const a = toAscii(String(s));
  if (a.length >= n) return a.slice(0, n);
  return a + ' '.repeat(n - a.length);
}

/**
 * Wrap text to lines of at most `width` characters on word boundaries.
 * A word longer than `width` is split hard. Returns array of padded strings.
 * @param {string} s
 * @param {number} [width=40]
 * @returns {string[]}
 */
export function wrap(s, width = WIDTH) {
  const text = toAscii(String(s));
  if (text.length === 0) return [pad('', width)];
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const lines = [];
  let current = '';
  for (const word of words) {
    // If the word itself is too long, hard-split it
    if (word.length > width) {
      // flush current line first
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      let w = word;
      while (w.length > width) {
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      current = w;
      continue;
    }
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  // Pad every line to exactly `width`
  return lines.map(l => pad(l, width));
}

/**
 * Format columns into one row.
 * @param {string[]} cells  - cell contents (will be toAscii'd)
 * @param {number[]} widths - column widths; must sum to <= WIDTH
 * @returns {string} padded to WIDTH
 */
export function columns(cells, widths) {
  let row = '';
  for (let i = 0; i < widths.length; i++) {
    const cell = toAscii(String(cells[i] || ''));
    const w = widths[i];
    if (cell.length >= w) {
      row += cell.slice(0, w);
    } else {
      row += cell + ' '.repeat(w - cell.length);
    }
  }
  return pad(row, WIDTH);
}

/**
 * Split an array of lines into sub-pages of `perPage` lines each.
 * @param {Array} lines
 * @param {number} [perPage=22]
 * @returns {Array[]} array of sub-page line arrays
 */
export function paginate(lines, perPage = BODY_ROWS) {
  if (lines.length === 0) return [[]];
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Header and fastext
// ---------------------------------------------------------------------------

/**
 * Build the 40-char header row (row 1).
 * Format: "P<num>/<sub> TELETORCH        HH:MM UTC"
 *   - page/sub is left-aligned
 *   - "TELETORCH" is centred in the middle block
 *   - time is right-aligned
 * @param {number} num
 * @param {number} sub    1-based current sub-page
 * @param {number} subs   total sub-page count
 * @param {string} nowUtc ISO-8601 string e.g. "2026-11-04T12:34:56.000Z"
 * @returns {string} exactly 40 chars
 */
export function header(num, sub, subs, nowUtc) {
  const pageStr = 'P' + String(num).padStart(3, '0');
  const subStr = subs > 1 ? String(sub) + '/' + String(subs) : '   ';
  const left = (pageStr + ' ' + subStr).slice(0, 9).padEnd(9, ' ');

  // Parse time from ISO string (pure string ops -- no Date constructor)
  let timeStr = '     ';
  if (typeof nowUtc === 'string' && nowUtc.length >= 16) {
    const t = nowUtc.slice(11, 16); // "HH:MM"
    timeStr = t + ' UTC';
  }
  const right = timeStr.padStart(9, ' ');

  // Middle section is 40 - 9 - 9 = 22 chars, centred "TELETORCH"
  const title = 'TELETORCH';
  const mid = title.padStart(Math.floor((22 + title.length) / 2), ' ').padEnd(22, ' ');

  return left + mid + right;
}

/** Colour names for fastext links */
export const FASTEXT_COLORS = ['red', 'green', 'yellow', 'cyan'];

/**
 * Build the 40-char fastext row (row 24).
 * Up to 4 links, each in a 10-char slot: " NNN LABEL" truncated to 10 chars.
 * @param {Array<{color: string, num: number, label: string}>} links
 * @returns {string} exactly 40 chars
 */
export function fastext(links) {
  const slots = ['', '', '', ''];
  const order = ['red', 'green', 'yellow', 'cyan'];
  for (const link of (links || [])) {
    const idx = order.indexOf(link.color);
    if (idx === -1) continue;
    const num = String(link.num).padStart(3, '0');
    const label = toAscii(String(link.label || '')).slice(0, 5);
    slots[idx] = (' ' + num + ' ' + label).padEnd(10, ' ').slice(0, 10);
  }
  // Fill unused slots with spaces
  return slots.map(s => s.padEnd(10, ' ')).join('');
}

// ---------------------------------------------------------------------------
// Page render
// ---------------------------------------------------------------------------

/**
 * Render a page object to a 24x40 grid.
 * @param {object} page
 *   - num {number}
 *   - sub {number} 1-based
 *   - subs {number}
 *   - title {string}
 *   - lines {Array<{text: string, color?: string}>}
 *   - links {Array<{color: string, num: number, label: string}>}
 * @param {string} nowUtc  ISO-8601 UTC timestamp
 * @returns {{ rows: string[], colors: string[] }}  24 elements each
 */
export function render(page, nowUtc) {
  const { num = 100, sub = 1, subs = 1, title = '', lines = [], links = [] } = page || {};

  const rows = [];
  const colors = [];

  // Row 0: header (white on black by convention)
  rows.push(header(num, sub, subs, nowUtc));
  colors.push('white');

  // Row 1: title (yellow)
  rows.push(pad(toAscii(String(title)), WIDTH));
  colors.push('yellow');

  // Rows 2-21: body lines (20 body rows; row 22 reserved for "more" indicator if needed)
  // We use up to BODY_ROWS - 2 = 20 lines from the provided lines array for interior body
  // Actually: rows 1 = header, 2 = title, 3-22 = body (20 lines), 23 = blank/more, 24 = fastext
  // Indices: 0=header,1=title,2-21=body(20),22=blank,23=fastext
  const BODY_LINES = 20;
  for (let i = 0; i < BODY_LINES; i++) {
    const line = lines[i];
    if (line) {
      rows.push(pad(toAscii(String(line.text || '')), WIDTH));
      colors.push(line.color || 'white');
    } else {
      rows.push(pad('', WIDTH));
      colors.push('white');
    }
  }

  // Row 22 (index 22): blank separator
  rows.push(pad('', WIDTH));
  colors.push('white');

  // Row 23 (index 23): fastext
  rows.push(fastext(links));
  colors.push('white');

  // Sanity: ensure exactly 24 rows of exactly 40 chars
  const result = rows.map(r => pad(String(r), WIDTH));
  return {
    rows: result,
    colors: colors,
  };
}

// ---------------------------------------------------------------------------
// Utility: blank page
// ---------------------------------------------------------------------------

/**
 * Return a plain blank page object suitable for render().
 * @param {number} num
 * @param {string} [title]
 * @returns {object}
 */
export function blankPage(num, title = '') {
  return { num, sub: 1, subs: 1, title, lines: [], links: [] };
}
