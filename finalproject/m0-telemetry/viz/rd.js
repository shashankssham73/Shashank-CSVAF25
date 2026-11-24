// rd.js — Gray-Scott reaction-diffusion, on the GPU.
//
// Two notional chemicals on a grid. U is fed in everywhere at rate F; V eats U
// and converts it into more V; V is removed at rate F+k. Both diffuse, V at
// about half the rate of U. That asymmetry is the whole trick — it is Turing's
// 1952 morphogenesis instability, and it is why a uniform field spontaneously
// grows spots, stripes and branches.
//
//   dU/dt = Du.lap(U) - U.V^2 + F.(1 - U)
//   dV/dt = Dv.lap(V) + U.V^2 - (F + k).V
//
// Moving F and k by a few thousandths changes the pattern completely, which is
// exactly why 00-RESEARCH-MAP.md:312 specifies "feed rate F / kill rate k <-
// telemetry". A machine under load should grow a different organism than an
// idle one.
//
// WHY THE GPU. This runs 20 iterations per frame over 163,840 cells. That is
// 3.3 million cell updates per frame, roughly 50 million a second — hopeless
// in JavaScript, nothing at all for a fragment shader. The state lives in a
// floating-point texture and never comes back to the CPU; the output canvas is
// composited straight into the chain with drawImage, GPU to GPU.
//
// WHAT SEEDS IT. The source raster: the machine map, the shapes, and every
// traveller. A particle moving along a bus injects V where it passes, so
// throughput becomes something that makes the chemistry grow rather than a dot
// that slides along a line. An idle bus injects nothing and its patterns
// starve.

const VERT = `#version 300 es
void main() {
  // one oversized triangle covering the viewport; no vertex buffer needed
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SIM = `#version 300 es
precision highp float;
uniform sampler2D uState;      // rg = U, V
uniform sampler2D uSeed;       // the source raster
uniform vec2  uTexel;
uniform float uDu, uDv, uF, uK, uDt, uInject, uDecay;
out vec4 frag;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 c  = texture(uState, uv).rg;

  // 9-point Laplacian. The diagonal weights matter: a 5-point stencil makes
  // the patterns grow along the grid axes and the result looks pixelated.
  vec2 lap = c * -1.0;
  lap += texture(uState, uv + vec2(-uTexel.x,  0.0)).rg * 0.2;
  lap += texture(uState, uv + vec2( uTexel.x,  0.0)).rg * 0.2;
  lap += texture(uState, uv + vec2( 0.0, -uTexel.y)).rg * 0.2;
  lap += texture(uState, uv + vec2( 0.0,  uTexel.y)).rg * 0.2;
  lap += texture(uState, uv + vec2(-uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture(uState, uv + vec2( uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture(uState, uv + vec2(-uTexel.x,  uTexel.y)).rg * 0.05;
  lap += texture(uState, uv + vec2( uTexel.x,  uTexel.y)).rg * 0.05;

  float u = c.r, v = c.g;
  float reac = u * v * v;
  u += (uDu * lap.r - reac + uF * (1.0 - u)) * uDt;
  v += (uDv * lap.g + reac - (uF + uK) * v) * uDt;

  // Injection happens on the first iteration of a frame only (the host passes
  // uInject = 0 on the rest), so one frame of traffic is one dose.
  if (uInject > 0.0) {
    vec3 s = texture(uSeed, uv).rgb;
    v += dot(s, vec3(0.3, 0.5, 0.2)) * uInject;
  }
  v -= v * uDecay;        // extra starvation; compounds once per iteration

  frag = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

// The colouriser, again, in GLSL. Driven entirely by uniforms carrying the
// same stop data viz/colorizer.js uses, so the two cannot describe different
// palettes — there is no hand-written duplicate of the colour choices here.
const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uSeed;
uniform vec2  uTexel;
uniform float uGain, uBias, uFloor;
uniform int   uMode;           // 0 legacy, 1 keyer, 2 ramp
uniform vec3  uStop[4];
uniform float uAlpha[4];
uniform float uEdge[3];
uniform float uPos[4];
uniform vec3  uFlow, uWarn;
uniform float uKey, uWarnPull, uRampAlpha;
out vec4 frag;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float v = texture(uState, uv).g;
  float L = clamp(v * uGain + uBias, 0.0, 1.0);

  // chroma rides along from the seed, so a fault still reads amber through
  // the chemistry exactly as it does through the scan processor
  vec3 s = texture(uSeed, uv).rgb;
  float warm = s.r / (s.r + s.b + 0.004);

  vec3 col; float a;
  if (uMode == 1) {
    int i = 0;
    if (L >= uEdge[0]) i = 1;
    if (L >= uEdge[1]) i = 2;
    if (L >= uEdge[2]) i = 3;
    col = uStop[i];
    a   = uAlpha[i] * min(1.0, 0.12 + L * 1.25);
  } else if (uMode == 2) {
    float t = clamp(L, 0.0, 1.0);
    col = uStop[0];
    for (int i = 0; i < 3; i++) {
      float span = max(1e-5, uPos[i + 1] - uPos[i]);
      col = mix(col, uStop[i + 1], clamp((t - uPos[i]) / span, 0.0, 1.0));
    }
    a = uRampAlpha * min(1.0, 0.12 + L * 1.25);
  } else {
    col = warm > uKey ? uWarn : uFlow;
    a   = min(0.95, 0.10 + L * 1.25);
  }

  float over = warm - uKey;
  if (over > 0.0) col = mix(col, uWarn, min(1.0, over / max(0.05, 1.0 - uKey)) * uWarnPull);

  // Every colouriser mode has a floor of about 0.1 alpha so that faint parts
  // of the image stay faintly visible. The scan processor never reaches that
  // floor on empty ground because it skips segments below scan.floor, but
  // this shader runs on EVERY pixel — so without a coverage term, dead
  // chemistry would wash the whole frame in a flat tint.
  float cover = smoothstep(uFloor, uFloor + 0.035, L);
  if (cover <= 0.0) discard;
  a *= cover;

  // premultiplied: the field is composited additively into the feedback buffer
  frag = vec4(col / 255.0 * a, a);
}`;

// Pearson's classification, by the names people actually use. These are the
// regimes worth modulating between; the space between them is continuous and
// mostly interesting.
export const REGIMES = {
  coral:    { F: 0.0545, k: 0.0620, about: 'branching filaments that creep outward' },
  mitosis:  { F: 0.0367, k: 0.0649, about: 'blobs that grow and split, then split again' },
  worms:    { F: 0.0580, k: 0.0650, about: 'winding channels that fill space into a maze' },
  solitons: { F: 0.0300, k: 0.0620, about: 'discrete spots that hold shape and bounce' },
  waves:    { F: 0.0140, k: 0.0540, about: 'travelling wavefronts' },
  uskate:   { F: 0.0620, k: 0.0609, about: 'gliders that crawl and collide' },
};

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class ReactionDiffusion {
  constructor(w = 512, h = 320) {
    this.w = w; this.h = h;
    this.ok = false;
    this.reason = '';
    this.iters = 0;

    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;

    const gl = this.canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) { this.reason = 'WebGL2 unavailable'; return; }
    this.gl = gl;

    // Gray-Scott needs real floats. 8-bit state quantises the concentrations
    // so coarsely that the patterns freeze instead of growing.
    const f32 = gl.getExtension('EXT_color_buffer_float');
    const f16 = gl.getExtension('EXT_color_buffer_half_float');
    if (f32)      { this.internal = gl.RGBA32F; this.type = gl.FLOAT; }
    else if (f16) { this.internal = gl.RGBA16F; this.type = gl.HALF_FLOAT; }
    else { this.reason = 'no float render target (EXT_color_buffer_float)'; return; }

    try {
      this.simP  = program(gl, SIM);
      this.showP = program(gl, SHOW);
    } catch (e) { this.reason = e.message; return; }

    this.vao = gl.createVertexArray();
    this._alloc(w, h);
    this.seedTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
                          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([0, 0, 0, 255]));

    this.uSim  = this._uniforms(this.simP);
    this.uShow = this._uniforms(this.showP);
    this.ok = true;
    this.reset();
  }

  _uniforms(p) {
    const gl = this.gl, out = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      out[name] = gl.getUniformLocation(p, info.name);
    }
    // A uniform the compiler optimised out is simply absent, and passing
    // `undefined` as a location throws in some drivers. Returning null for
    // anything missing makes those calls the silent no-ops the spec intends.
    return new Proxy(out, { get: (t, k) => (k in t ? t[k] : null) });
  }

  _alloc(w, h) {
    const gl = this.gl;
    if (this.fb) for (const f of this.fb) gl.deleteFramebuffer(f);
    if (this.tex) for (const t of this.tex) gl.deleteTexture(t);
    this.tex = []; this.fb = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, this.internal, w, h);
      // NEAREST: the simulation samples exact neighbours, and interpolating
      // them would smear the Laplacian and damp the patterns out.
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      }
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        this.ok = false; this.reason = 'incomplete framebuffer';
      }
      this.tex.push(t); this.fb.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.src = 0;
  }

  resize(w, h) {
    if (!this.gl || (w === this.w && h === this.h)) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this._alloc(w, h);
    this.reset();
  }

  // U = 1, V = 0 is the stable state: nothing happens until something seeds it.
  // That is deliberate — the machine is what breaks the symmetry.
  reset() {
    if (!this.ok) return;
    const gl = this.gl;
    const n = this.w * this.h * 4;
    const data = this.type === gl.FLOAT ? new Float32Array(n) : new Uint16Array(n);
    if (this.type === gl.FLOAT) {
      for (let i = 0; i < n; i += 4) { data[i] = 1; data[i + 3] = 1; }
    } else {
      for (let i = 0; i < n; i += 4) { data[i] = 0x3C00; data[i + 3] = 0x3C00; }  // half 1.0
    }
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RGBA, this.type, data);
    }
  }

  // img: the ImageData of the source raster, already carrying the machine map,
  // the shapes and every traveller.
  seed(img) {
    if (!this.ok || !img) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, img.width, img.height, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer));
  }

  // p: { F, k, Du, Dv, dt, iters, inject, decay }
  step(p) {
    if (!this.ok) return;
    const gl = this.gl;
    const n = Math.max(0, Math.min(60, Math.round(p.iters)));
    this.iters = n;
    if (!n) return;

    gl.bindVertexArray(this.vao);
    gl.useProgram(this.simP);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);

    const u = this.uSim;
    gl.uniform2f(u.uTexel, 1 / this.w, 1 / this.h);
    gl.uniform1f(u.uDu, p.Du); gl.uniform1f(u.uDv, p.Dv);
    gl.uniform1f(u.uF, p.F);   gl.uniform1f(u.uK, p.k);
    gl.uniform1f(u.uDt, p.dt); gl.uniform1f(u.uDecay, p.decay);
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uSeed, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex);

    for (let i = 0; i < n; i++) {
      gl.uniform1f(u.uInject, i === 0 ? p.inject : 0);   // one dose per frame
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[1 - this.src]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.src]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.src = 1 - this.src;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Draw the V field to this.canvas, coloured by the same configuration the
  // rest of the chain is using.
  render(colorizer, gain, bias, key, floor = 0.03) {
    if (!this.ok) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.showP);
    gl.viewport(0, 0, this.w, this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    const u = this.uShow;
    gl.uniform2f(u.uTexel, 1 / this.w, 1 / this.h);
    gl.uniform1f(u.uGain, gain); gl.uniform1f(u.uBias, bias);
    gl.uniform1f(u.uFloor, floor);
    gl.uniform1f(u.uKey, key);   gl.uniform1f(u.uWarnPull, colorizer.warnPull);
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uSeed, 1);

    const cfg = colorizer.cfg, mode = colorizer.mode;
    gl.uniform1i(u.uMode, mode === 'keyer' ? 1 : mode === 'ramp' ? 2 : 0);
    const stops = new Float32Array(12), alphas = new Float32Array(4),
          edges = new Float32Array(3),  pos    = new Float32Array(4);
    if (mode === 'keyer' && cfg) {
      cfg.stops.forEach((s, i) => { stops.set(s.c, i * 3); alphas[i] = s.a; });
      edges.set(cfg.edges.slice(0, 3));
    } else if (mode === 'ramp' && cfg) {
      // colorizer._stops are already hue-rotated and sorted
      (colorizer._stops || cfg.stops).forEach((s, i) => { stops.set(s.c, i * 3); pos[i] = s.p; });
      gl.uniform1f(u.uRampAlpha, cfg.alpha);
    }
    gl.uniform3fv(u.uStop, stops);
    gl.uniform1fv(u.uAlpha, alphas);
    gl.uniform1fv(u.uEdge, edges);
    gl.uniform1fv(u.uPos, pos);
    gl.uniform3fv(u.uFlow, new Float32Array(colorizer.flowRGB));
    gl.uniform3fv(u.uWarn, new Float32Array(colorizer.warnRGB));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.src]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
