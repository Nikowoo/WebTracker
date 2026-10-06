const LENGTH_TABLE = [10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30];
const DUTY_TABLE = [[0, 1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0, 0], [1, 0, 0, 1, 1, 1, 1, 1]];
const TRI_TABLE = []; for (let i = 0; i < 32; ++i) TRI_TABLE.push(i < 16 ? 15 - i : i - 16);
const NOISE_NTSC = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const NOISE_PAL = [4, 8, 14, 30, 60, 88, 118, 148, 188, 236, 354, 472, 708, 944, 1890, 3778];
const DMC_NTSC = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];
const DMC_PAL = [398, 354, 316, 298, 276, 236, 210, 198, 176, 148, 132, 118, 98, 78, 66, 50];
const INF = 0x7FFFFFFF;

// nonlinear mix like nsfplay  dnft is 10000 as full scale
const SQUARE_TABLE = new Float32Array(32);
for (let i = 1; i < 32; ++i) SQUARE_TABLE[i] = (8192.0 * 95.88) / (8128.0 / i + 100) / 10000;
const TND_TABLE = new Float32Array(16 * 16 * 128);
for (let t = 0; t < 16; ++t) for (let n = 0; n < 16; ++n) for (let d = 0; d < 128; ++d) {
	const s = t / 8227 + n / 12241 + d / 22638;
	TND_TABLE[(t * 16 + n) * 128 + d] = s ? 8192 * 159.79 / (1 / s + 100) / 10000 : 0;
}

class Envelope {
	constructor() { this.start = false; this.div = 0; this.decay = 0; this.loop = false; this.constant = false; this.vol = 0; }
	clock() {
		if (this.start) { this.start = false; this.decay = 15; this.div = this.vol; }
		else if (this.div === 0) {
			this.div = this.vol;
			if (this.decay > 0) --this.decay; else if (this.loop) this.decay = 15;
		}
		else --this.div;
	}
	out() { return this.constant ? this.vol : this.decay; }
}

class PulseUnit {
	constructor(ones) {
		this.ones = ones; this.env = new Envelope(); this.duty = 0; this.period = 0; this.step = 0; this.ctr = 2;
		this.len = 0; this.enabled = false;
		this.swEn = false; this.swPer = 0; this.swNeg = false; this.swShift = 0; this.swReload = false; this.swDiv = 0;
		this.hasSweep = true;
	}
	target() {
		const c = this.period >> this.swShift;
		return this.swNeg ? this.period - c - (this.ones ? 1 : 0) : this.period + c;
	}
	muted() { return this.hasSweep && (this.period < 8 || (!this.swNeg && this.target() > 0x7FF)); }
	out() {
		if (this.len === 0 || this.muted() || !DUTY_TABLE[this.duty][this.step]) return 0;
		return this.env.out();
	}
	write(r, v) {
		switch (r) {
			case 0: this.duty = v >> 6; this.env.loop = !!(v & 0x20); this.env.constant = !!(v & 0x10); this.env.vol = v & 15; break;
			case 1: this.swEn = !!(v & 0x80); this.swPer = (v >> 4) & 7; this.swNeg = !!(v & 8); this.swShift = v & 7; this.swReload = true; break;
			case 2: this.period = (this.period & 0x700) | v; break;
			case 3:
				this.period = (this.period & 0xFF) | ((v & 7) << 8);
				if (this.enabled) this.len = LENGTH_TABLE[v >> 3];
				this.step = 0; this.env.start = true; break;
		}
	}
	clockLength() { if (!this.env.loop && this.len > 0) --this.len; }
	clockSweep() {
		if (this.swDiv === 0 && this.swEn && this.swShift > 0 && !this.muted()) this.period = this.target() & 0x7FF;
		if (this.swDiv === 0 || this.swReload) { this.swDiv = this.swPer; this.swReload = false; }
		else --this.swDiv;
	}
}

class APU2A03 {
	constructor(pal) {
		this.pal = pal;
		this.noiseTable = pal ? NOISE_PAL : NOISE_NTSC;
		this.dmcTable = pal ? DMC_PAL : DMC_NTSC;
		this.fsPeriod = Math.round((pal ? CLK_PAL : CLK_NTSC) / 240);
		this.sampleMem = new Uint8Array(0);
		this.reset();
	}
	reset() {
		this.p = [new PulseUnit(true), new PulseUnit(false)];
		this.tri = { period: 0, ctr: 1, step: 0, len: 0, lin: 0, linReload: 0, linFlag: false, control: false, enabled: false };
		this.noi = { env: new Envelope(), mode: false, period: 4, ctr: 4, lfsr: 1, len: 0, enabled: false };
		this.dmc = {
			rate: 428, ctr: 428, loop: false, start: 0, length: 1, addr: 0, remain: 0, buffer: -1,
			shift: 0, bits: 8, silence: true, out: 0,
		};
		this.dmc.rate = this.dmcTable[0];
		this.fsCtr = this.fsPeriod; this.fsStep = 0; this.fsMode5 = false;
	}
	writeSample(data) { this.sampleMem = data; }
	write(a, v) {
		if (a < 0x4008) { this.p[(a >> 2) & 1].write(a & 3, v); return; }
		const t = this.tri, n = this.noi, d = this.dmc;
		switch (a) {
			case 0x4008: t.control = !!(v & 0x80); t.linReload = v & 0x7F; break;
			case 0x400A: t.period = (t.period & 0x700) | v; break;
			case 0x400B: t.period = (t.period & 0xFF) | ((v & 7) << 8); if (t.enabled) t.len = LENGTH_TABLE[v >> 3]; t.linFlag = true; break;
			case 0x400C: n.env.loop = !!(v & 0x20); n.env.constant = !!(v & 0x10); n.env.vol = v & 15; break;
			case 0x400E: n.mode = !!(v & 0x80); n.period = this.noiseTable[v & 15]; break;
			case 0x400F: if (n.enabled) n.len = LENGTH_TABLE[v >> 3]; n.env.start = true; break;
			case 0x4010: d.loop = !!(v & 0x40); d.rate = this.dmcTable[v & 15]; break;
			case 0x4011: d.out = v & 0x7F; break;
			case 0x4012: d.start = v * 64; break;
			case 0x4013: d.length = v * 16 + 1; break;
			case 0x4015:
				this.p[0].enabled = !!(v & 1); if (!(v & 1)) this.p[0].len = 0;
				this.p[1].enabled = !!(v & 2); if (!(v & 2)) this.p[1].len = 0;
				t.enabled = !!(v & 4); if (!(v & 4)) t.len = 0;
				n.enabled = !!(v & 8); if (!(v & 8)) n.len = 0;
				if (v & 0x10) { if (d.remain === 0) { d.addr = d.start; d.remain = d.length; this.dmcFetch(); } }
				else d.remain = 0;
				break;
			case 0x4017:
				this.fsMode5 = !!(v & 0x80); this.fsCtr = this.fsPeriod; this.fsStep = 0;
				if (this.fsMode5) { this.quarter(); this.half(); }
				break;
		}
	}
	dmcFetch() {
		const d = this.dmc;
		if (d.buffer < 0 && d.remain > 0) {
			d.buffer = d.addr < this.sampleMem.length ? this.sampleMem[d.addr] : 0xAA;
			d.addr = (d.addr + 1) & 0x7FFF;
			if (--d.remain === 0 && d.loop) { d.addr = d.start; d.remain = d.length; }
		}
	}
	quarter() {
		this.p[0].env.clock(); this.p[1].env.clock(); this.noi.env.clock();
		const t = this.tri;
		if (t.linFlag) t.lin = t.linReload; else if (t.lin > 0) --t.lin;
		if (!t.control) t.linFlag = false;
	}
	half() {
		this.p[0].clockLength(); this.p[1].clockLength();
		this.p[0].clockSweep(); this.p[1].clockSweep();
		if (!this.tri.control && this.tri.len > 0) --this.tri.len;
		if (!this.noi.env.loop && this.noi.len > 0) --this.noi.len;
	}
	run(cycles) {
		const p0 = this.p[0], p1 = this.p[1], t = this.tri, n = this.noi, d = this.dmc;
		let area1 = 0, area2 = 0;
		while (cycles > 0) {
			const triOn = t.lin > 0 && t.len > 0 && t.period >= 2;
			let dt = cycles;
			if (p0.ctr < dt) dt = p0.ctr;
			if (p1.ctr < dt) dt = p1.ctr;
			if (triOn && t.ctr < dt) dt = t.ctr;
			if (n.ctr < dt) dt = n.ctr;
			if (d.ctr < dt) dt = d.ctr;
			if (this.fsCtr < dt) dt = this.fsCtr;
			const sq = p0.out() + p1.out();
			const nz = (n.len > 0 && !(n.lfsr & 1)) ? n.env.out() : 0;
			area1 += SQUARE_TABLE[sq] * dt;
			area2 += TND_TABLE[(TRI_TABLE[t.step] * 16 + nz) * 128 + d.out] * dt;
			cycles -= dt;
			if ((p0.ctr -= dt) <= 0) { p0.ctr = (p0.period + 1) * 2; p0.step = (p0.step + 1) & 7; }
			if ((p1.ctr -= dt) <= 0) { p1.ctr = (p1.period + 1) * 2; p1.step = (p1.step + 1) & 7; }
			if (triOn && (t.ctr -= dt) <= 0) { t.ctr = t.period + 1; t.step = (t.step + 1) & 31; }
			if ((n.ctr -= dt) <= 0) {
				n.ctr = n.period;
				const fb = (n.lfsr ^ (n.lfsr >> (n.mode ? 6 : 1))) & 1;
				n.lfsr = (n.lfsr >> 1) | (fb << 14);
			}
			if ((d.ctr -= dt) <= 0) {
				d.ctr = d.rate;
				if (!d.silence) {
					if (d.shift & 1) { if (d.out <= 125) d.out += 2; }
					else if (d.out >= 2) d.out -= 2;
					d.shift >>= 1;
				}
				if (--d.bits <= 0) {
					d.bits = 8;
					if (d.buffer < 0) d.silence = true;
					else { d.silence = false; d.shift = d.buffer; d.buffer = -1; this.dmcFetch(); }
				}
			}
			if ((this.fsCtr -= dt) <= 0) {
				this.fsCtr = this.fsPeriod;
				const s = this.fsStep;
				if (this.fsMode5) {
					if (s !== 3) this.quarter();
					if (s === 1 || s === 4) this.half();
					this.fsStep = (s + 1) % 5;
				} else {
					this.quarter();
					if (s & 1) this.half();
					this.fsStep = (s + 1) & 3;
				}
			}
		}
		this.area1 = area1; this.area2 = area2;
	}
}

