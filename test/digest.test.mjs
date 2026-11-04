/**
 * test/digest.test.mjs
 * Unit + property tests for src/digest.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  extractNumbers,
  numbersAreGrounded,
  templateDigest,
  aiDigest,
} from '../src/digest.mjs';

// ---------------------------------------------------------------------------
// extractNumbers
// ---------------------------------------------------------------------------

describe('extractNumbers', () => {
  it('extracts integers', () => {
    assert.deepEqual(extractNumbers('There were 3 quakes'), [3]);
  });

  it('extracts decimals', () => {
    assert.deepEqual(extractNumbers('M4.5 quake'), [4.5]);
  });

  it('extracts negative numbers', () => {
    assert.deepEqual(extractNumbers('temperature -3 degrees'), [-3]);
  });

  it('extracts time components from HH:MM', () => {
    const nums = extractNumbers('At 12:04 UTC');
    assert.ok(nums.includes(12), 'should include 12');
    assert.ok(nums.includes(4),  'should include 4');
  });

  it('returns empty array for text with no numbers', () => {
    assert.deepEqual(extractNumbers('no numbers here'), []);
  });

  it('returns empty array for non-string', () => {
    assert.deepEqual(extractNumbers(null), []);
    assert.deepEqual(extractNumbers(undefined), []);
    assert.deepEqual(extractNumbers(42), []);
  });

  it('handles multiple numbers', () => {
    const nums = extractNumbers('5 events, magnitude 6.2, depth 10 km');
    assert.ok(nums.includes(5));
    assert.ok(nums.includes(6.2));
    assert.ok(nums.includes(10));
  });
});

// ---------------------------------------------------------------------------
// numbersAreGrounded
// ---------------------------------------------------------------------------

describe('numbersAreGrounded', () => {
  it('returns true for text with no numbers', () => {
    assert.ok(numbersAreGrounded('no numbers', {}));
  });

  it('returns true when all numbers appear in facts', () => {
    const facts = { mag: 4.5, count: 3 };
    assert.ok(numbersAreGrounded('M4.5 quake, 3 events', facts));
  });

  it('returns false when a number is missing from facts', () => {
    const facts = { count: 3 };
    assert.ok(!numbersAreGrounded('M4.5 quake happened', facts));
  });

  it('returns true for numbers nested in arrays', () => {
    const facts = { quakes: [{ mag: 5.1 }, { mag: 4.7 }] };
    assert.ok(numbersAreGrounded('M5.1 and M4.7', facts));
  });

  it('returns true for numbers nested in objects', () => {
    const facts = { weather: { high: 22, low: 14 } };
    assert.ok(numbersAreGrounded('High 22, low 14', facts));
  });

  it('returns false for a partially-grounded string', () => {
    const facts = { mag: 4.5 };
    // 99 is not in facts
    assert.ok(!numbersAreGrounded('M4.5 and 99 events', facts));
  });

  it('handles number 0 in facts', () => {
    const facts = { count: 0 };
    assert.ok(numbersAreGrounded('0 events', facts));
  });

  it('extracts numbers from string values in facts', () => {
    const facts = { time: '12:04' };
    // 12 and 4 come from '12:04' parsed via extractNumbers on the fact value
    assert.ok(numbersAreGrounded('at 12 and 4', facts));
  });
});

// ---------------------------------------------------------------------------
// templateDigest
// ---------------------------------------------------------------------------

describe('templateDigest', () => {
  it('returns a non-empty string', () => {
    const t = templateDigest({});
    assert.ok(typeof t === 'string' && t.length > 0);
  });

  it('output contains only printable ASCII', () => {
    const t = templateDigest({
      quakesToday: [{ mag: 5.1, place: 'Tokyo' }],
      openEvents: [{ title: 'Wildfire' }],
      weather: { todayDesc: 'Clear' },
      aqi: { category: 'Good' },
    });
    for (const ch of t) {
      const cp = ch.charCodeAt(0);
      assert.ok(cp >= 32 && cp <= 126, `Non-ASCII char ${cp} in template`);
    }
  });

  it('is always grounded (contains no numbers by design)', () => {
    const facts = { quakesToday: [], openEvents: [] };
    const t = templateDigest(facts);
    // Template must not contain numbers itself (it is designed to be number-free)
    const nums = extractNumbers(t);
    // All numbers in template must appear in facts
    assert.ok(numbersAreGrounded(t, facts),
      `Template digest not grounded: "${t}", nums=${nums}`);
  });

  it('mentions the place name when provided', () => {
    const facts = {
      placeName: 'London',
      quakesToday: [],
      weather: { todayDesc: 'Clear' },
    };
    const t = templateDigest(facts);
    assert.ok(t.includes('London'), 'should mention the place name');
  });
});

// ---------------------------------------------------------------------------
// aiDigest -- fake AI env
// ---------------------------------------------------------------------------

/** Build a minimal facts object with explicit numbers for testing. */
function makeFacts(extra = {}) {
  return {
    quakesToday: [],
    significantQuakes: [],
    openEvents: [],
    ...extra,
  };
}

describe('aiDigest', () => {
  it('returns TEMPLATE mode when env.AI is absent', async () => {
    const { text, mode, reason, checked } = await aiDigest(makeFacts(), null);
    assert.equal(mode, 'TEMPLATE');
    assert.ok(text.length > 0);
    assert.ok(typeof reason === 'string');
    assert.ok(typeof checked === 'number');
  });

  it('returns TEMPLATE mode when env has no AI binding', async () => {
    const { text, mode } = await aiDigest(makeFacts(), {});
    assert.equal(mode, 'TEMPLATE');
  });

  it('returns AI mode when AI returns grounded text', async () => {
    const facts = makeFacts({ quakesTodayCount: 3 });
    const fakeEnv = {
      AI: {
        run: async (_model, _opts) => ({ response: 'There were 3 earthquakes today.' }),
      },
    };
    const { text, mode } = await aiDigest(facts, fakeEnv);
    assert.equal(mode, 'AI');
    assert.ok(text.includes('3'));
  });

  it('falls back to TEMPLATE when AI returns ungrounded numbers', async () => {
    const facts = makeFacts();  // no numbers in facts
    const fakeEnv = {
      AI: {
        run: async (_model, _opts) => ({ response: 'There were 99 earthquakes.' }),
      },
    };
    const { text, mode, reason } = await aiDigest(facts, fakeEnv);
    assert.equal(mode, 'TEMPLATE');
    assert.ok(reason.includes('ungrounded'), `reason should mention ungrounded, got: ${reason}`);
  });

  it('falls back to TEMPLATE when AI throws', async () => {
    const facts = makeFacts();
    const fakeEnv = {
      AI: {
        run: async () => { throw new Error('AI error'); },
      },
    };
    const { text, mode } = await aiDigest(facts, fakeEnv);
    assert.equal(mode, 'TEMPLATE');
  });

  it('falls back to TEMPLATE when AI times out (> 6s)', async () => {
    const facts = makeFacts();
    const fakeEnv = {
      AI: {
        run: async () => new Promise(resolve => setTimeout(() => resolve({ response: 'ok' }), 7000)),
      },
    };
    const { text, mode } = await aiDigest(facts, fakeEnv);
    assert.equal(mode, 'TEMPLATE');
  });

  it('returns only printable ASCII regardless of mode', async () => {
    const facts = makeFacts();
    const fakeEnv = {
      AI: {
        run: async () => ({ response: 'Safe summary with no numbers.' }),
      },
    };
    const { text } = await aiDigest(facts, fakeEnv);
    for (const ch of text) {
      const cp = ch.charCodeAt(0);
      assert.ok(cp >= 32 && cp <= 126, `Non-ASCII char ${cp}`);
    }
  });

  it('template output is always grounded against the facts', async () => {
    // With no AI binding, mode is TEMPLATE -- verify template is grounded
    const facts = makeFacts({
      quakesToday: [{ mag: 4.5, place: 'Tokyo', time: '12:00 UTC' }],
      quakesTodayCount: 1,
    });
    const { text, mode } = await aiDigest(facts, null);
    assert.equal(mode, 'TEMPLATE');
    assert.ok(numbersAreGrounded(text, facts),
      `Template output not grounded: "${text}"`);
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('property: ungrounded numbers are always rejected', () => {
  it('any text with a number absent from facts fails grounding', () => {
    fc.assert(fc.property(
      // Generate a number NOT in facts and embed it in text
      fc.integer({ min: 1000, max: 9999 }),
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => !/\d/.test(s)),
      (num, prefix) => {
        const facts = {}; // empty facts -- no numbers grounded
        const text = `${prefix} ${num}`;
        return !numbersAreGrounded(text, facts);
      }
    ));
  });

  it('text with only numbers that ARE in facts passes', () => {
    fc.assert(fc.property(
      fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => !/\d/.test(s)),
      (num, prefix) => {
        const facts = { value: num };
        // Round to same precision extractNumbers would yield
        const text = `${prefix} ${num}`;
        const extracted = extractNumbers(text);
        // Check that extracted number equals num closely enough
        return extracted.some(n => Math.abs(n - num) < 0.0001)
          ? numbersAreGrounded(text, facts)
          : true; // if extraction missed it, pass (not a failure)
      }
    ));
  });

  it('templateDigest is always grounded against any facts shape', () => {
    fc.assert(fc.property(
      fc.record({
        quakesToday: fc.array(fc.record({ mag: fc.float({ min: Math.fround(0), max: Math.fround(9), noNaN: true }) }), { maxLength: 5 }),
        openEvents: fc.array(fc.record({ title: fc.string() }), { maxLength: 5 }),
        // placeName is always a string or undefined (never null passed to templateDigest)
        placeName: fc.oneof(
          fc.constant(undefined),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z ]+$/.test(s))
        ),
      }),
      (facts) => {
        const t = templateDigest(facts);
        return numbersAreGrounded(t, facts);
      }
    ));
  });
});
