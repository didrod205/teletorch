/**
 * digest.mjs -- AI plain-words digest for page 500
 *
 * Rules:
 * - Prompt asks for at most 8 short plain-English sentences.
 * - Every number in the AI output must already appear in the facts object.
 * - If the AI is unavailable, slow (>6 s), or produces ungrounded numbers,
 *   fall back to a fixed template digest marked "TEMPLATE".
 * - Workers AI binding name: AI
 * - Model: @cf/meta/llama-3.3-70b-instruct-fp8-fast
 */

import { toAscii } from './teletext.mjs';

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------

/**
 * Extract all numbers from a string.
 * Finds integers and decimals. Time strings like "12:04" yield [12, 4].
 * Strips leading zeros before comparison (e.g. "04" -> 4).
 *
 * @param {string} text
 * @returns {number[]}
 */
export function extractNumbers(text) {
  if (typeof text !== 'string') return [];
  // Match decimals, integers, and time components (HH:MM split on colon)
  // We tokenize: split on non-numeric-dot, then extract numeric tokens
  const results = [];
  // Replace colons between digits with a space so "12:04" -> "12 04"
  const normalized = text.replace(/(\d):(\d)/g, '$1 $2');
  // Match integer or decimal numbers (possibly with leading minus)
  const pattern = /-?\d+(?:\.\d+)?/g;
  let m;
  while ((m = pattern.exec(normalized)) !== null) {
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
 * Recurses into arrays and objects.
 *
 * @param {*} val
 * @param {Set<number>} [out]
 * @returns {Set<number>}
 */
function flattenNumbers(val, out = new Set()) {
  if (typeof val === 'number' && isFinite(val)) {
    out.add(val);
    return out;
  }
  if (typeof val === 'string') {
    for (const n of extractNumbers(val)) out.add(n);
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
 *
 * A number is grounded if:
 *   - It equals (after removing leading zeros) a number already in the
 *     flattened facts set, OR
 *   - It is in the built-in allow list {24, 7, 1000} AND those values
 *     appear in the facts.
 *
 * Returns true if all numbers are grounded, false if any are not.
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

// ---------------------------------------------------------------------------
// Template digest (always grounded -- uses no numbers)
// ---------------------------------------------------------------------------

/**
 * Build a template digest from the facts object.
 * Deliberately avoids any specific numbers so it is always grounded.
 *
 * @param {object} facts
 * @returns {string}  plain ASCII text, at most 8 sentences
 */
export function templateDigest(facts) {
  const lines = [];

  // Earthquakes
  const quakes = facts.quakesToday || [];
  if (quakes.length > 0) {
    lines.push(`Recent earthquakes have been recorded globally.`);
  } else {
    lines.push(`No major earthquakes were recorded recently.`);
  }

  // Significant quakes this week
  const sigQuakes = facts.significantQuakes || [];
  if (sigQuakes.length > 0) {
    lines.push(`Significant seismic activity has been recorded this week.`);
  }

  // EONET events
  const events = facts.openEvents || [];
  if (events.length > 0) {
    lines.push(`Natural events are being tracked globally.`);
  }

  // Weather
  const weather = facts.weather || {};
  if (weather.todayDesc) {
    const place = toAscii(facts.placeName || 'your area');
    lines.push(`Today in ${place}: ${toAscii(weather.todayDesc)}.`);
  }

  // Air quality
  const aqi = facts.aqi || {};
  if (aqi.category) {
    lines.push(`Air quality is currently ${toAscii(aqi.category)}.`);
  }

  // Footer note
  lines.push(`Check individual pages for full details.`);

  return lines.slice(0, 8).map(l => toAscii(l)).join(' ');
}

// ---------------------------------------------------------------------------
// AI prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a calm, factual teletext news reader. ' +
  'Write at most 8 short plain-English sentences summarising the facts provided. ' +
  'Use only numbers that appear in the data. ' +
  'Do not invent places, times, or statistics. ' +
  'Output only the summary sentences, no headings, no bullets, no markdown.';

/**
 * Build the user prompt from the facts object.
 * @param {object} facts
 * @returns {string}
 */
function buildPrompt(facts) {
  return 'Summarise these facts in at most 8 plain-English sentences:\n' +
    JSON.stringify(facts, null, 0);
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
 * @param {object} facts  - plain object from page 101 builder
 * @param {object} env    - Cloudflare env (needs env.AI)
 * @returns {Promise<{ text: string, mode: 'AI'|'TEMPLATE' }>}
 */
export async function aiDigest(facts, env) {
  if (!env || !env.AI) {
    return { text: toAscii(templateDigest(facts)), mode: 'TEMPLATE' };
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('AI timeout')), AI_TIMEOUT_MS));

  try {
    const aiPromise = env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildPrompt(facts) },
      ],
    });

    const result = await Promise.race([aiPromise, timeoutPromise]);

    // Extract text from response
    const raw = (result && result.response) ? String(result.response) : '';
    const text = toAscii(raw.trim());

    if (!text) {
      return { text: toAscii(templateDigest(facts)), mode: 'TEMPLATE' };
    }

    // Grounding check
    if (!numbersAreGrounded(text, facts)) {
      return { text: toAscii(templateDigest(facts)), mode: 'TEMPLATE' };
    }

    return { text, mode: 'AI' };
  } catch (_err) {
    return { text: toAscii(templateDigest(facts)), mode: 'TEMPLATE' };
  }
}
