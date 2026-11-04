/**
 * test/teletext.test.mjs
 * Unit tests + property-based tests for src/teletext.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  toAscii,
  pad,
  wrap,
  columns,
  paginate,
  header,
  fastext,
  render,
} from '../src/teletext.mjs';

// ---------------------------------------------------------------------------
// toAscii
// ---------------------------------------------------------------------------
describe('toAscii', () => {
  it('passes printable ASCII unchanged', () => {
    const s = 'Hello, World! 0-9 ~|{}[]';
    assert.equal(toAscii(s), s);
  });

  it('transliterates common accents', () => {
    assert.equal(toAscii('caf\u00e9'), 'cafe');      // é -> e
    assert.equal(toAscii('M\u00e9xico'), 'Mexico');  // é -> e
    assert.equal(toAscii('\u00df'), 'ss');            // ß -> ss
    assert.equal(toAscii('\u00f8'), 'o');             // ø -> o
    assert.equal(toAscii('\u0142'), 'l');             // ł -> l
    assert.equal(toAscii('\u00e6'), 'ae');            // æ -> ae
    assert.equal(toAscii('\u00d6'), 'O');             // Ö -> O
  });

  it('drops middle dot (U+00B7)', () => {
    assert.equal(toAscii('mid\u00b7dle'), 'mid.dle');
  });

  it('drops other non-ASCII characters', () => {
    assert.equal(toAscii('\u4e2d\u6587'), '');
    assert.equal(toAscii('\u0416'), '');              // Cyrillic
  });

  it('handles empty string', () => {
    assert.equal(toAscii(''), '');
  });

  it('handles non-string input gracefully', () => {
    assert.equal(toAscii(null), '');
    assert.equal(toAscii(undefined), '');
  });

  // Property: output is always printable ASCII
  it('property: any string -> printable ASCII only', () => {
    fc.assert(fc.property(fc.string(), s => {
      const result = toAscii(s);
      return [...result].every(c => {
        const cp = c.charCodeAt(0);
        return cp >= 32 && cp <= 126;
      });
    }));
  });
});

// ---------------------------------------------------------------------------
// pad
// ---------------------------------------------------------------------------
describe('pad', () => {
  it('pads short string to n chars', () => {
    assert.equal(pad('Hi', 10).length, 10);
    assert.equal(pad('Hi', 10), 'Hi        ');
  });

  it('truncates long string to n chars', () => {
    assert.equal(pad('A'.repeat(50), 40).length, 40);
  });

  it('defaults to 40 chars', () => {
    assert.equal(pad('Hello').length, 40);
  });

  it('pads to exactly 40 by default', () => {
    assert.equal(pad('').length, 40);
  });

  // Property: always returns exactly n characters
  it('property: always returns exactly n printable ASCII chars', () => {
    fc.assert(fc.property(
      fc.string(),
      fc.integer({ min: 1, max: 80 }),
      (s, n) => {
        const result = pad(s, n);
        return result.length === n &&
          [...result].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// wrap
// ---------------------------------------------------------------------------
describe('wrap', () => {
  it('returns padded lines of exactly width chars', () => {
    const lines = wrap('Hello world this is a test of wrapping', 10);
    for (const line of lines) {
      assert.equal(line.length, 10, `line "${line}" should be 10 chars`);
    }
  });

  it('does not cut words that fit within width', () => {
    const lines = wrap('short words', 40);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].trimEnd(), 'short words');
  });

  it('wraps to new line when needed', () => {
    const lines = wrap('one two three four five', 9);
    // Ensure no line exceeds 9 chars
    for (const line of lines) {
      assert.equal(line.length, 9);
    }
  });

  it('hard-splits a word longer than width', () => {
    const long = 'A'.repeat(90);
    const lines = wrap(long, 40);
    for (const line of lines) {
      assert.equal(line.length, 40);
    }
    // Reconstructed: joined trimmed lines should contain the original word
    const joined = lines.map(l => l.trimEnd()).join('');
    assert.equal(joined.length, 90);
  });

  it('handles empty string', () => {
    const lines = wrap('', 40);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].length, 40);
  });

  // Property: every line is exactly `width` printable ASCII chars
  it('property: all lines are exactly width ASCII chars', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 0, maxLength: 500 }),
      fc.integer({ min: 5, max: 40 }),
      (s, width) => {
        const lines = wrap(s, width);
        return lines.length >= 1 &&
          lines.every(l => {
            return l.length === width &&
              [...l].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
          });
      }
    ));
  });

  // Property: no words are lost (for pure-ASCII input without hyphens)
  it('property: wrap never loses ASCII words', () => {
    fc.assert(fc.property(
      // Use only ASCII words to avoid transliteration transforming word boundaries
      fc.array(fc.stringMatching(/^[a-zA-Z0-9]+$/), { minLength: 1, maxLength: 20 }),
      fc.integer({ min: 5, max: 40 }),
      (words, width) => {
        const input = words.join(' ');
        const lines = wrap(input, width);
        const output = lines.map(l => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
        // Every input word should appear in the output (possibly split for long words)
        // We verify that no short (fits in width) word is dropped
        const shortWords = words.filter(w => w.length <= width);
        return shortWords.every(w => output.includes(w));
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// columns
// ---------------------------------------------------------------------------
describe('columns', () => {
  it('produces exactly 40 chars', () => {
    const row = columns(['M5.1', '12:04', '80km SW of City'], [6, 7, 27]);
    assert.equal(row.length, 40);
  });

  it('truncates cells exceeding their column width', () => {
    const row = columns(['ABCDEF', 'XY'], [3, 37]);
    assert.equal(row.slice(0, 3), 'ABC');
  });

  it('pads cells shorter than their column width', () => {
    const row = columns(['Hi'], [10, 30]);
    assert.equal(row.slice(0, 10), 'Hi        ');
  });
});

// ---------------------------------------------------------------------------
// paginate
// ---------------------------------------------------------------------------
describe('paginate', () => {
  it('returns one sub-page when lines fit', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i}` }));
    const pages = paginate(lines, 22);
    assert.equal(pages.length, 1);
  });

  it('splits into multiple sub-pages', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ text: `L${i}` }));
    const pages = paginate(lines, 22);
    assert.equal(pages.length, 3); // 22 + 22 + 6
    assert.equal(pages[0].length, 22);
    assert.equal(pages[1].length, 22);
    assert.equal(pages[2].length, 6);
  });

  it('handles empty input with one empty page', () => {
    const pages = paginate([]);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].length, 0);
  });
});

// ---------------------------------------------------------------------------
// header
// ---------------------------------------------------------------------------
describe('header', () => {
  it('is exactly 40 chars', () => {
    assert.equal(header(100, 1, 1, '2026-11-04T12:34:56.000Z').length, 40);
  });

  it('contains the page number', () => {
    const h = header(200, 1, 1, '2026-11-04T12:34:56.000Z');
    assert.ok(h.includes('P200'), `header "${h}" should contain P200`);
  });

  it('contains TELETORCH', () => {
    const h = header(100, 1, 1, '2026-11-04T12:34:56.000Z');
    assert.ok(h.includes('TELETORCH'));
  });

  it('contains the UTC time', () => {
    const h = header(100, 1, 1, '2026-11-04T12:34:56.000Z');
    assert.ok(h.includes('12:34'), `header "${h}" should contain 12:34`);
  });

  it('shows sub-page indicator when subs > 1', () => {
    const h = header(300, 2, 3, '2026-11-04T00:00:00.000Z');
    assert.ok(h.includes('2/3'), `header "${h}" should contain 2/3`);
  });

  // Property: always 40 printable ASCII chars
  it('property: always 40 printable ASCII chars', () => {
    fc.assert(fc.property(
      fc.integer({ min: 100, max: 999 }),
      fc.integer({ min: 1, max: 9 }),
      fc.integer({ min: 1, max: 9 }),
      fc.constantFrom(
        '2026-11-04T00:00:00.000Z',
        '2026-01-01T23:59:00.000Z',
        '2026-06-15T08:00:00.000Z'
      ),
      (num, sub, subs, ts) => {
        const h = header(num, sub, subs, ts);
        return h.length === 40 &&
          [...h].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
      }
    ));
  });
});

// ---------------------------------------------------------------------------
// fastext
// ---------------------------------------------------------------------------
describe('fastext', () => {
  it('is exactly 40 chars', () => {
    const links = [
      { color: 'red', num: 100, label: 'INDEX' },
      { color: 'green', num: 200, label: 'QUAKE' },
      { color: 'yellow', num: 300, label: 'EVENT' },
      { color: 'cyan', num: 400, label: 'WTHR' },
    ];
    assert.equal(fastext(links).length, 40);
  });

  it('fills unused slots with spaces', () => {
    const f = fastext([{ color: 'red', num: 100, label: 'IDX' }]);
    assert.equal(f.length, 40);
    // Last 30 chars (green/yellow/cyan slots) should be spaces
    assert.ok(f.slice(10).trim() === '');
  });

  it('handles empty links array', () => {
    const f = fastext([]);
    assert.equal(f.length, 40);
    assert.equal(f.trim(), '');
  });

  it('handles null/undefined links', () => {
    assert.equal(fastext(null).length, 40);
    assert.equal(fastext(undefined).length, 40);
  });
});

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
describe('render', () => {
  const NOW = '2026-11-04T12:00:00.000Z';

  it('returns exactly 24 rows', () => {
    const page = { num: 100, sub: 1, subs: 1, title: 'INDEX', lines: [], links: [] };
    const { rows } = render(page, NOW);
    assert.equal(rows.length, 24);
  });

  it('every row is exactly 40 printable ASCII chars', () => {
    const page = {
      num: 200,
      sub: 1,
      subs: 1,
      title: 'EARTHQUAKES',
      lines: [
        { text: 'M5.1  12:04  80km SW of Tokyo', color: 'yellow' },
        { text: 'M4.8  09:22  40km N of Mexico City', color: 'white' },
      ],
      links: [
        { color: 'red', num: 100, label: 'INDEX' },
        { color: 'cyan', num: 201, label: 'MORE' },
      ],
    };
    const { rows } = render(page, NOW);
    for (const row of rows) {
      assert.equal(row.length, 40, `row "${row}" is not 40 chars`);
      for (const ch of row) {
        const cp = ch.charCodeAt(0);
        assert.ok(cp >= 32 && cp <= 126, `char ${cp} (${ch}) is not printable ASCII`);
      }
    }
  });

  it('row 0 is the header', () => {
    const page = { num: 100, sub: 1, subs: 1, title: 'INDEX', lines: [], links: [] };
    const { rows } = render(page, NOW);
    assert.ok(rows[0].includes('P100'));
    assert.ok(rows[0].includes('TELETORCH'));
  });

  it('row 23 is the fastext row', () => {
    const page = {
      num: 100, sub: 1, subs: 1, title: 'IDX', lines: [],
      links: [{ color: 'red', num: 100, label: 'IDX' }],
      srcLine: '',
    };
    const { rows } = render(page, NOW);
    assert.ok(rows[23].includes('100'));
  });

  it('colors array matches rows length', () => {
    const page = { num: 100, sub: 1, subs: 1, title: '', lines: [], links: [] };
    const { rows, colors } = render(page, NOW);
    assert.equal(colors.length, rows.length);
  });

  it('handles non-ASCII in title and lines', () => {
    const page = {
      num: 300, sub: 1, subs: 1,
      title: 'Eruption near R\u00e9union',
      lines: [{ text: 'Piton de la Fournaise volcano \u2013 update', color: 'white' }],
      links: [],
    };
    const { rows } = render(page, NOW);
    for (const row of rows) {
      for (const ch of row) {
        const cp = ch.charCodeAt(0);
        assert.ok(cp >= 32 && cp <= 126, `non-ASCII char found: ${cp}`);
      }
    }
  });

  it('handles null/undefined page gracefully', () => {
    const { rows } = render(null, NOW);
    assert.equal(rows.length, 24);
    for (const row of rows) assert.equal(row.length, 40);
  });

  // Property: render always returns 24 rows of exactly 40 printable ASCII chars
  it('property: 24x40 ASCII for any input', () => {
    const lineArb = fc.record({
      text: fc.string({ maxLength: 200 }),
      color: fc.constantFrom('white', 'yellow', 'cyan', 'green', 'red', 'magenta', 'blue'),
    });
    const linkArb = fc.record({
      color: fc.constantFrom('red', 'green', 'yellow', 'cyan'),
      num: fc.integer({ min: 100, max: 999 }),
      label: fc.string({ maxLength: 10 }),
    });
    const pageArb = fc.record({
      num: fc.integer({ min: 100, max: 999 }),
      sub: fc.integer({ min: 1, max: 9 }),
      subs: fc.integer({ min: 1, max: 9 }),
      title: fc.string({ maxLength: 100 }),
      lines: fc.array(lineArb, { maxLength: 30 }),
      links: fc.array(linkArb, { maxLength: 4 }),
    });
    fc.assert(fc.property(
      pageArb,
      fc.constantFrom(
        '2026-11-04T12:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '2026-12-31T23:59:59.000Z'
      ),
      (page, ts) => {
        const { rows, colors } = render(page, ts);
        return rows.length === 24 &&
          colors.length === 24 &&
          rows.every(r =>
            r.length === 40 &&
            [...r].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)
          );
      }
    ));
  });
});
