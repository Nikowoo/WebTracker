// based on mesen fdsaudio... dnft uses the same thing anyways
const FDS_MOD_LUT = [0, 1, 2, 4, 0xFF, -4, -2, -1];
const FDS_WAVE_VOL = [36, 24, 17, 14];
class FDSEnvUnit {
	constructor() { this.speed = 0; this.gain = 0; this.envOff = false; this.inc = false; this.freq = 0; this.timer = 0; this.master = 0xFF; }
	writeReg(addr, v) {
		switch (addr & 3) {
			case 0:
				this.speed = v & 0x3F; this.inc = !!(v & 0x40); this.envOff = !!(v & 0x80);
				this.resetTimer();
				if (this.envOff) this.gain = this.speed;
				break;
			case 2: this.freq = (this.freq & 0x0F00) | v; break;
			case 3: this.freq = (this.freq & 0xFF) | ((v & 0x0F) << 8); break;
		}
	}
	// timer 0 never ticks  mesen is unsigned so it just wraps ig
	tickEnv() {
		if (!this.envOff && this.master > 0 && this.timer > 0) {
			if (--this.timer === 0) {
				this.resetTimer();
				if (this.inc && this.gain < 32) ++this.gain;
				else if (!this.inc && this.gain > 0) --this.gain;
				return true;
			}
		}
		return false;
	}
	envMaxSkip() { return (!this.envOff && this.master > 0 && this.timer > 0) ? this.timer - 1 : 1 << 24; }
	skipEnv(c) { if (!this.envOff && this.master > 0 && this.timer > 0) this.timer -= c; }
	resetTimer() { this.timer = 8 * (this.speed + 1) * this.master; }
}
class FDSChip {
	constructor() { this.reset(); }
	reset() {
		this.wave = new Uint8Array(64); this.waveWrite = false;
		this.car = new FDSEnvUnit(); this.mod = new FDSEnvUnit();
		this.modCounter = 0; this.modDisabled = false; this.modTable = new Uint8Array(64); this.modPos = 0;
		this.modOverflow = 0; this.modOutput = 0;
		this.disableEnv = false; this.halt = false; this.masterVol = 0;
		this.waveOverflow = 0; this.wavePos = 0;
	}
	setCounter(v) { v = s8(v); if (v >= 64) v -= 128; else if (v < -64) v += 128; this.modCounter = v; }
	modEnabled() { return !this.modDisabled && this.mod.freq > 0; }
	modOut() { return this.modEnabled() ? this.modOutput : 0; }
	updateModOutput(pitch) {
		let temp = this.modCounter * this.mod.gain;
		let rem = temp & 0xF;
		temp >>= 4;
		if (rem > 0 && (temp & 0x80) === 0) temp += this.modCounter < 0 ? -1 : 2;
		if (temp >= 192) temp -= 256; else if (temp < -64) temp += 256;
		temp = pitch * temp;
		rem = temp & 0x3F;
		temp >>= 6;
		if (rem >= 32) temp += 1;
		this.modOutput = temp;
	}
	tickModulator() {
		if (this.modEnabled()) {
			this.modOverflow = (this.modOverflow + this.mod.freq) & 0xFFFF;
			if (this.modOverflow < this.mod.freq) {
				const off = FDS_MOD_LUT[this.modTable[this.modPos]];
				this.setCounter(off === 0xFF ? 0 : this.modCounter + off);
				this.modPos = (this.modPos + 1) & 0x3F;
				return true;
			}
		}
		return false;
	}
	output() { return this.wave[this.wavePos] * Math.min(this.car.gain, 32) * FDS_WAVE_VOL[this.masterVol]; }
	clock() {
		const f = this.car.freq;
		if (!this.halt && !this.disableEnv) {
			this.car.tickEnv();
			if (this.mod.tickEnv()) this.updateModOutput(f);
		}
		if (this.tickModulator()) this.updateModOutput(f);
		const out = this.output();
		if (this.halt) this.wavePos = 0;
		else {
			const mf = f + this.modOut();
			if (mf > 0 && !this.waveWrite) {
				this.waveOverflow = (this.waveOverflow + mf) & 0xFFFF;
				if (this.waveOverflow < mf) this.wavePos = (this.wavePos + 1) & 0x3F;
			}
		}
		return out;
	}
	maxSkip() {
		let c = 1 << 24;
		if (!this.halt && !this.disableEnv) { c = Math.min(c, this.car.envMaxSkip(), this.mod.envMaxSkip()); }
		if (this.modEnabled()) c = Math.min(c, Math.floor((0xFFFF - this.modOverflow) / this.mod.freq));
		if (!this.halt) {
			const mf = this.car.freq + this.modOut();
			if (mf > 0 && !this.waveWrite) c = Math.min(c, Math.floor((0xFFFF - this.waveOverflow) / mf));
		}
		return c;
	}
	skip(c) {
		if (!this.halt && !this.disableEnv) { this.car.skipEnv(c); this.mod.skipEnv(c); }
		if (this.modEnabled()) this.modOverflow += this.mod.freq * c;
		if (this.halt) { this.wavePos = 0; return; }
		const mf = this.car.freq + this.modOut();
		if (mf > 0 && !this.waveWrite) this.waveOverflow += mf * c;
	}
	write(a, v) {
		if (a >= 0x4040 && a <= 0x407F) { if (this.waveWrite) this.wave[a & 0x3F] = v & 0x3F; return; }
		switch (a) {
			case 0x4080: case 0x4082: this.car.writeReg(a, v); break;
			case 0x4083:
				this.disableEnv = !!(v & 0x40); this.halt = !!(v & 0x80);
				if (this.disableEnv) { this.car.resetTimer(); this.mod.resetTimer(); }
				this.car.writeReg(a, v); break;
			case 0x4084: case 0x4086: this.mod.writeReg(a, v); break;
			case 0x4085: this.setCounter(v & 0x7F); break;
			case 0x4087:
				this.mod.writeReg(a, v); this.modDisabled = !!(v & 0x80);
				if (this.modDisabled) this.modOverflow = 0;
				break;
			case 0x4088:
				if (this.modDisabled) {
					this.modTable[this.modPos & 0x3F] = v & 7;
					this.modTable[(this.modPos + 1) & 0x3F] = v & 7;
					this.modPos = (this.modPos + 2) & 0x3F;
				}
				break;
			case 0x4089: this.masterVol = v & 3; this.waveWrite = !!(v & 0x80); break;
			case 0x408A: this.car.master = v; this.mod.master = v; break;
		}
	}
	run(cycles) {
		let area = 0;
		while (cycles > 0) {
			const sk = Math.min(this.maxSkip(), cycles);
			if (sk > 0) { area += this.output() * sk; this.skip(sk); cycles -= sk; if (cycles <= 0) break; }
			area += this.clock();
			--cycles;
		}
		return area;
	}
}

