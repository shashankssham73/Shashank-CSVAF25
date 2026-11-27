// cuttools.js — what a piece can be when it is not a window.
//
// A cut piece holding a clock is a different kind of object from one holding
// Safari, but the sheet should not have to know that. Every tool is one entry
// here with a `draw`, and papercut.js calls it with the piece's box and a
// small environment. Adding a tool is adding an entry — no other file
// changes.
//
// Each draw gets:
//   ctx   the sheet's context, already clipped to the piece
//   box   { x, y, w, h } in device pixels
//   opts  whatever the piece stored, so a tool can be configured per piece
//   env   { t, dpr, chan, hue }   chan(name) is live machine telemetry

const pad = b => Math.min(b.w, b.h) * 0.08;

// Text that fits: a clock in a thin sliver and a clock in a big square are
// the same tool, and neither should overflow its piece.
function fit(ctx, text, box, frac, weight = '') {
  let size = box.h * frac;
  ctx.font = `${weight}${size}px ui-monospace, Menlo, monospace`;
  const max = box.w - pad(box) * 2;
  const w = ctx.measureText(text).width;
  if (w > max && w > 0) {
    size *= max / w;
    ctx.font = `${weight}${size}px ui-monospace, Menlo, monospace`;
  }
  return size;
}

const two = n => String(n).padStart(2, '0');

export const TOOLS = {

  clock: {
    title: 'Clock',
    hint: 'the time, big enough to read across the room',
    draw(ctx, box, opts, env) {
      const d = new Date();
      const t = opts.seconds === false
        ? `${two(d.getHours())}:${two(d.getMinutes())}`
        : `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const s = fit(ctx, t, box, 0.38);
      ctx.fillStyle = 'rgba(236,245,250,0.95)';
      ctx.fillText(t, box.x + box.w / 2, box.y + box.h / 2);
      if (box.h > s * 2.2) {
        ctx.font = `${s * 0.3}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = 'rgba(160,185,200,0.75)';
        ctx.fillText(d.toDateString(), box.x + box.w / 2, box.y + box.h / 2 + s * 0.8);
      }
    },
  },

  meter: {
    title: 'Meter',
    hint: 'one machine channel, as a number and a bar',
    draw(ctx, box, opts, env) {
      const name = opts.channel || 'cpu.busy_pct';
      const v = env.chan(name);
      const has = Number.isFinite(v);
      // Channels arrive in whatever units they are measured in; a percentage
      // is the common case and the only one worth normalising by guess.
      const frac = has ? Math.max(0, Math.min(1, /pct|percent/.test(name) ? v / 100 : v)) : 0;
      const p = pad(box);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `${Math.max(8, Math.min(13, box.h * 0.13))}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = 'rgba(160,185,200,0.8)';
      ctx.fillText(name, box.x + p, box.y + p + box.h * 0.13);

      const txt = has ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : '—';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fit(ctx, txt, box, 0.34);
      ctx.fillStyle = has ? 'rgba(236,245,250,0.95)' : 'rgba(255,160,110,0.9)';
      ctx.fillText(txt, box.x + box.w / 2, box.y + box.h * 0.48);

      const bh = Math.max(3, box.h * 0.07);
      const by = box.y + box.h - p - bh;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(box.x + p, by, box.w - p * 2, bh);
      ctx.fillStyle = `hsl(${(1 - frac) * 120} 70% 55%)`;
      ctx.fillRect(box.x + p, by, (box.w - p * 2) * frac, bh);
    },
  },

  note: {
    title: 'Note',
    hint: 'type into it — the text is part of the layout and is saved with it',
    draw(ctx, box, opts, env) {
      const p = pad(box);
      const text = opts.text || '';
      const size = Math.max(10, Math.min(26, box.h * 0.12));
      ctx.font = `${size}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = text ? 'rgba(236,245,250,0.92)' : 'rgba(150,175,190,0.5)';
      // Wrap by measuring: a note is handwriting, not a paragraph engine.
      const words = (text || 'click, then type').split(/\s+/);
      let line = '', y = box.y + p;
      const max = box.w - p * 2;
      for (const word of words) {
        const next = line ? line + ' ' + word : word;
        if (ctx.measureText(next).width > max && line) {
          ctx.fillText(line, box.x + p, y);
          y += size * 1.35;
          line = word;
          if (y > box.y + box.h - p - size) break;
        } else line = next;
      }
      if (line && y <= box.y + box.h - p - size * 0.2) ctx.fillText(line, box.x + p, y);
      if (env.editing) {
        const blink = Math.floor(env.t * 2) % 2 === 0;
        if (blink) {
          const w = ctx.measureText(line).width;
          ctx.fillStyle = '#ffd27f';
          ctx.fillRect(box.x + p + w + 2, y, 2, size);
        }
      }
    },
  },

  fill: {
    title: 'Fill',
    hint: 'a flat colour — negative space, a mat, a divider',
    draw(ctx, box, opts, env) {
      ctx.fillStyle = opts.colour || `hsl(${env.hue} 45% 22%)`;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    },
  },

};

export const TOOL_KEYS = Object.keys(TOOLS);
