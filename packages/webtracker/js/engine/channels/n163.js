const N163_PITCH_SLIDE_SHIFT = 2;
class ChannelN163 extends FrequencyChannelHandler {
	constructor() {
		super(0xFFFF, 0x0F);
		this.disableLoad = false; this.resetPhase = false; this.waveLen = 4; this.waveCount = 0; this.wavePos = 0; this.wavePosOld = 0;
		this.loadWave = false; this.channels = 1; this.dutyPeriod = 0;
	}
	index() { return this.chanId - CH_N1; }
	resetChannel() { super.resetChannel(); this.wavePos = this.wavePosOld = 0; this.waveLen = 4; this.loadWave = false; }
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.PORTA_DOWN:
				this.portaSpeed = p; if (!this.linearPitch) this.portaSpeed <<= N163_PITCH_SLIDE_SHIFT;
				this.effectParam = p; this.effect = this.linearPitch ? EF.PORTA_DOWN : EF.PORTA_UP; break;
			case EF.PORTA_UP:
				this.portaSpeed = p; if (!this.linearPitch) this.portaSpeed <<= N163_PITCH_SLIDE_SHIFT;
				this.effectParam = p; this.effect = this.linearPitch ? EF.PORTA_UP : EF.PORTA_DOWN; break;
			case EF.DUTY_CYCLE:
				this.defaultDuty = this.dutyPeriod = p; this.loadWave = true;
				if (this.instHandler instanceof SeqInstHandlerN163) this.instHandler.force = true;
				break;
			case EF.N163_WAVE_BUFFER:
				if (p === 0x7F) { this.wavePos = this.wavePosOld; this.disableLoad = false; }
				else { this.wavePos = p << 1; this.disableLoad = true; }
				if (this.instHandler instanceof SeqInstHandlerN163) this.instHandler.force = true;
				break;
			case EF.PHASE_RESET: if (p === 0) this.resetPhase = true; break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	handleInstrument(trigger, newInst) {
		if (!super.handleInstrument(trigger, newInst)) return false;
		if (!this.loadWave && newInst) this.defaultDuty = 0;
		if (!this.disableLoad) this.wavePos = this.wavePosOld;
		return true;
	}
	handleCut() { this.cutNote(); this.note = 0; this.release = false; }
	handleNote(note, octave) { super.handleNote(note, octave); this.loadWave = false; }
	createInstHandler(type) {
		switch (type) {
			case INST_2A03: case INST_VRC6: case INST_S5B: case INST_FDS:
				if (!(this.instTypeCurrent === INST_2A03 || this.instTypeCurrent === INST_VRC6 || this.instTypeCurrent === INST_S5B || this.instTypeCurrent === INST_FDS)) {
					this.instHandler = new SeqInstHandler(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true;
				}
				break;
			case INST_N163:
				if (this.instTypeCurrent !== INST_N163) { this.instHandler = new SeqInstHandlerN163(this, 0x0F, 0); return true; }
		}
		return false;
	}
	setupSlide() { super.setupSlide(); if (!this.linearPitch) this.portaSpeed <<= N163_PITCH_SLIDE_SHIFT; }
	refreshChannel() {
		const channel = 7 - this.index();
		const waveSize = 256 - (this.waveLen >> 2);
		const freq = this.calculatePeriod();
		let volume = this.calculateVolume();
		const base = 0x40 + channel * 8;
		if (!this.gate) volume = 0;
		if (channel + this.channels >= 8) {
			this.writeData(base + 7, ((this.channels - 1) << 4) | volume);
			if (!this.gate) return;
			this.writeData(base + 0, freq & 0xFF);
			this.writeData(base + 2, (freq >> 8) & 0xFF);
			this.writeData(base + 4, ((waveSize << 2) | ((freq >> 16) & 3)) & 0xFF);
			this.writeData(base + 6, this.wavePos & 0xFF);
		}
		if (this.resetPhase) {
			this.resetPhase = false;
			this.writeData(base + 1, 0); this.writeData(base + 3, 0); this.writeData(base + 5, 0);
		}
	}
	fillWaveRAM(buf, count) {
		this.write(0xF800, 0x80 | ((this.wavePos >> 1) & 0x7F));
		for (let i = 0; i < count; ++i) this.write(0x4800, buf[i] & 0xFF);
	}
	convertDuty(d) {
		switch (this.instTypeCurrent) { case INST_2A03: case INST_VRC6: case INST_S5B: return -1; default: return d; }
	}
	clearRegisters() {
		const base = 0x40 + this.index() * 8;
		for (let i = 0; i < 8; ++i) { this.writeReg(base + i, 0); this.writeReg(base + i - 0x40, 0); }
		if (this.index() === 7) this.writeReg(base + 7, (this.channels - 1) << 4);
		this.disableLoad = false; this.dutyPeriod = 0;
	}
	calculatePeriod(mult = true) {
		const detune = this.getVibrato() - this.getFinePitch();
		let f;
		if (this.linearPitch && this.noteTable) {
			f = this.limitPeriod(this.period + detune);
			const note = f >> LINEAR_PITCH_AMOUNT, sub = f % (1 << LINEAR_PITCH_AMOUNT);
			let off = note < NOTE_COUNT - 1 ? this.noteTable[note + 1] - this.noteTable[note] : 0;
			off = (off * sub) >> LINEAR_PITCH_AMOUNT;
			if (sub && !off) off = 1;
			f = this.noteTable[note] + off;
		} else f = this.period + (detune << 4);
		if (mult) f *= this.harmonic;
		return this.limitRawPeriod(f) << N163_PITCH_SLIDE_SHIFT;
	}
	writeReg(reg, v) { this.write(0xF800, reg & 0x7F); this.write(0x4800, v & 0xFF); }
	writeData(addr, v) { this.write(0xF800, addr & 0x7F); this.write(0x4800, v & 0xFF); }
}

