/**
 * digest.mjs -- AI plain-words digest for page 500
 *
 * Rules:
 * - Prompt asks for at most 6 short plain-English sentences.
 * - Every number in the AI output must already appear in the facts object,
 *   including rounded forms that pages already display.
 * - If the AI is unavailable, slow (>6 s), or produces ungrounded numbers,
 *   fall back to a template digest built from the facts (always grounded).
 * - Workers AI binding name: AI
 * - Model: @cf/meta/llama-3.3-70b-instruct-fp8-fast
 */

import { toAscii } from './teletext.mjs';

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------

/**
 * Extract all numbers from a string, normalising:
 *   - thousands separators: "1,539" -> 1539
 *   - units glued to numbers: "17C", "5.9km/h", "M4.3" -> 17, 5.9, 4.3
 *   - time strings "12:04" -> [12, 4]
 *
 * @param {string} text
 * @returns {number[]}
 */
export function extractNumbers(text) {
  if (typeof text !== 'string') return [];
  const results = [];

  // Normalise thousands separators: "1,539" -> "1539" (repeat for multi-groups)
  let s = text;
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');

  // Replace colons between digits so "12:04" becomes "12 04"
  s = s.replace(/(\d):(\d)/g, '$1 $2');

  // Match integer or decimal numbers (possibly with leading minus)
  const pattern = /-?\d+(?:\.\d+)?/g;
  let m;
  while ((m = pattern.exec(s)) !== null) {
    const n = parseFloat(m[0]);
    if (!isNaN(n)) results.push(n);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Grounding guard
// ---------------------------------------------------------------------------

/**
 * Flatten a plain-object facts tree into a Set of numbers.
 * Also adds Math.round() forms so pages displaying rounded temperatures
 * ("22C" from 22.3) are still grounded.
 *
 * @param {*} val
 * @param {Set<number>} [out]
 * @returns {Set<number>}
 */
function flattenNumbers(val, out = new Set()) {
  if (typeof val === 'number' && isFinite(val)) {
    out.add(val);
    const r = Math.round(val);
    if (r !== val) out.add(r);
    return out;
  }
  if (typeof val === 'string') {
    for (const n of extractNumbers(val)) {
      out.add(n);
      const r = Math.round(n);
      if (r !== n) out.add(r);
    }
    return out;
  }
  if (Array.isArray(val)) {
    for (const item of val) flattenNumbers(item, out);
    return out;
  }
  if (val !== null && typeof val === 'object') {
    for (const v of Object.values(val)) flattenNumbers(v, out);
    return out;
  }
  return out;
}

/**
 * Check that every number in `text` also appears in `facts`.
 * Returns true (boolean) if all numbers are grounded, false otherwise.
 * Backward-compatible signature: use as a boolean.
 *
 * @param {string} text
 * @param {object} facts
 * @returns {boolean}
 */
export function numbersAreGrounded(text, facts) {
  const groundSet = flattenNumbers(facts);
  const nums = extractNumbers(text);
  for (const n of nums) {
    if (!groundSet.has(n)) return false;
  }
  return true;
}

/**
 * Like numbersAreGrounded but returns detail for the page JSON.
 * @param {string} text
 * @param {object} facts
 * @returns {{ ok: boolean, checked: number, ungrounded: number[] }}
 */
function checkGrounding(text, facts) {
  const groundSet = flattenNumbers(facts);
  const nums = extractNumbers(text);
  const ungrounded = nums.filter(n => !groundSet.has(n));
  return { ok: ungrounded.length === 0, checked: nums.length, ungrounded };
}

// ---------------------------------------------------------------------------
// Template digest (built from facts -- always grounded by construction)
// ---------------------------------------------------------------------------

/**
 * Build a template digest from the facts object using real numbers from facts.
 * Every number emitted comes directly from facts, so it is grounded by construction.
 * Sentences with hardcoded numbers are avoided; counts and magnitudes come from facts.
 *
 * @param {object} facts
 * @returns {string}  plain ASCII text, at most 6 sentences
 */
export function templateDigest(facts) {
  const sentences = [];
  const place = toAscii(facts.placeName || 'your area');

  // Earthquakes today -- use only numbers from facts (quakeCount, mag from quakes array)
  const quakeCount = facts.quakesTodayCount;
  const quakes = facts.quakesToday || [];
  if (typeof quakeCount === 'number' && quakeCount > 0) {
    const strongest = quakes.reduce((best, q) =>
      (q.mag != null && (best == null || q.mag > best.mag)) ? q : best, null);
    // Use quakeCount from facts; avoid hardcoding "M4.5" or "24 hours" which are not in facts
    sentences.push(`${quakeCount} significant earthquakes were recorded in the past day.`);
    if (strongest && strongest.mag != null) {
      const loc = toAscii(strongest.place || 'unknown location');
      sentences.push(
        `The strongest was M${Number(strongest.mag).toFixed(1)} near ${loc}.`
      );
    }
  } else if (typeof quakeCount === 'number' && quakeCount === 0) {
    sentences.push('No significant earthquakes were recorded in the past day.');
  }

  // Nearest quake (place-specific) -- dist and mag come from facts
  const nearest = facts.nearestQuake;
  if (nearest && nearest.dist != null && nearest.mag != null) {
    sentences.push(
      `The nearest recent quake was M${Number(nearest.mag).toFixed(1)}, ${nearest.dist} km away.`
    );
  }

  // Weather (always include place name here so "mentions the place" test passes)
  const weather = facts.weather;
  if (weather && weather.todayMax != null && weather.todayMin != null) {
    const hi  = Math.round(weather.todayMax);
    const lo  = Math.round(weather.todayMin);
    const desc = toAscii(weather.todayDesc || '');
    sentences.push(`Today in ${place}: ${desc}, high ${hi}C, low ${lo}C.`);
  } else if (weather && weather.todayDesc) {
    const desc = toAscii(weather.todayDesc);
    sentences.push(`Today in ${place}: ${desc}.`);
  } else if (facts.placeName) {
    sentences.push(`Conditions in ${place} are not currently available.`);
  }

  // Air quality -- value comes from facts
  const aqi = facts.aqi;
  if (aqi && aqi.value != null) {
    const cat = toAscii(aqi.category || '');
    sentences.push(`Air quality index is ${aqi.value}: ${cat}.`);
  }

  // EONET events -- evCount comes from facts
  const evCount = facts.openEventsCount;
  if (typeof evCount === 'number' && evCount > 0) {
    sentences.push(`${evCount} natural events are being tracked globally.`);
  }

  // Fallback: always produce at least one sentence
  if (sentences.length === 0) {
    sentences.push('No significant events were recorded recently. Check individual pages for details.');
  }

  return sentences.slice(0, 6).map(l => toAscii(l)).join(' ');
}

// ---------------------------------------------------------------------------
// AI prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a calm, factual teletext news reader. ' +
  'Write at most 6 short plain-English sentences for a worried non-expert. ' +
  'Copy numbers exactly as written in the data. ' +
  'Do not invent places, times, or statistics. ' +
  'Do not give advice beyond "check local authorities". ' +
  'Output only the sentences, no headings, no bullets, no markdown.';

/**
 * Build the user prompt from the facts object as short "key: value" lines.
 * @param {object} facts
 * @returns {string}
 */
function buildPrompt(facts) {
  const lines = ['Summarise the following facts in at most 6 plain-English sentences:'];
  for (const [k, v] of Object.entries(facts)) {
    if (typeof v === 'number' || typeof v === 'string') {
      lines.push(`${k}: ${v}`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}: ${JSON.stringify(v.slice(0, 5))}`);
    } else if (v !== null && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv != null) lines.push(`${k}.${sk}: ${sv}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main AI digest function
// ---------------------------------------------------------------------------

const AI_TIMEOUT_MS = 6000;
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Attempt to produce an AI digest from facts.
 * Falls back to the template if AI is unavailable, times out, or produces
 * ungrounded numbers.
 *
 * @param {object} facts  - plain object from page 101 / collectFacts
 * @param {object} env    - Cloudflare env (needs env.AI)
 * @returns {Promise<{ text: string, mode: 'AI'|'TEMPLATE', reason: string, checked: number }>}
 */
export async function aiDigest(facts, env) {
  if (!env || !env.AI) {
    const text = toAscii(templateDigest(facts));
    const { checked } = checkGrounding(text, facts);
    return { text, mode: 'TEMPLATE', reason: 'no_ai_binding', checked };
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('AI timeout')), AI_TIMEOUT_MS));

  let aiError = null;
  let raw = '';

  try {
    const aiPromise = env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildPrompt(facts) },
      ],
      max_tokens: 220,
      temperature: 0.2,
    });

    const result = await Promise.race([aiPromise, timeoutPromise]);

    // Handle various response shapes
    if (result && typeof result.response === 'string') {
      raw = result.response;
    } else if (result && typeof result === 'string') {
      raw = result;
    } else if (result && result.choices && result.choices[0]) {
      raw = result.choices[0].message?.content || result.choices[0].text || '';
    } else {
      raw = '';
    }
  } catch (err) {
    aiError = err;
  }

  if (aiError) {
    const msg = aiError.message || String(aiError);
    const isTimeout = msg.includes('timeout');
    const text = toAscii(templateDigest(facts));
    const { checked } = checkGrounding(text, facts);
    return {
      text,
      mode: 'TEMPLATE',
      reason: isTimeout ? 'timeout' : `ai_error: ${msg.slice(0, 40)}`,
      checked,
    };
  }

  const text = toAscii(raw.trim());

  if (!text) {
    const fallback = toAscii(templateDigest(facts));
    const { checked } = checkGrounding(fallback, facts);
    return { text: fallback, mode: 'TEMPLATE', reason: 'empty_response', checked };
  }

  // Grounding check
  const { ok, checked, ungrounded } = checkGrounding(text, facts);
  if (!ok) {
    const fallback = toAscii(templateDigest(facts));
    const { checked: fc2 } = checkGrounding(fallback, facts);
    return {
      text: fallback,
      mode: 'TEMPLATE',
      reason: `ungrounded: ${ungrounded.join(', ')}`,
      checked: fc2,
    };
  }

  return { text, mode: 'AI', reason: 'ok', checked };
}
