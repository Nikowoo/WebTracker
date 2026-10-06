class MMC5Chip {
	constructor() { this.fsPeriod = Math.round(CLK_NTSC / 240); this.reset(); }
	reset() {
		this.p = [new PulseUnit(false), new PulseUnit(false)];
		this.p[0].hasSweep = this.p[1].hasSweep = false;
		this.fsCtr = this.fsPeriod;
	}
	write(a, v) {
		if (a >= 0x5000 && a <= 0x5007) { const r = a & 3; if (r !== 1) this.p[(a >> 2) & 1].write(r, v); }
		else if (a === 0x5015) {
			for (let i = 0; i < 2; ++i) { this.p[i].enabled = !!(v & (1 << i)); if (!this.p[i].enabled) this.p[i].len = 0; }
		}
	}
	run(cycles) {
		const a = this.p[0], b = this.p[1];
		let area = 0;
		while (cycles > 0) {
			let dt = cycles;
			if (a.ctr < dt) dt = a.ctr;
			if (b.ctr < dt) dt = b.ctr;
			if (this.fsCtr < dt) dt = this.fsCtr;
			area += SQUARE_TABLE[a.out() + b.out()] * dt;
			cycles -= dt;
			if ((a.ctr -= dt) <= 0) { a.ctr = (a.period + 1) * 2; a.step = (a.step + 1) & 7; }
			if ((b.ctr -= dt) <= 0) { b.ctr = (b.period + 1) * 2; b.step = (b.step + 1) & 7; }
			if ((this.fsCtr -= dt) <= 0) {
				this.fsCtr = this.fsPeriod;
				a.env.clock(); b.env.clock(); a.clockLength(); b.clockLength();
			}
		}
		return area;
	}
}

