import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

const { ENGINE } = loadCore();
const E = ENGINE();
const CLK = 1789773, SR = 48000;

// 1 second = hz
function hz(run) {
	const out = new Float64Array(SR);
	let frac = 0;
	for (let i = 0; i < SR; ++i) { frac += CLK / SR; const n = Math.floor(frac); frac -= n; out[i] = run(n) / n; }
	const mean = out.reduce((a, b) => a + b) / SR;
	let zc = 0;
	for (let i = 1; i < SR; ++i) if (out[i - 1] - mean < 0 && out[i] - mean >= 0) zc++;
	return zc;
}
const near = (got, want) => assert.ok(Math.abs(got - want) <= 2, `got ${got} Hz, expected ${want.toFixed(1)} Hz`);
const P = 0xFD;

test('2A03 pulse', () => {
	const a = new E.APU2A03(false);
	[[0x4015, 0x0F], [0x4000, 0xBF], [0x4001, 0x08], [0x4002, P & 255], [0x4003, P >> 8]].forEach(([r, v]) => a.write(r, v));
	near(hz(n => { a.run(n); return a.area1; }), CLK / (16 * (P + 1)));
});

test('2A03 triangle', () => {
	const a = new E.APU2A03(false);
	[[0x4015, 0x0F], [0x4008, 0xFF], [0x400A, P & 255], [0x400B, P >> 8]].forEach(([r, v]) => a.write(r, v));
	near(hz(n => { a.run(n); return a.area2; }), CLK / (32 * (P + 1)));
});

test('VRC6 pulse and sawtooth', () => {
	const v = new E.VRC6Chip();
	v.write(0x9000, 0x7F); v.write(0x9001, P & 255); v.write(0x9002, 0x80 | (P >> 8));
	near(hz(n => v.run(n)), CLK / (16 * (P + 1)));
	const s = new E.VRC6Chip();
	s.write(0xB000, 0x2A); s.write(0xB001, P & 255); s.write(0xB002, 0x80 | (P >> 8));
	near(hz(n => s.run(n)), CLK / (14 * (P + 1)));
});

test('MMC5 pulse', () => {
	const m = new E.MMC5Chip();
	m.write(0x5015, 3); m.write(0x5000, 0xBF); m.write(0x5002, P & 255); m.write(0x5003, P >> 8);
	near(hz(n => m.run(n)), CLK / (16 * (P + 1)));
});

test('FDS', () => {
	const F = 0x400, f = new E.FDSChip();
	f.write(0x4089, 0x80); for (let i = 0; i < 64; ++i) f.write(0x4040 + i, i < 32 ? 63 : 0); f.write(0x4089, 0);
	f.write(0x4080, 0xA0); f.write(0x4082, F & 255); f.write(0x4083, F >> 8); f.write(0x4087, 0x80);
	near(hz(n => f.run(n)), CLK * F / 4194304);
});

test('N163', () => {
	const c = new E.N163Chip(), L = 32, F = 0x8000;
	c.write(0xF800, 0x80); for (let i = 0; i < 16; ++i) c.write(0x4800, i < 8 ? 0xFF : 0);
	[[0, F & 255], [2, (F >> 8) & 255], [4, ((256 - L) & 0xFC) | ((F >> 16) & 3)], [6, 0], [7, 0x0F]]
		.forEach(([r, v]) => { c.write(0xF800, 0x78 + r); c.write(0x4800, v); });
	near(hz(n => c.run(n)), CLK * F / (15 * 65536 * L));
});

test('Sunsoft 5B', () => {
	const s = new E.S5BChip(), SP = 0x100;
	[[0, SP & 255], [1, SP >> 8], [7, 0x3E], [8, 0x0F]].forEach(([r, v]) => { s.write(0xC000, r); s.write(0xE000, v); });
	near(hz(n => s.run(n)), CLK / (32 * SP));
});

test('VRC7 (pure sine custom patch)', () => {
	const v = new E.VRC7Chip(SR), w = (r, x) => { v.write(0x9010, r); v.write(0x9030, x); };
	[0x21, 0x21, 0x3F, 0x00, 0xF0, 0xF0, 0x0F, 0x0F].forEach((x, i) => w(i, x));
	w(0x30, 0x00); w(0x10, 172); w(0x20, 0x10 | (4 << 1));
	const out = new Float64Array(SR);
	for (let i = 0; i < SR; ++i) out[i] = v.sample();
	const mean = out.reduce((a, b) => a + b) / SR;
	let zc = 0;
	for (let i = SR / 2; i < SR; ++i) if (out[i - 1] - mean < 0 && out[i] - mean >= 0) zc++;
	near(zc * 2, 49716 * 172 * 16 / 524288);
});
