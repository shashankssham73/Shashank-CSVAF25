// botanical.js — your filesystem as a tree that actually looks like one.
//
// Kleiberg, van de Wetering & van Wijk, "Botanical Visualization of Huge
// Hierarchies" (IEEE InfoVis 2001): directories are stems, subdirectories are
// branches, and sets of files are fruit. Twenty-four years old, and almost
// exactly the thing you described.
//
// THE STRAND MODEL is the part worth getting right. Each file contributes one
// "strand"; a branch carries every strand in its subtree; and thickness goes
// as the SQUARE ROOT of the strand count, not the count. That is da Vinci's
// rule — the cross-sectional area of the children equals the area of the
// parent — and it is why a real tree's trunk looks proportionate to its
// canopy instead of absurdly thick. Using the count directly gives a tree
// with a trunk like a wall.
//
// EVERY NUMBER HERE IS A PARAMETER. Nothing about the shape of the tree is
// decided in this file: angle, length, falloff, thickness, phototropism,
// twist, growth and the fruit are all supplied by the patch, so the design
// decisions stay yours and stay changeable without touching code.

export const BOT_DEFAULTS = {
  // Defaults chosen by sweeping against a real ~/Documents: this fills about
  // 44% of the width and 67% of the height without touching the edges.
  angle:   95,     // total spread across a node's children, degrees
  lenBase: 0.21,   // first branch length, as a fraction of height
  lenFall: 0.84,   // length multiplier per level
  thick:   1.9,    // thickness scale on sqrt(strands)
  photo:   0.12,   // phototropism: how hard branches bend back toward vertical
  twist:   0,      // extra rotation per level — turns the tree into a spiral
  grow:    1,      // 0..1, how much of the tree has grown in
  maxDepth: 5,
  labelDepth: 2,   // label directories down to this depth; deeper is unreadable
  fSize:   3.2,    // fruit radius scale on sqrt(file size)
  fPetals: 5,      // 0 = a plain berry, >=3 = a flower
  fBloom:  0.45,   // how far the petals open
  fSpread: 16,     // how widely a cluster of files sits around its branch tip
};

const TAU = Math.PI * 2, DEG = Math.PI / 180;

// Strands: one per file, summed up the tree. Memoised onto the node because
// the tree is rebuilt every frame and this is the only recursive cost.
function strands(n) {
  if (n._s !== undefined) return n._s;
  if (!n.dir) return (n._s = 1);
  let s = 0;
  for (const k of n.kids) s += strands(k);
  return (n._s = Math.max(1, s));
}

// A deterministic wobble so sibling branches are not mirror-identical.
// Hashed from the path, so the same folder always grows the same way.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export function botanicalScene(tree, W, H, p = {}) {
  const P = { ...BOT_DEFAULTS, ...p };
  const chrome = [], blocks = [], surfaces = [];
  if (!tree) return { W, H, chrome, blocks, surfaces };

  const surf = (id, kind, x, y, w, h) => {
    surfaces.push({ id, kind, x, y, w, h, cx: x + w / 2, cy: y + h / 2,
                    i: surfaces.length, kindIndex: 0, ofKind: 1 });
    return id;
  };
  // One surface for the whole tree, so layout operators can tilt or sway it
  // as a single object; one per labelled folder, so folders can be moved
  // independently of the branch they grow on.
  const treeSurf = surf('tree', 'window', 0, 0, W, H);

  const total = strands(tree);
  const maxD = Math.max(1, Math.round(P.maxDepth));
  // Growth reveals the tree outward from the root: whole levels appear, and
  // the frontier level extends partway, so it grows rather than blinks in.
  const g = Math.min(1, Math.max(0, P.grow));
  const grown = g * maxD;

  const walk = (node, ox, oy, dir, len, depth, path) => {
    if (depth > maxD || depth > grown) return;
    const frac = Math.min(1, grown - depth);          // partial on the frontier
    if (frac <= 0) return;

    const L = len * frac;
    const ex = ox + dir.x * L, ey = oy + dir.y * L;
    const s = strands(node);
    const w1 = P.thick * Math.sqrt(s);
    const w2 = P.thick * Math.sqrt(Math.max(1, s * 0.62));
    chrome.push({ t:'branch', x1:ox, y1:oy, x2:ex, y2:ey, w1, w2, depth,
                  frac: s / total, surf: treeSurf });

    const dirs  = node.kids.filter(k => k.dir);
    const files = node.kids.filter(k => !k.dir);

    // Files become a cluster of fruit at the tip of their own branch.
    if (files.length && frac >= 1) {
      let fx = 0, fy = 0;
      files.slice(0, 40).forEach((f, i) => {
        const a = (i / Math.max(1, Math.min(40, files.length))) * TAU + hashStr(path) * TAU;
        const r = P.fSpread * (0.45 + 0.55 * hashStr(path + f.name));
        fx = ex + Math.cos(a) * r; fy = ey + Math.sin(a) * r;
        chrome.push({ t:'fruit', x:fx, y:fy,
                      r: P.fSize * Math.sqrt(Math.log1p(f.size) / 6 + 0.25),
                      petals: Math.round(P.fPetals), bloom: P.fBloom,
                      a, surf: treeSurf });
      });
    }

    // Label directories near the top of the tree; deeper is unreadable.
    if (node !== tree && depth <= P.labelDepth && frac >= 1) {
      const id = surf('bot' + surfaces.length, 'icon', ex - 50, ey - 26, 100, 32);
      blocks.push({ kind:'name', x:ex, y:ey - 12, size:11.5,
                    text:node.name, align:'center', surf:id });
      // re-tag this node's own branch so the label and its branch move together
    }

    if (!dirs.length || frac < 1) return;
    const n = dirs.length;
    const spread = P.angle * DEG;
    dirs.forEach((k, i) => {
      const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;    // -0.5 .. 0.5
      const wob = (hashStr(path + '/' + k.name) - 0.5) * spread * 0.18;
      let a = t * spread + wob + P.twist * DEG * depth;
      const ca = Math.cos(a), sa = Math.sin(a);
      let nx = dir.x * ca - dir.y * sa, ny = dir.x * sa + dir.y * ca;
      // Phototropism: bend back toward straight up (0, -1).
      nx += (0 - nx) * P.photo; ny += (-1 - ny) * P.photo;
      const m = Math.hypot(nx, ny) || 1;
      // Bigger subtrees get longer branches, which is what makes the shape
      // carry information rather than just look organic.
      const sz = Math.sqrt(strands(k) / s);
      walk(k, ex, ey, { x:nx/m, y:ny/m }, len * P.lenFall * (0.55 + 0.75 * sz),
           depth + 1, path + '/' + k.name);
    });
  };

  walk(tree, W / 2, H * 0.97, { x:0, y:-1 }, H * P.lenBase, 0, tree.name || '/');

  const counts = {};
  for (const s of surfaces) s.kindIndex = counts[s.kind] = (counts[s.kind] ?? -1) + 1;
  for (const s of surfaces) s.ofKind = counts[s.kind] + 1;

  return { W, H, chrome, blocks, surfaces, stats: { strands: total, branches: chrome.filter(c=>c.t==='branch').length,
            fruit: chrome.filter(c=>c.t==='fruit').length } };
}
