import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';
import { writeFtm } from '../scripts/ftm-writer.mjs';

const { ENGINE, parseModule, makeDemoModule } = loadCore();
const E = ENGINE();

function render(mod, seconds, solo) {
	const P = new E.Player(structuredClone(mod), 48000);
	if (solo != null) P.muted = P.muted.map((_, i) => i !== solo);
	const rows = [];
	P.onRow = (f, r) => rows.push([f, r]);
	P.start(0, 0);
	const out = new Float32Array(48000 * seconds);
	for (let i = 0; i < out.length; i += 128) P.render(out.subarray(i, i + 128), Math.min(128, out.length - i));
	let sum = 0, nan = 0;
	for (const v of out) { if (Number.isNaN(v)) nan++; sum += v * v; }
	return { rows, rms: Math.sqrt(sum / out.length), nan };
}

test('speed 6 / tempo 150 plays 10 rows a second and loops', () => {
	const r = render(makeDemoModule(E), 14);
	assert.equal(r.nan, 0);
	assert.ok(Math.abs(r.rows.length - 140) <= 2, 'rows: ' + r.rows.length);
	assert.deepEqual(r.rows[128], [0, 0], 'back to frame 0 after 4 frames of 32 rows');
	assert.ok(r.rms > 0.01);
});

test('every channel of the demo is audible on its own', () => {
	for (let c = 0; c < 4; ++c) assert.ok(render(makeDemoModule(E), 4, c).rms > 0.003, 'channel ' + c);
});

test('a written .ftm parses back to the same song', () => {
	const mod = makeDemoModule(E);
	const back = parseModule(writeFtm(mod).buffer, E);
	assert.equal(back.title, mod.title);
	assert.equal(back.tracks[0].rows, 32);
	assert.deepEqual(back.tracks[0].frames, mod.tracks[0].frames);
	assert.equal(back.instruments.filter(Boolean).length, 6);
	const a = render(mod, 6), b = render(back, 6);
	assert.equal(a.rows.length, b.rows.length);
	assert.ok(Math.abs(a.rms - b.rms) < 1e-6, 'identical audio');
});

test('rejects files that are not modules', () => {
	assert.throws(() => parseModule(new TextEncoder().encode('hello').buffer, E), /not a FamiTracker/);
});
