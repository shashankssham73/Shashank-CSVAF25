// opdocs.js — one line per operator.
//
// Kept separate from ops.js so the descriptors stay pure data and this stays
// prose. Used by the palette as hover text and by the manual generator, so
// there is exactly one place a description lives and it cannot drift between
// the tool and its documentation.

export const OPDOCS = {

// ---------------------------------------------------------------- pick
'pick.all':     'Everything the readers found. The simplest selection there is.',
'pick.element': 'One specific element, filled in by clicking it in the inspector on the right. Matched on its path through the hierarchy plus its text, because an element has no stable id between snapshots.',
'pick.under':   'Everything beneath a point in the hierarchy — this window, this group, this toolbar.',
'pick.role':    'By raw Accessibility role: AXButton, AXStaticText, AXMenuItem.',
'pick.app':     'Everything belonging to one application.',
'pick.class':   'By what the text IS: path, url, number, date, sentence, identifier.',
'pick.kind':    'By part of the interface: menu, title, body, name, label.',
'pick.range':   'By measurement, between two values. Text measures (entropy, length, depth) and screen measures (brightness, hue, edge density, busyness) both work, so "every long sentence" and "every bright tile" are the same kind of selection.',
'pick.combine': 'Two selections into one, with and / or. What lets you say "the filenames in Finder but not the sidebar" with no special case anywhere.',
'pick.invert':  'Everything the input selection does not match.',

// ---------------------------------------------------------------- read
'read.elements': 'Read the screen as ELEMENTS, through the Accessibility API: role, text, rectangle, hierarchy. Exact and semantic, and blind to anything that is not a control.',
'read.grid':     'Read the screen as a GRID of tiles, each measured for brightness, hue, saturation, edge density and busyness. Predictable cost, and the honest form of "pixel by pixel" — a fine grid at a density you can actually work with.',
'read.regions':  'Read the screen as REGIONS: measure a fine grid, then merge neighbouring tiles that look alike. Follows the content rather than the markup, so it sees photographs and video that Accessibility cannot.',

// ---------------------------------------------------------------- sources
'channel':  'One of the 43 measured telemetry channels. Everything starts here.',
'const':    'A fixed number. Useful for pinning a destination to one value.',
'time':     'Seconds since the page loaded. Drives anything that should drift.',

// ---------------------------------------------------------------- math
'scale':    'Multiply then add. The workhorse for getting a channel into a usable range.',
'curve':    'Bend a value: log1p, power, exponential, square root or sigmoid.',
'norm':     'Map a heavy-tailed channel into 0..1 using log1p against an adapting peak. The most-used conditioning step in the project.',
'clamp':    'Hard-limit a value between two bounds.',
'remap':    'Map one range onto another, optionally clamped. The usual last step before an Output.',
'abs':      'Magnitude, discarding sign.',
'invert':   'One minus the input. Flips a 0..1 signal.',

// ---------------------------------------------------------------- combine
'math2':    'Two inputs, one of add / subtract / multiply / divide / min / max / power.',
'mix':      'Crossfade between two inputs by a third.',

// ---------------------------------------------------------------- filters
'lowpass':  'One-pole smoothing at a cutoff in Hz. Removes jitter without adding much lag.',
'oneeuro':  'The one-euro filter: smooths when still, responds when moving. Better than a low pass for anything you will look at directly.',
'envelope': 'Attack and release follower. Turns a spiky event channel into something that rises fast and falls slowly.',
'slew':     'Limit how fast a value may change, in units per second.',
'peakhold': 'Hold the maximum, then decay. Makes brief peaks visible.',

// ---------------------------------------------------------------- dsp
'autocorr':   'Correlate a signal against itself to find its period. Reports period, strength and a per-minute rate. This is what recovers the rhythm of a repeating task.',
'spectrum':   'FFT of the signal: spectral centroid, flatness, in-band energy and peak frequency.',
'bandresynth':'STFT, keep one frequency band, inverse STFT. Latency is about one window, so a slow band arrives late by design.',
'convolve':   'Convolve the signal with a preset kernel (exponential, box, triangle, raised cosine).',
'xcorr':      'Cross-correlate two channels to find the lag between them and which one leads.',

// ---------------------------------------------------- drawing as computation
'draw.transfer': 'A curve you draw becomes a lookup table. The drawing IS the transfer function.',
'draw.kernel':   'A curve you draw becomes an FIR filter kernel. Left is now, right is the past. Drawing a curve is designing a filter.',
'draw.mask':     'A curve you draw becomes a frequency response, applied to the STFT and resynthesised. The software form of an optical Fourier mask.',

// ---------------------------------------------------------------- rd
'rd.regime': 'Blend between two named Gray-Scott regimes, outputting feed and kill rates. The space between two named points is continuous and mostly interesting.',

// ---------------------------------------------------------------- logic
'threshold':'Above a level, output 1; below it minus hysteresis, output 0.',
'gate':     'Pass the input only while a second input is above a threshold.',
'select':   'Choose between two inputs based on a third.',
'compare':  'Compare two inputs, output 0 or 1.',

// ---------------------------------------------------------------- generators
'lfo':      'A free-running oscillator: sine, triangle, saw or square, with a frequency input.',
'pink':     '1/f noise. Drifts like a natural process rather than jittering like white noise.',
'gen.ramp': 'A sweep whose SHAPE you draw, restartable by a trigger. The analogue motion generator, with the motion drawn by hand.',
'gen.sh':   'Sample and hold: freeze a value on a rising edge and keep it. Turns a continuous channel into a decision.',
'gen.seq':  'Eight-step sequencer, externally clocked or free-running, with optional glide. The one operator here that imposes a rhythm the machine does not have.',

// ---------------------------------------------------------------- shapes
'sdf.circle':'A circle, as a signed distance field.',
'sdf.box':   'A rectangle with roundable corners.',
'sdf.ngon':  'A regular polygon. Radius is the apothem, the distance to an edge midpoint.',
'sdf.star':  'A star. Sharpness 0 collapses it to its polygon, 1 is the spikiest it can be.',
'sdf.ring':  'An annulus of a given radius and thickness.',
'sdf.seg':   'A thick line segment with rounded caps.',
'sdf.arc':   'A partial ring, with an aperture and rotation.',
'sdf.curve': 'A curve you draw becomes a radial profile: angle reads along the drawing, height becomes radius. This is where a sketch becomes geometry.',

// ---------------------------------------------------------- shape transforms
'sh.move':   'Translate a shape.',
'sh.rotate': 'Rotate a shape about the origin, in turns.',
'sh.scale':  'Scale a shape, uniformly or per axis.',
'sh.skew':   'Shear a shape.',
'sh.squeeze':'Scale that varies along the other axis, so a shape tapers rather than merely shearing. Scanimate’s signature gesture.',
'sh.repeat': 'Tile a shape at a pitch, with a limited count.',
'sh.mirror': 'Reflect across an axis.',
'sh.polar':  'Repeat a shape around a circle.',
'sh.twist':  'Rotate by an amount proportional to distance from the centre.',
'sh.round':  'Inflate or deflate the field, rounding every corner at once. Only a distance field can do this; there is no path to edit.',
'sh.onion':  'Hollow a solid into a shell of a given thickness.',

// ---------------------------------------------------------- shape combine
'sh.union':  'Both shapes, as one.',
'sh.sub':    'Cut the second shape out of the first.',
'sh.inter':  'Only where both overlap.',
'sh.blend':  'Smooth minimum: the two shapes grow a fillet into each other. Drive the radius and two objects become one and separate again.',
'sh.morph':  'Interpolate two fields, so the SHAPES tween through forms that belong to neither. The thing keyframes cannot do.',

// ---------------------------------------------------------- shape render
'sh.fill':   'Draw a shape as a solid. A sink: it ends a chain.',
'sh.contour':'Draw concentric outlines sliced from one field. Falls straight out of a distance field and is the most video-synthesiser-looking thing in the set.',

// ---------------------------------------------------------------- colour
'col.keyer': 'Four hard luminance bands, each with its own colour and alpha, with modulatable edges. What the 1969 colouriser did.',
'col.ramp':  'A smooth four-stop gradient with gamma, offset and hue rotation. One signal can sweep the whole palette.',

// ---------------------------------------------------------------- typography
'txt.wave':    'The bouncy one. A sinusoid displacing each glyph, with its phase from whichever coordinate you choose.',
'txt.jitter':  'Per-glyph noise, seeded from the glyph itself so scattered text stays scattered instead of boiling.',
'txt.rotate':  'Tilt each glyph: alternating, uniform, accumulating, or oscillating.',
'pick.shape': 'Selects whatever falls inside a shape, so a custom region is any distance field you can build — a circle, a star, a ring, or a whole boolean assembly run through the shape transformers. “Grow edge” pushes the boundary outwards or eats into it, which lets one shape drive a soft core and a hard rim without drawing it twice. Switch to “outside” and the same shape becomes a hole.',
// ---------------------------------------------------------------- image
'img.source': 'The frame being rendered, as something a chain can start from — your captured screen, the mock desktop, the folder tree, whatever the source is. “Black” gives an empty frame instead, for a chain that should build a picture rather than process one.',
'img.scan': 'The Rutt/Etra scan processor. Each row of the picture is deflected by its own brightness, which turns a flat image into a relief lit from the side. Row spacing thins the scanlines; the key threshold drops pixels too dim to matter; the density reference compensates for how much light the source puts out, so a dense screen capture does not wash out.',
'img.feedback': 'Draws each frame over the last one, slightly zoomed and turned. Gain is how much of the previous frame survives: below about 0.9 it is a soft trail, above 0.99 almost nothing ever decays and movement leaves permanent light.',
'img.rd': 'Gray-Scott reaction-diffusion, seeded by whatever reaches it. Two chemicals, one feeding the other; the feed and kill rates decide whether you get coral, worms, solitons or a dead screen, and the usable range between those is narrow. Steps per frame is how far the simulation runs before it is drawn.',
'img.blur': 'A plain blur. Useful before a blend, where the sharp copy keeps the detail and the blurred one supplies the glow.',
'img.levels': 'Gain, brightness, gamma and a black floor. Usually what a picture needs before something else gets hold of it — the floor in particular, because a near-black background is the difference between a clean image and a faint haze over everything.',
'img.colour': 'Maps brightness onto whatever colouriser is configured by a Gradient ramp or Luma keyer. Amount crossfades against the untouched picture, so partial colourising is one dial rather than a second chain.',
'img.blend': 'Two pictures into one: mix, add, multiply, screen or difference. This is what makes an image chain a graph rather than a line — split the source, treat the halves differently, and bring them back together.',
'img.out': 'The end of an image chain, and the only block here that reaches the picture. Everything upstream is a description until this hands it to the renderer. Mix crossfades the result against the untouched desktop, exactly as chain.mix does for the built-in pipeline.',
'txt.scale':   'Resize each glyph, on either axis. A legibility floor in pixels stops it shrinking below readable while leaving it free to grow — clamped against each glyph’s own size, so one setting works for labels and headings alike.',
'txt.axes':    'Weight, width and slant. Synthesised rather than true variable-font axes, because Canvas2D cannot set them.',
'txt.spacing': 'Letter and line spacing. Read before layout, not after, because spacing changes where glyphs ARE.',
'txt.baseline':'A curve you draw becomes the shape of the line. The letters follow your sketch.',
'txt.scatter': 'Push glyphs away from their word, line, or a point, with optional swirl.',
'txt.colour':  'Per-glyph hue and alpha.',
'txt.cascade': 'Delay everything BELOW it by an amount that depends on the glyph, so an effect arrives along the text instead of happening everywhere at once.',

// ---------------------------------------------------------------- layout
'lay.move':   'Displace whole windows and icons with a wave.',
'lay.rotate': 'Turn each surface about its own centre.',
'lay.scale':  'Resize each surface about its centre.',
'lay.tilt':   'Shear a surface, which reads as perspective without needing any.',
'lay.spiral': 'Rotate each surface’s POSITION about a point, proportional to its distance. The desktop winds up.',
'lay.ring':   'Lerp every surface from where it belongs onto a circle. At 0 nothing, at 1 a dial, real arrangements in between.',
'lay.drift':  'Seeded per-surface noise. Stable unless given a rate.',
'lay.gravity':'Collapse the desktop into a pile, or explode it.',

// ---------------------------------------------------------------- botanical
'bot.tree':  'The tree’s shape: spread, length, falloff, thickness, upward bias and twist. Thickness goes as the square root of the files in a subtree, which is da Vinci’s rule.',
'bot.grow':  'How much of the tree has grown in. Levels appear in order and the frontier extends partway, so it grows rather than blinks.',
'bot.fruit': 'Files as fruit: size, petals, bloom, cluster spread. Petals of three or more turn each berry into a flower.',

// ---------------------------------------------------------------- utility
'scope':     'A rolling plot of whatever passes through it. Passes the value on unchanged.',

// ---------------------------------------------------------------- output
'out':       'Write a value to one of the 37 named destinations. The main way a signal reaches the renderer.',
};
