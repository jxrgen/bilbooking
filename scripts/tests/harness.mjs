// Fælles testharness: resultatopsamling, assertions og udtræk af de RIGTIGE
// funktioner fra app.js, så vi tester produktionskoden og ikke en kopi.

export const results = []; // { group, id, desc, status: 'PASS'|'FAIL'|'FINDING', detail }

let counter = 0;
function nextId(group) {
  counter += 1;
  return `T${String(counter).padStart(4, '0')}`;
}

export function record(group, desc, status, detail = '') {
  results.push({ group, id: nextId(group), desc, status, detail });
}

// Assertions — fanger selv exceptions, så en enkelt test aldrig vælter kørslen.
export function check(group, desc, fn) {
  try {
    const ok = fn();
    record(group, desc, ok ? 'PASS' : 'FAIL', ok ? '' : 'forventning ikke opfyldt');
  } catch (e) {
    record(group, desc, 'FAIL', 'exception: ' + (e && e.message ? e.message : String(e)));
  }
}

export function eq(group, desc, actual, expected, tol = 0) {
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  record(group, desc, ok ? 'PASS' : 'FAIL', ok ? '' : `fik ${JSON.stringify(actual)}, forventede ${JSON.stringify(expected)}`);
  return ok;
}

// En "finding" er ikke en fejl i koden, men en observation værd at rapportere
// (fx manglende DB-constraint, prisspring, etc.).
export function finding(group, desc, detail) {
  record(group, desc, 'FINDING', detail);
}

// ------------------------------------------------------------------
// Udtræk navngivne funktioner/objekter fra app.js via balancerede
// tuborg-klammer. De udtrukne funktioner indeholder ingen tuborger
// inde i strenge, så simpel optælling er sikker her.
// ------------------------------------------------------------------
export function extractBlock(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('kunne ikke finde: ' + marker);
  const b = src.indexOf('{', i);
  if (b < 0) throw new Error('ingen { efter: ' + marker);
  let depth = 0, j = b;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
