// opguide.js — the plain-language guide, one entry per operator.
//
// OPDOCS (next door) is the reference line: precise, written for someone who
// already knows what the block is. This is the other thing entirely. Every
// entry answers two questions and nothing else:
//
//   what — what the block IS, in words that assume no signal processing
//   use  — ONE concrete example of it being useful, with real things in it
//
// The rule for `use`: no block may be explained with another block's name, and
// no entry may say "signal", "parameter" or "value" where a real noun would
// do. If an example cannot be written without jargon, the explanation is not
// finished yet.
//
// Shown as a hover card in the palette, so it is read in two seconds, standing
// up, while looking for something else.

export const OPGUIDE = {

// ---------------------------------------------------- read: seeing the screen
'read.elements': {
  what: 'Asks macOS what is actually on screen — every button, label and line of text, with its real position and the words it contains.',
  use:  'This is the only way an effect can know that something IS a word rather than a patch of colour. Use it when you want letters to stay readable while they move.' },
'read.grid': {
  what: 'Chops the screen into equal tiles, like graph paper laid over it, and measures the brightness, colour and busyness of each one.',
  use:  'Nothing needs to understand your screen for this to work — it is just pixels. A 30×19 grid gives you 570 pieces you can move independently, which is how the screen appears to melt.' },
'read.regions': {
  what: 'Finds patches of the screen that look alike and groups them into blobs, so a toolbar comes back as one shape rather than forty tiles.',
  use:  'Better than a grid when you want whole things to move together — a window, a sidebar, a block of text — instead of cutting straight through the middle of them.' },

// ------------------------------------------------- pick: choosing what to hit
'pick.all': {
  what: 'Chooses everything that was found. No filtering at all.',
  use:  'Start here. Wire it into an effect to see the effect on the whole screen, then swap it for something fussier once you know what the effect looks like.' },
'pick.element': {
  what: 'Chooses one exact thing, filled in by clicking it in the inspector panel on the right.',
  use:  'For when you mean THAT button and nothing else — your menu bar clock, one heading, a single filename.' },
'pick.under': {
  what: 'Chooses everything inside one container — a whole window, a whole toolbar, a whole sidebar.',
  use:  'The easiest way to scope an effect to one app. Click a window in the inspector and only that window is touched; everything else stays normal.' },
'pick.role': {
  what: 'Chooses by what kind of control something is: every button, or every text field, or every menu item.',
  use:  '"Make every button in every app breathe" is one block. It keeps working as you open new apps, because it describes a kind of thing rather than a list.' },
'pick.app': {
  what: 'Chooses everything belonging to one application, by name.',
  use:  'Leave your editor alone and let the rest of the desktop misbehave — or the exact opposite.' },
'pick.class': {
  what: 'Chooses by what the text IS, worked out from the text itself: a number, a date, a file path, a web address, a real sentence.',
  use:  '"Every number on screen, wherever it is" — prices, timestamps, file sizes, line numbers — without naming a single app.' },
'pick.kind': {
  what: 'Chooses by the part a thing plays: menu, title, body text, a filename, a label.',
  use:  'Let body text sit still and perfectly readable while only titles and filenames move. The page stays usable and still feels alive.' },
'pick.range': {
  what: 'Chooses by a measurement, between two numbers you set — how bright, how colourful, how busy, how long, how deeply buried.',
  use:  '"Only the bright parts" or "only the busy parts" turns an effect into something that follows the content of your screen instead of landing evenly on all of it.' },
'pick.combine': {
  what: 'Joins two choices into one: both must be true, or either will do, or the first but not the second.',
  use:  '"The filenames in Finder, but not the ones in the sidebar." Neither half can say that alone; together they can.' },
'pick.shape': {
  what: 'Chooses whatever falls inside a shape you have drawn — a circle, a star, a ring, or any combination of them.',
  use:  'A spotlight. Put a circle in the middle of the screen and only what is inside it is affected, so the edges of your screen stay calm and usable.' },
'pick.invert': {
  what: 'Flips a choice: everything that was NOT chosen.',
  use:  'Pair it with a circle to get the opposite of a spotlight — the middle stays readable and everything around it comes apart.' },

// ------------------------------------------------------------------- sources
'channel': {
  what: 'A live number from your own machine: processor load, memory pressure, network traffic, disk activity.',
  use:  'This is what makes the screen respond to what the computer is DOING. Wire processor load into a wave and your desktop visibly works harder when you compile something.' },
'const': {
  what: 'A fixed number you type in. It never changes.',
  use:  'The plainest way to set something and leave it. Most of the big dials in a preset are a Constant wired to an Output.' },
'time': {
  what: 'Seconds since the render started, counting up forever.',
  use:  'For anything that should drift in one direction and never come back — a slow rotation, a colour creeping round the wheel over an hour.' },

// ----------------------------------------------------------- math & shaping
'scale': {
  what: 'Multiplies a number, then adds to it. The two oldest knobs there are.',
  use:  'Processor load arrives as 0–100 but almost everything expects 0–1. Multiply by 0.01 and it fits.' },
'curve': {
  what: 'A curve you draw by hand with the mouse, which bends incoming numbers into a different shape.',
  use:  'When an effect feels dead at the bottom and frantic at the top, draw a curve that spends more room where you actually live — most of the day at 10% load, occasionally at 90%.' },
'norm': {
  what: 'Watches a number for a while, learns its usual range, and stretches it to fill 0–1.',
  use:  'You do not know what counts as "a lot" of network traffic on your machine. This finds out by watching, so the effect is dramatic on a quiet laptop and a busy server alike.' },
'clamp': {
  what: 'Refuses to let a number leave a range you set.',
  use:  'A safety rail. Stop one enormous spike from throwing every letter off the screen and leaving you with nothing to read.' },
'remap': {
  what: 'Says "this range in, that range out" — 0 to 1 becomes 1.2 to 7, and everything between is scaled to match.',
  use:  'The usual translator between a measurement and an effect. "When load goes 0 to 1, let the wave grow from barely visible to enormous."' },
'abs': {
  what: 'Throws away the minus sign. −3 and 3 both come out as 3.',
  use:  'When you care how far something moved but not which way — turning a wave that goes up and down into a pulse that only goes up.' },
'invert': {
  what: 'Turns a number upside down inside its range: high becomes low, low becomes high.',
  use:  'Make the screen go CALM as the machine gets busy, instead of wilder. Often more interesting than the obvious direction.' },

// ------------------------------------------------------------------ combine
'math2': {
  what: 'Takes two numbers and does arithmetic on them: add, subtract, multiply, divide, smallest, largest.',
  use:  '"Whichever is higher, processor load or memory pressure" gives you one dial for how stressed the machine is, from two different measures.' },
'mix': {
  what: 'Blends between two numbers, with a third deciding how much of each.',
  use:  'Crossfade between a calm setting and a wild one, and put a slow wave on the blend so the screen drifts between the two moods by itself.' },

// --------------------------------------------------- filters & envelopes
'lowpass': {
  what: 'Smooths a jumpy number so it glides instead of jerking. The simplest smoother there is — a one-pole filter.',
  use:  'Processor load jitters violently several times a second. Fed straight into a size effect the letters buzz and are unreadable. Put this in between and the same information arrives as slow breathing. Lower cutoff = smoother and more sluggish; higher = quicker and twitchier.' },
'oneeuro': {
  what: 'A cleverer smoother that works out how fast things are changing and adapts: still when you are still, instantly responsive when you move.',
  use:  'Ordinary smoothing forces a choice between lag and jitter. This one does not — use it on anything that follows your mouse or your hands, where both a wobbly cursor and a late cursor feel wrong.' },
'envelope': {
  what: 'Rises quickly when something happens and falls away slowly afterwards, like a note on a piano.',
  use:  'Turn a one-off event into something you can actually see. A disk write lasts eight milliseconds; this stretches it into a two-second glow.' },
'slew': {
  what: 'Caps how fast a number is allowed to change, no matter how violently the input jumps.',
  use:  'Guarantees nothing on screen ever moves faster than you can follow — a hard ceiling on chaos rather than a gentle smoothing.' },
'peakhold': {
  what: 'Remembers the highest value it has seen and lets it sink back down slowly.',
  use:  'The bouncing peak marker on a stereo level meter. Good for showing "the worst it has been lately" rather than only right now.' },

// ---------------------------------------------------------------------- dsp
'autocorr': {
  what: 'Compares a stream of numbers with its own recent past to find out whether it repeats, and how often.',
  use:  'Your machine has rhythms you cannot see — a backup every ten seconds, a poll every two. This finds the beat so the screen can pulse in time with your computer instead of in time with a clock.' },
'spectrum': {
  what: 'Splits a changing number into slow, medium and fast parts, and reports how much of each is present.',
  use:  'Separates "the machine is gradually heating up all afternoon" from "something is flickering ten times a second", so you can drive different effects from each.' },
'bandresynth': {
  what: 'Takes the spectrum apart, lets you turn individual speeds up or down, and puts it back together.',
  use:  'Keep only the fast flicker of your machine and throw away the slow drift, or the other way round — a way of choosing which TEMPO of activity the screen reacts to.' },
'convolve': {
  what: 'Slides a short shape along a stream of numbers, blending as it goes.',
  use:  'The general form of smoothing and sharpening. The shape you slide decides what it does, which is why the shape can be one you drew.' },
'xcorr': {
  what: 'Slides two streams past each other to find the lag at which they best agree.',
  use:  'Answers "does disk activity cause the processor spike, and how long after?" — and the answer is a number you can use.' },

// --------------------------------------------------- drawing as computation
'draw.transfer': {
  what: 'You draw a line; incoming numbers are bent to follow it.',
  use:  'Gain, compression and gating are all just different drawn lines. Draw the shape you want instead of looking up which block does it.' },
'draw.kernel': {
  what: 'You draw a short shape, and it becomes a filter — smoothing, sharpening or echoing depending on what you drew.',
  use:  'Draw a hump and it smooths. Draw a spike with a dip beside it and it sharpens. The picture and the behaviour are the same object.' },
'draw.mask': {
  what: 'You draw a curve across a range of speeds, and it decides which are kept and which are removed.',
  use:  'Drawing the shape of a filter is far more direct than typing cutoff frequencies — you can see what you are keeping.' },

// ------------------------------------------------------ reaction-diffusion
'rd.regime': {
  what: 'Picks a recipe for the chemistry simulation — coral, mitosis, worms, solitons, waves — and can slide between two of them.',
  use:  'The two numbers that control the chemistry are ferociously touchy; a tiny nudge turns a living pattern into a dead screen. This hands you named recipes that are known to work, and a safe path between them.' },

// -------------------------------------------------------------------- logic
'threshold': {
  what: 'Answers yes or no: is this number above the line you set?',
  use:  'Do nothing at all until the machine is genuinely busy, then let the whole screen change at once.' },
'gate': {
  what: 'Lets a number through only while a second number says it may.',
  use:  'Run an effect only while you are on battery, or only at night, or only when a build is running.' },
'select': {
  what: 'Chooses between several numbers, picking by index.',
  use:  'A preset switcher inside a patch: one dial steps through four different moods.' },
'compare': {
  what: 'Compares two numbers and reports whether the test holds.',
  use:  '"Is memory pressure higher than processor load?" — one question that tells you what KIND of busy your machine is.' },

// --------------------------------------------------------------- generators
'lfo': {
  what: 'A slow, steady wave that goes round and round forever — sine, triangle, sawtooth or square.',
  use:  'The engine of anything that breathes. Nothing has to happen on your computer for an LFO to keep the screen alive.' },
'pink': {
  what: 'Natural-sounding randomness, which wanders rather than twitching.',
  use:  'Pure random noise looks mechanical and wrong. This is the texture of flickering candlelight or wind — use it when you want motion that feels organic rather than computed.' },
'gen.ramp': {
  what: 'You draw a shape; it plays that shape back as a one-off whenever something sets it off.',
  use:  'Draw exactly how a flourish should rise and fall, then fire it every time you open an app.' },
'gen.sh': {
  what: 'Grabs the current value at moments you choose and holds it steady until the next one.',
  use:  'Turns smooth motion into steps. Letters that jump to a new size and hold, rather than sliding, which reads as deliberate rather than wobbly.' },
'gen.seq': {
  what: 'A list of values played in order, one per step.',
  use:  'A pattern you have written out by hand, so the screen does the same recognisable phrase every time round.' },

// --------------------------------------------------------------- shapes
'sdf.circle': { what: 'A circle, described as "how far is any point from the edge of this circle" rather than as a drawing.',
  use:  'Because it is a measurement, it can be bent, repeated and combined with other shapes before anything is ever drawn.' },
'sdf.box':    { what: 'A rectangle, with optionally rounded corners.', use: 'Window shapes, panels, bars — anything that should feel architectural rather than organic.' },
'sdf.ngon':   { what: 'A regular polygon with however many sides you ask for.', use: 'Hexagons tile a plane perfectly; triangles feel sharp. The number of sides changes the whole mood.' },
'sdf.star':   { what: 'A star, with control over how many points and how deep they cut.', use: 'Pull the points shallow and it becomes a flower; push them deep and it becomes a spark.' },
'sdf.ring':   { what: 'A circle with its middle removed — an annulus.', use: 'Haloes, dials, orbits. Also the base of anything that should surround something else rather than cover it.' },
'sdf.seg':    { what: 'A thick line between two points, with rounded ends.', use: 'The building block of anything drawn with strokes — branches, wires, handwriting.' },
'sdf.arc':    { what: 'A piece of a circle, with thickness.', use: 'Progress dials, speedometer sweeps, the curve of a wave crest.' },
'sdf.curve':  { what: 'A shape whose outline is a curve you drew by hand.', use: 'For when the form you want is in your head and your hand, not in a formula.' },

// --------------------------------------------------------- shape transformers
'sh.move':    { what: 'Slides a shape somewhere else.', use: 'Wire a wave into it and the shape travels instead of sitting still.' },
'sh.rotate':  { what: 'Turns a shape about its centre.', use: 'Rotation driven by processor load makes a dial that genuinely reads your machine.' },
'sh.scale':   { what: 'Makes a shape bigger or smaller, evenly or on one axis.', use: 'Scaling on one axis only is how a circle becomes a lens and a square becomes a bar.' },
'sh.skew':    { what: 'Pushes a shape sideways so its uprights lean.', use: 'The cheapest way to suggest speed or perspective without actually tilting anything in 3D.' },
'sh.squeeze': { what: 'Pinches a shape in one direction while letting it swell in the other.', use: 'Gives rigid shapes a sense of weight and softness — the squash of something landing.' },
'sh.repeat':  { what: 'Tiles a shape across space, endlessly, from a single copy.', use: 'One circle becomes a field of a thousand, at no extra cost, because nothing is ever actually copied.' },
'sh.mirror':  { what: 'Reflects a shape about an axis.', use: 'Instant symmetry. Draw half of something and let the mirror do the rest.' },
'sh.polar':   { what: 'Wraps a shape around a centre and repeats it in a fan.', use: 'This is what makes a kaleidoscope. One wedge becomes a complete rosette.' },
'sh.twist':   { what: 'Rotates a shape more the further out you go, so it winds up.', use: 'Turns straight bars into a vortex and a square into something that looks poured.' },
'sh.round':   { what: 'Inflates a shape outwards, softening every corner at once.', use: 'A single dial from "sharp and technical" to "soft and biological".' },
'sh.onion':   { what: 'Hollows a shape into a shell of even thickness.', use: 'Turns any solid into an outline, so you get the contour of something complicated for free.' },

// ------------------------------------------------------------ shape combine
'sh.union':   { what: 'Both shapes, welded into one.', use: 'Build complicated things from simple ones — a body, a head, two arms.' },
'sh.sub':     { what: 'The first shape with the second one cut out of it.', use: 'Windows in a wall, a bite out of a disc, the hole in a letter.' },
'sh.inter':   { what: 'Only the part where both shapes overlap.', use: 'Two overlapping circles make a lens; a circle and a box make a precise cap.' },
'sh.blend':   { what: 'Joins two shapes with a smooth fillet instead of a hard seam.', use: 'This is what makes separate blobs look like one living thing rather than two stuck together.' },
'sh.morph':   { what: 'Slides continuously from one shape into another.', use: 'A square that becomes a star over four seconds, passing through forms neither of them has.' },

// ------------------------------------------------------------- shape render
'sh.fill':    { what: 'Paints the inside of a shape solid.', use: 'The straightforward way to make a shape visible.' },
'sh.contour': { what: 'Draws lines at even distances from a shape’s edge, like a map’s height lines.', use: 'Shows the invisible field around a shape, which is often more beautiful than the shape itself.' },

// ---------------------------------------------------------------- colourisers
'col.keyer': {
  what: 'Sorts the picture into bands by brightness and gives each band its own colour and opacity.',
  use:  'This is how a thermal camera works. Hard bands separate your screen into zones instead of a smooth wash.' },
'col.ramp': {
  what: 'Maps brightness onto a gradient: dark pixels take the first colour, bright ones the last, everything else blends between.',
  use:  'The quickest way to change the entire mood. The same effect in deep blue and in hot magenta feels like two different pieces of software.' },

// --------------------------------------------------- image: the picture itself
'img.source': {
  what: 'The picture the chain starts from — whatever you are looking at, handed over as something you can wire.',
  use:  'Split it two ways and treat the halves differently: one sharp, one blurred, blended back together. That is a glow, and it is three blocks.' },
'img.scan': {
  what: 'Pushes every row of the picture sideways by how bright it is, so a flat image stands up into a relief.',
  use:  'This is the look of 1970s analogue video synthesis. A bright window becomes a ridge; dark areas stay put.' },
'img.feedback': {
  what: 'Draws each frame on top of the last one, slightly bigger and slightly turned.',
  use:  'Where trails come from. At 0.94 movement smears; above 0.99 nothing ever fades and your cursor paints permanent light.' },
'img.rd': {
  what: 'A chemistry simulation — two substances, one eating the other — seeded by your picture.',
  use:  'Your screen dissolves into coral, worms or drifting blobs. The regime block next door picks a recipe that is known to work, because the usable numbers are a very narrow band.' },
'img.blur': {
  what: 'Softens the picture.',
  use:  'Rarely the point on its own. Blur a copy, blend it back over the sharp one, and you have a bloom around everything bright.' },
'img.levels': {
  what: 'Brightness, contrast, gamma and a black floor.',
  use:  'The floor is the one that matters: lifting it off zero leaves a faint haze over the whole screen, and dropping it to zero is the difference between murky and clean.' },
'img.colour': {
  what: 'Repaints the picture through a gradient or a set of colour bands.',
  use:  'The quickest way to change the entire mood. The same effect in deep blue and in hot magenta reads as two different pieces of software.' },
'img.blend': {
  what: 'Combines two pictures — mix, add, multiply, screen or difference.',
  use:  'This is what makes the image chain a graph instead of a line. Difference between a frame and its blurred self is an edge detector you built from two blocks.' },
'img.out': {
  what: 'The end of an image chain. Everything before it is a description; this is what puts it on screen.',
  use:  'Its mix dial does for your chain what chain.mix does for the built-in one: at 0.4 the real desktop shows through underneath and text stays readable.' },

// ----------------------------------------------------------------- typography
'txt.wave': {
  what: 'Makes letters ride a wave, bobbing up and down or side to side.',
  use:  'The friendliest effect there is. Start the wave at each word and the words bob in sequence like a line of ducks.' },
'txt.jitter': {
  what: 'Shakes letters by a small random amount.',
  use:  'A little makes text feel nervous or alive; a lot makes it feel like the screen is failing. Both are useful, for different reasons.' },
'txt.rotate': { what: 'Turns each letter about its own centre.', use: 'Rotation that builds along a word makes it bend like a banner in wind.' },
'txt.scale': {
  what: 'Grows and shrinks letters, with a floor in real pixels below which they are never allowed to go.',
  use:  'This is the one that answers "extravagantly big and small, but still readable". The floor is in pixels rather than a percentage, because 30% of an 11pt label and 30% of a 28pt heading are not the same problem.' },
'txt.axes': {
  what: 'Uses a font’s own built-in dials — weight, width, slant — instead of distorting the letters.',
  use:  'Text thickens as your machine works, and it stays genuinely well-drawn, because the typeface designer drew every weight in between.' },
'txt.spacing': { what: 'Opens or closes the gaps between letters and between lines.', use: 'Spacing that grows along a line makes reading feel like it is slowing down.' },
'txt.baseline': { what: 'Lifts and drops letters along a line you drew.', use: 'Text follows a hill you sketched, so one line of a paragraph rises as you read it.' },
'txt.scatter': { what: 'Throws letters off their line, each a different way.', use: 'Pushed hard, a page falls apart into confetti while remaining, just barely, a page.' },
'txt.colour': { what: 'Shifts the colour and transparency of letters.', use: 'Colour that changes across a word is more legible than colour that changes between words.' },
'txt.cascade': {
  what: 'Delays an effect slightly more for each letter, so the change sweeps across the screen instead of hitting everywhere at once.',
  use:  'The difference between an effect that ARRIVES and one that merely happens. Put it above the others — the delay only affects what comes after it.' },

// -------------------------------------------------------- layout & orientation
'lay.move':    { what: 'Slides whole windows, panels or tiles around.', use: 'Where typography moves letters, this moves the things letters sit in.' },
'lay.rotate':  { what: 'Turns whole windows or tiles about their centres.', use: 'Rotation set by each tile’s position shatters the screen into a spin rather than turning it as one slab.' },
'lay.scale':   { what: 'Grows and shrinks whole windows or tiles.', use: 'Tiles that pulse at slightly different times make the screen breathe like a lung rather than a balloon.' },
'lay.tilt':    { what: 'Leans windows over, as if seen at an angle.', use: 'A cheap, convincing suggestion of depth on a flat screen.' },
'lay.spiral':  { what: 'Pushes everything along a spiral around a centre point, optionally pulling it inwards too.', use: 'The single most effective way to make a screen look like it is being sucked down a drain.' },
'lay.ring':    { what: 'Rearranges a grid of tiles onto a circle.', use: 'Blend it in slowly and a rectangular desktop gathers itself into a ring in front of you.' },
'lay.drift':   { what: 'Gives every tile its own small, fixed random offset and turn.', use: 'The look of a pile of photographs on a table — ordered, but not machined.' },
'lay.gravity': { what: 'Pulls everything toward a point, or pushes it away.', use: 'One dial from "normal screen" to "everything is falling into the middle". Reverse it and the screen flees the centre.' },

// ------------------------------------------------------------------ botanical
'bot.tree':   { what: 'Builds a tree whose branches are your folders and whose fruit are your files.', use: 'A directory you can see the shape of. Deep nesting becomes a tall tree; a flat dump becomes a bush.' },
'bot.grow':   { what: 'Controls how the tree grows — branch length, angle, how much thinner each generation gets.', use: 'The same folders can look like a willow or a pine. The rule changes; the data does not.' },
'bot.fruit':  { what: 'Decides how files appear on the branches — size, colour, ripeness.', use: 'Large files hang heavy, old ones go brown. You can read your disk at a glance without a single number.' },

// -------------------------------------------------------------------- utility
'scope': {
  what: 'Draws a little graph of a number over the last few seconds, right on the block.',
  use:  'When an effect is not doing what you expected, put this in the wire and LOOK. Usually the number is flat, or enormous, and you can see which immediately.' },

// --------------------------------------------------------------------- output
'out': {
  what: 'Sends a number to one of the renderer’s dials — how colourful, how smeared, how much feedback, how much of the effect to apply at all.',
  use:  'Nothing reaches the picture without passing through here. The most important destination is chain.mix: at 0 your screen is completely normal, at 1 it is completely transformed, and anywhere between crossfades the untouched screen back underneath — which is how you keep text readable while the effect runs.' },

};
