import re, sys
d = '/tmp/claude-0/-home-claude/05e639a8-342c-5746-b882-f69416fa1f32/scratchpad/lab/'
t = open(d + 'template.html').read()
for key, f in (('DSP', 'dsp.js'), ('CORE', 'core.js'), ('UI', 'ui.js')):
    js = open(d + f).read()
    assert '</script' not in js
    t = t.replace('/*%s*/' % key, js)
open(d + 'scanimate_lab.html', 'w').write(t)
print('built', len(t) // 1024, 'KB')
