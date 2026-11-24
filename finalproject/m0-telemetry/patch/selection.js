// selection.js — WHICH elements an effect applies to.
//
// The patcher had two value types on wires: numbers and shapes. This adds a
// third, and it is the one that makes effects composable the way a rule book
// needs them to be.
//
// Before, every effect carried an `applies to` dropdown with a fixed list.
// That cannot express "the filenames in Finder but not the sidebar", or "this
// particular heading I just clicked on", and it cannot be built up from
// parts. A selection is a VALUE: it travels on a wire, it can be combined
// with other selections, and one selection can feed several effects.
//
//   PICK something  ->  [selection]  ->  EFFECT
//                            |
//                            +-------->  another EFFECT
//
// A selection is a predicate tree, evaluated per element. Plain data, so it
// survives JSON and costs nothing to rebuild each frame.

import { compileSpec, toFieldX, toFieldY } from './sdf.js';

// A shape selection carries the distance-field SPEC, which is plain data and
// survives JSON, not a compiled closure. Compiling is the expensive half, so
// each spec is compiled once and the result cached against the spec object
// itself -- the graph rebuilds the spec only when a parameter changes.
const fieldCache = new WeakMap();
function fieldOf(spec) {
  if (!spec || typeof spec !== 'object') return null;
  let f = fieldCache.get(spec);
  if (!f) { try { f = compileSpec(spec); } catch (_) { f = () => 1; } fieldCache.set(spec, f); }
  return f;
}

export const isSel = v => !!(v && v.$ === 'sel' && v.m);
export const sel   = (m, label) => ({ $: 'sel', m, label: label || '' });
export const ALL   = sel({ t: 'all' }, 'everything');

// Does this element match? `e` is a laid-out glyph or a surface; both carry
// enough to answer. Unknown predicates match nothing rather than everything,
// because a selection that silently widens is far worse than one that
// silently does nothing.
export function matches(m, e) {
  if (!m) return false;
  switch (m.t) {
    case 'all':   return true;
    case 'none':  return false;

    // the element's role kind: menu / title / body / name / label
    case 'kind':  return e.kind === m.v;

    // what the text IS: path / number / url / sentence / identifier ...
    case 'class': return !!(e.sem && e.sem.kind === m.v);

    // the raw Accessibility role: AXButton, AXStaticText ...
    case 'role':  return !!(e.sem && e.sem.role === m.v);

    // everything belonging to one application
    case 'app':   return !!(e.sem && e.sem.app === m.v);

    // one specific element, captured by clicking it in the inspector.
    // Matched on its path through the hierarchy plus its text, because an
    // element has no stable id across snapshots — the same button is a new
    // AXUIElement every time the tree is walked.
    case 'elem':  return !!(e.sem && e.sem.path === m.path
                         && (m.text === undefined || e.sem.text === m.text
                             || (e.word !== undefined && m.text === e.word)));

    // everything under a point in the hierarchy: "this window", "this group"
    case 'under': return !!(e.sem && typeof e.sem.path === 'string'
                         && e.sem.path.startsWith(m.path));

    // numeric tests on the analysis, so "every long sentence" is a selection
    case 'range': {
      const v = e.sem ? e.sem[m.k] : undefined;
      return typeof v === 'number' && v >= m.lo && v <= m.hi;
    }

    // inside a shape: any distance field built from the shape blocks, which
    // means a custom region is a circle, a star, a ring, or any boolean
    // combination of them, moved and repeated by the shape transformers.
    case 'inside': {
      if (typeof e.nx !== 'number') return false;
      const f = fieldOf(m.d);
      if (!f) return false;
      const d = f(toFieldX(e.nx), toFieldY(e.ny));
      return m.out ? d > (m.edge || 0) : d <= (m.edge || 0);
    }

    case 'not':   return !matches(m.a, e);
    case 'and':   return matches(m.a, e) && matches(m.b, e);
    case 'or':    return matches(m.a, e) || matches(m.b, e);
    default:      return false;
  }
}

// A short human description, for the node header and the outline.
export function describe(m) {
  if (!m) return 'nothing';
  switch (m.t) {
    case 'all':   return 'everything';
    case 'none':  return 'nothing';
    case 'kind':  return m.v;
    case 'class': return 'any ' + m.v;
    case 'role':  return m.v.replace(/^AX/, '');
    case 'app':   return 'in ' + m.v;
    case 'elem':  return m.text ? `"${String(m.text).slice(0, 18)}"` : 'one element';
    case 'under': return 'under ' + String(m.path).split('>').pop();
    case 'inside': return m.out ? 'outside the shape' : 'inside the shape';
    case 'range': return `${m.k} ${m.lo}–${m.hi}`;
    case 'not':   return 'not ' + describe(m.a);
    case 'and':   return describe(m.a) + ' + ' + describe(m.b);
    case 'or':    return describe(m.a) + ' or ' + describe(m.b);
    default:      return '?';
  }
}

// How many of a set an element selection currently covers — shown on the
// node so a selection that matches nothing is visible immediately rather
// than looking like a broken effect.
export function countMatches(m, list) {
  if (!m || !list) return 0;
  let n = 0;
  for (const e of list) if (matches(m, e)) n++;
  return n;
}
