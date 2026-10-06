class VRC6Chip {
	constructor() { this.reset(); }
	reset() {
		this.p = [0, 1].map(() => ({ duty: 0, vol: 0, mode: false, period: 0, en: false, step: 15, ctr: 1 }));
		this.saw = { rate: 0, period: 0, en: false, acc: 0, cnt: 0, ctr: 1 };
	}
	write(a, v) {
		const r = a & 3, hi = a & 0xF000;
		if (hi === 0x9000 || hi === 0xA000) {
			const p = this.p[hi === 0x9000 ? 0 : 1];
			if (r === 0) { p.mode = !!(v & 0x80); p.duty = (v >> 4) & 7; p.vol = v & 15; }
			else if (r === 1) p.period = (p.period & 0xF00) | v;
			else if (r === 2) { p.period = (p.period & 0xFF) | ((v & 15) << 8); p.en = !!(v & 0x80); if (!p.en) p.step = 15; }
		} else if (hi === 0xB000) {
			const s = this.saw;
			if (r === 0) s.rate = v & 0x3F;
			else if (r === 1) s.period = (s.period & 0xF00) | v;
			else if (r === 2) { s.period = (s.period & 0xFF) | ((v & 15) << 8); s.en = !!(v & 0x80); if (!s.en) { s.acc = 0; s.cnt = 0; } }
		}
	}
	run(cycles) {
		const a = this.p[0], b = this.p[1], s = this.saw;
		let area = 0;
		while (cycles > 0) {
			let dt = cycles;
			if (a.en && a.ctr < dt) dt = a.ctr;
			if (b.en && b.ctr < dt) dt = b.ctr;
			if (s.en && s.ctr < dt) dt = s.ctr;
			const o = (a.en && (a.mode || a.step <= a.duty) ? a.vol : 0) + (b.en && (b.mode || b.step <= b.duty) ? b.vol : 0) + (s.en ? s.acc >> 3 : 0);
			area += o * dt;
			cycles -= dt;
			if (a.en && (a.ctr -= dt) <= 0) { a.ctr = a.period + 1; a.step = (a.step - 1) & 15; }
			if (b.en && (b.ctr -= dt) <= 0) { b.ctr = b.period + 1; b.step = (b.step - 1) & 15; }
			if (s.en && (s.ctr -= dt) <= 0) {
				s.ctr = s.period + 1;
				s.cnt = (s.cnt + 1) % 14;
				if (s.cnt === 0) s.acc = 0; else if (!(s.cnt & 1)) s.acc = (s.acc + s.rate) & 0xFF;
			}
		}
		return area;
	}
}

