const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('file://' + path.resolve('scanimate_lab.html'));
  await page.waitForTimeout(2500);
  let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const lit = () => page.evaluate(() => { const c = document.getElementById('out'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, nz = 0; for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; s += v; if (v > 120) nz++; } return { s, nz }; });
  const a = await lit(); ok(a.nz > 300, 'default patch draws something (' + a.nz + ' bright px)');
  await page.waitForTimeout(700); const b = await lit(); ok(b.s !== a.s, 'picture changes over time');
  await page.screenshot({ path: 'shot_default.png' });

  // rack: add every op via the selects without errors
  const nBefore = await page.evaluate(() => Object.keys(LAB.graph.nodes).length);
  for (const [i, ops] of [[0, ['noise', 'curve', 'spec', 'smooth', 'math']], [1, ['polygon', 'lissa', 'spiral', 'blob', 'grid']], [2, ['move', 'scale', 'mirror', 'twist', 'morph']], [3, ['gradient']]]) {
    for (const op of ops) { await page.locator('.addbar select').nth(i).selectOption(op); }
  }
  await page.waitForTimeout(500);
  const nAfter = await page.evaluate(() => Object.keys(LAB.graph.nodes).length); ok(nAfter === nBefore + 16, 'added 16 modules from the menus: ' + nBefore + ' -> ' + nAfter);

  // wire: connect lfo1 to scale via the select UI (rotate1.deg already). Choose source in the first select of a card.
  await page.evaluate(() => LAB.openTab('curve'));
  // curve: drag-draw a ramp
  const curveId = await page.evaluate(() => document.getElementById('cvSel').value); ok(!!curveId, 'curve studio has a module selected: ' + curveId);
  await page.locator('#cv').scrollIntoViewIfNeeded(); const box = await page.locator('#cv').boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height * 0.9); await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + 10 + (box.width - 20) * i / 20, box.y + box.height * (0.9 - 0.8 * i / 20));
  await page.mouse.up();
  const cvals = await page.evaluate((id) => Array.from(LAB.graph.nodes[id].curve), curveId);
  ok(cvals[5] < 0.2 && cvals[250] > 0.8 && cvals[128] > 0.4 && cvals[128] < 0.6, `drawn ramp stored: start ${cvals[5].toFixed(2)}, middle ${cvals[128].toFixed(2)}, end ${cvals[250].toFixed(2)}`);
  await page.screenshot({ path: 'shot_curve.png' });

  // spec studio: paint, play
  await page.evaluate(() => LAB.openTab('spec')); await page.waitForTimeout(200);
  const sid = await page.evaluate(() => document.getElementById('sgSel').value); ok(!!sid, 'spectrogram module selected: ' + sid);
  await page.evaluate((id) => LAB.graph.nodes[id].grid.fill(0), sid);
  await page.locator('#sg').scrollIntoViewIfNeeded(); const sb = await page.locator('#sg').boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height * 0.7); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 0.7, sb.y + sb.height * 0.3, { steps: 12 }); await page.mouse.up();
  const painted = await page.evaluate((id) => { const g = LAB.graph.nodes[id].grid; let n = 0; for (const v of g) if (v > 0) n++; return n; }, sid); ok(painted > 100, 'painting set ' + painted + ' cells');
  await page.click('#sgPlay'); await page.waitForTimeout(600);
  const playing = await page.evaluate(() => document.getElementById('sgPlay').textContent); ok(playing === 'Stop sound', 'Play started: button says "' + playing + '"');
  await page.screenshot({ path: 'shot_spec.png' }); await page.click('#sgPlay');
  // eraser
  await page.check('#sgErase'); await page.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height * 0.7); await page.mouse.down(); await page.mouse.move(sb.x + sb.width * 0.7, sb.y + sb.height * 0.3, { steps: 12 }); await page.mouse.up(); await page.uncheck('#sgErase');
  const after = await page.evaluate((id) => { const g = LAB.graph.nodes[id].grid; let n = 0; for (const v of g) if (v > 30) n++; return n; }, sid); ok(after < painted * 0.3, 'eraser removed most paint: ' + painted + ' -> ' + after + ' cells above 30');

  // mask studio
  await page.evaluate(() => LAB.openTab('mask')); await page.waitForTimeout(400);
  const before = await lit();
  await page.selectOption('#mkOn', 'on'); await page.click('[data-mk=low]'); await page.waitForTimeout(800);
  const lp = await lit(); ok(lp.s !== before.s, 'turning mask on with low-pass changes the picture');
  await page.screenshot({ path: 'shot_mask.png' });
  const mm = await page.evaluate(() => { const m = LAB.graph.nodes.mask.mask; let k = 0, z = 0; for (const v of m) { if (v > 0.5) k++; else z++; } return [k, z]; }); ok(mm[0] > 500 && mm[1] > 5000, 'low-pass mask keeps ' + mm[0] + ' bins, removes ' + mm[1]);
  const enLP = await page.evaluate(() => LAB.ctx.outs.mask.energy); ok(enLP > 0.01, 'low-pass gives non-zero mask energy signal: ' + enLP.toFixed(3)); await page.locator('#mk').scrollIntoViewIfNeeded(); const mb = await page.locator('#mk').boundingBox();
  await page.click('[data-mk=all]'); await page.mouse.move(mb.x + mb.width * 0.3, mb.y + mb.height * 0.3); await page.mouse.down(); await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5, { steps: 8 }); await page.mouse.up();
  const painted2 = await page.evaluate(() => { const m = LAB.graph.nodes.mask.mask; let z = 0; for (const v of m) if (v < 0.5) z++; return z; }); ok(painted2 > 100, 'brush removed ' + painted2 + ' bins from the mask');
  const en = await page.evaluate(() => LAB.ctx.outs.mask && LAB.ctx.outs.mask.energy); ok(typeof en === 'number', 'mask energy output exists: ' + (en && en.toFixed(3)));
  await page.selectOption('#mkOn', 'off');

  // paint program
  await page.evaluate(() => LAB.openTab('paint')); await page.click('#pgExample'); await page.click('#pgCompile'); await page.waitForTimeout(600);
  const rep = await page.textContent('#report'); console.log(rep);
  const names = await page.evaluate(() => Object.keys(LAB.graph.nodes).sort().join(',')); ok(names === 'lfo1,mask,palette1,render,rotate1,star1,tele1,warp1'.split(',').sort().join(','), 'compiled graph has the painted modules: ' + names);
  const l2 = await lit(); ok(l2.nz > 100, 'compiled program draws (' + l2.nz + ' bright px)');
  await page.screenshot({ path: 'shot_paint.png' });
  await page.click('#pgUndo'); const names2 = await page.evaluate(() => Object.keys(LAB.graph.nodes).length); ok(names2 === nAfter, 'undo compile restores the rack (' + names2 + ' modules)');
  // paint by mouse on a fresh canvas
  await page.click('#pgClear'); await page.locator('#pg').scrollIntoViewIfNeeded(); const pb = await page.locator('#pg').boundingBox();
  await page.click('#pgSw button:nth-child(4)'); await page.mouse.move(pb.x + 40, pb.y + 40); await page.mouse.down(); await page.mouse.move(pb.x + 100, pb.y + 40, { steps: 5 }); await page.mouse.up();
  const painted3 = await page.evaluate(() => Array.from(LAB.cells).filter((v) => v === 4).length); ok(painted3 >= 2, 'mouse painting puts cells on the program grid: ' + painted3);

  // export / import round trip + reset
  const json = await page.evaluate(() => LAB.CORE.serialize(LAB.graph)); ok(json.length > 1000, 'export JSON ' + (json.length / 1024).toFixed(0) + ' KB');
  await page.click('#bReset'); await page.waitForTimeout(300); const nr = await page.evaluate(() => Object.keys(LAB.graph.nodes).length); ok(nr === 11, 'reset gives default graph (' + nr + ' modules)');
  await page.click('#bPause'); const t1 = await page.evaluate(() => LAB.stats().t); await page.waitForTimeout(400); const t2 = await page.evaluate(() => LAB.stats().t); ok(t1 === t2, 'pause freezes time'); await page.click('#bPause');
  // fps
  const fps = await page.evaluate(() => new Promise((res) => { const t0 = LAB.stats().t; setTimeout(() => res((LAB.stats().t - t0)), 2000); }));
  console.log('simulated seconds in 2 real seconds (headless software rendering):', fps.toFixed(2));
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
