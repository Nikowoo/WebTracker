// mesen Namco163Audio but the channels get mixed instead of multiplexed
class N163Chip {
	constructor() { this.reset(); }
	reset() {
		this.ram = new Uint8Array(128); this.pos = 0; this.autoInc = false; this.counter = 0; this.cur = 7;
		this.disable = false; this.out = new Int16Array(8);
	}
	write(a, v) {
		switch (a & 0xF800) {
			case 0x4800: this.ram[this.pos] = v; if (this.autoInc) this.pos = (this.pos + 1) & 0x7F; break;
			case 0xE000: this.disable = !!(v & 0x40); break;
			case 0xF800: this.pos = v & 0x7F; this.autoInc = !!(v & 0x80); break;
		}
	}
	numCh() { return (this.ram[0x7F] >> 4) & 7; }
	updateChannel(ch) {
		const r = this.ram, b = 0x40 + ch * 8;
		let phase = (r[b + 5] << 16) | (r[b + 3] << 8) | r[b + 1];
		const freq = ((r[b + 4] & 3) << 16) | (r[b + 2] << 8) | r[b];
		const length = 256 - (r[b + 4] & 0xFC);
		const offset = r[b + 6], vol = r[b + 7] & 15;
		phase = (phase + freq) % (length << 16);
		const sp = ((phase >> 16) + offset) & 0xFF;
		const smp = (sp & 1) ? r[sp >> 1] >> 4 : r[sp >> 1] & 15;
		this.out[ch] = (smp - 8) * vol;
		r[b + 5] = (phase >> 16) & 0xFF; r[b + 3] = (phase >> 8) & 0xFF; r[b + 1] = phase & 0xFF;
	}
	level() { let s = 0; for (let i = 7, m = 7 - this.numCh(); i >= m; --i) s += this.out[i]; return s; }
	run(cycles) {
		let area = 0;
		while (cycles > 0) {
			if (this.disable) { area += this.level() * cycles; break; }
			const dt = Math.min(15 - this.counter, cycles);
			area += this.level() * dt;
			cycles -= dt; this.counter += dt;
			if (this.counter >= 15) {
				this.counter = 0;
				this.updateChannel(this.cur);
				if (--this.cur < 7 - this.numCh()) this.cur = 7;
			}
		}
		return area;
	}
}

