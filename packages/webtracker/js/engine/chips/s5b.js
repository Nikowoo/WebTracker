// halved clock so 1 tick is qeuqal 16 cpu cycles
const PSG_VOLTBL = [0x00, 0x01, 0x01, 0x02, 0x02, 0x03, 0x03, 0x04, 0x05, 0x06, 0x07, 0x09, 0x0B, 0x0D, 0x0F, 0x12,
	0x16, 0x1A, 0x1F, 0x25, 0x2D, 0x35, 0x3F, 0x4C, 0x5A, 0x6A, 0x7F, 0x97, 0xB4, 0xD6, 0xFF, 0xFF];
const PSG_REGMSK = [0xff, 0x0f, 0xff, 0x0f, 0xff, 0x0f, 0x1f, 0x3f, 0x1f, 0x1f, 0x1f, 0xff, 0xff, 0x0f, 0xff, 0xff];
class S5BChip {
	constructor() { this.reset(); }
	reset() {
		this.reg = new Uint8Array(16); this.port = 0;
		this.freq = [0, 0, 0]; this.count = [0, 0, 0]; this.edge = [0, 0, 0]; this.volume = [0, 0, 0];
		this.tmask = [0, 0, 0]; this.nmask = [0, 0, 0]; this.chout = [0, 0, 0];
		this.noiseSeed = 0xffff; this.noiseScaler = 0; this.noiseCount = 0; this.noiseFreq = 0;
		this.envPtr = 0; this.envFace = 0; this.envContinue = 0; this.envAttack = 0; this.envAlternate = 0; this.envHold = 0;
		this.envPause = 1; this.envCount = 0; this.envFreq = 0;
		this.sub = 0; this.outv = 0;
	}
	write(a, v) {
		if (a === 0xC000) { this.port = v & 0x0F; return; }
		if (a !== 0xE000) return;
		const reg = this.port;
		v &= PSG_REGMSK[reg]; this.reg[reg] = v;
		switch (reg) {
			case 0: case 1: case 2: case 3: case 4: case 5: {
				const c = reg >> 1; this.freq[c] = ((this.reg[c * 2 + 1] & 15) << 8) + this.reg[c * 2]; break;
			}
			case 6: this.noiseFreq = v & 31; break;
			case 7: for (let i = 0; i < 3; ++i) { this.tmask[i] = v & (1 << i); this.nmask[i] = v & (8 << i); } break;
			case 8: case 9: case 10: this.volume[reg - 8] = v << 1; break;
			case 11: case 12: this.envFreq = (this.reg[12] << 8) + this.reg[11]; break;
			case 13:
				this.envContinue = (v >> 3) & 1; this.envAttack = (v >> 2) & 1; this.envAlternate = (v >> 1) & 1; this.envHold = v & 1;
				this.envFace = this.envAttack; this.envPause = 0; this.envPtr = this.envFace ? 0 : 0x1f;
				break;
		}
		this.mix();
	}
	tick() {
		if (++this.envCount >= this.envFreq) {
			if (!this.envPause) this.envPtr = this.envFace ? (this.envPtr + 1) & 0x3f : (this.envPtr + 0x3f) & 0x3f;
			if (this.envPtr & 0x20) {
				if (this.envContinue) {
					if (this.envAlternate ^ this.envHold) this.envFace ^= 1;
					if (this.envHold) this.envPause = 1;
					this.envPtr = this.envFace ? 0 : 0x1f;
				} else { this.envPause = 1; this.envPtr = 0; }
			}
			this.envCount = this.envFreq >= 1 ? this.envCount - this.envFreq : 0;
		}
		if (++this.noiseCount >= this.noiseFreq) {
			this.noiseScaler ^= 1;
			if (this.noiseScaler) { if (this.noiseSeed & 1) this.noiseSeed ^= 0x24000; this.noiseSeed >>= 1; }
			this.noiseCount = this.noiseFreq >= 1 ? this.noiseCount - this.noiseFreq : 0;
		}
		for (let i = 0; i < 3; ++i) {
			if (++this.count[i] >= this.freq[i]) {
				this.edge[i] ^= 1;
				this.count[i] = this.freq[i] >= 1 ? this.count[i] - this.freq[i] : 0;
			}
		}
		this.mix();
	}
	mix() {
		const noise = this.noiseSeed & 1;
		let s = 0;
		for (let i = 0; i < 3; ++i) {
			let o = 0;
			if ((this.tmask[i] || this.edge[i]) && (this.nmask[i] || noise))
				o = !(this.volume[i] & 32) ? PSG_VOLTBL[this.volume[i] & 31] : PSG_VOLTBL[this.envPtr];
			this.chout[i] = o; s += o;
		}
		this.outv = s;
	}
	run(cycles) {
		let area = 0;
		while (cycles > 0) {
			const dt = Math.min(16 - this.sub, cycles);
			area += this.outv * dt;
			cycles -= dt; this.sub += dt;
			if (this.sub >= 16) { this.sub = 0; this.tick(); }
		}
		return area;
	}
}

