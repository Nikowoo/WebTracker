class Channel2A03 extends ChannelHandler {
	constructor() { super(0x7FF, 0x0F); this.hwEnv = false; this.envLoop = true; this.resetEnv = false; this.lengthCounter = 1; }
	handleNoteData(nd, effCols) {
		super.handleNoteData(nd, effCols);
		if (nd.note !== NONE && nd.note !== HALT && nd.note !== RELEASE) if (!this.envLoop || this.hwEnv) this.resetEnv = true;
	}
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.VOLUME:
				if (p < 0x20) { this.lengthCounter = p; this.envLoop = false; this.resetEnv = true; }
				else if (p >= 0xE0 && p < 0xE4) {
					if (!this.envLoop || !this.hwEnv) this.resetEnv = true;
					this.hwEnv = (p & 1) === 1; this.envLoop = (p & 2) !== 2;
				}
				break;
			case EF.DUTY_CYCLE: this.defaultDuty = this.dutyPeriod = p; break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	createInstHandler(type) {
		if (this.seqFamily(type)) { this.instHandler = new SeqInstHandler(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true; }
		return false;
	}
	resetChannel() { super.resetChannel(); this.envLoop = true; this.hwEnv = false; this.lengthCounter = 1; }
}

class Square2A03 extends Channel2A03 {
	constructor() { super(); this.cSweep = 0; this.sweeping = false; this.iSweep = 0; this.lastPeriod = 0xFFFF; this.idx = 0; }
	setChannelID(id) { this.chanId = id; this.idx = id - CH_SQ1; }
	refreshChannel() {
		const period = this.calculatePeriod(), volume = this.calculateVolume(), duty = this.dutyPeriod & 3;
		const lo = period & 0xFF, hi = period >> 8, A = 0x4000 + this.idx * 4;
		if (this.gate) this.write(A, (duty << 6) | ((this.envLoop ? 1 : 0) << 5) | ((this.hwEnv ? 0 : 1) << 4) | volume);
		else { this.write(A, 0x30); this.lastPeriod = 0xFFFF; return; }
		if (this.cSweep) {
			if (this.cSweep & 0x80) {
				this.write(A + 1, this.cSweep); this.cSweep &= 0x7F;
				this.write(0x4017, 0x80); this.write(0x4017, 0x00);
				this.write(A + 2, lo); this.write(A + 3, hi + (this.lengthCounter << 3));
				this.lastPeriod = 0xFFFF;
			}
		} else {
			this.write(A + 1, 0x08); this.write(A + 2, lo);
			if (hi !== (this.lastPeriod >> 8) || this.resetEnv) this.write(A + 3, hi + (this.lengthCounter << 3));
		}
		this.lastPeriod = period; this.resetEnv = false;
	}
	convertDuty(d) {
		switch (this.instTypeCurrent) { case INST_VRC6: return DUTY_2A03_FROM_VRC6[d & 7]; case INST_S5B: return 2; default: return d; }
	}
	clearRegisters() {
		const A = 0x4000 + this.idx * 4;
		this.write(A, 0x30); this.write(A + 1, 0x08); this.write(A + 2, 0); this.write(A + 3, 0);
		this.lastPeriod = 0xFFFF;
	}
	handleNoteData(nd, effCols) { this.iSweep = 0; this.sweeping = false; super.handleNoteData(nd, effCols); }
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.SWEEPUP: this.iSweep = 0x88 | (p & 0x77); this.lastPeriod = 0xFFFF; this.sweeping = true; break;
			case EF.SWEEPDOWN: this.iSweep = 0x80 | (p & 0x77); this.lastPeriod = 0xFFFF; this.sweeping = true; break;
			case EF.PHASE_RESET:
				if (p === 0) this.write(0x4000 + this.idx * 4 + 3, (this.calculatePeriod() >> 8) + (this.lengthCounter << 3));
				break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	handleEmptyNote() { if (this.sweeping) this.cSweep = this.iSweep; }
	handleNote(note, octave) {
		super.handleNote(note, octave);
		if (!this.sweeping && (this.cSweep !== 0 || this.iSweep !== 0)) { this.iSweep = 0; this.cSweep = 0; this.lastPeriod = 0xFFFF; }
		else if (this.sweeping) { this.cSweep = this.iSweep; this.lastPeriod = 0xFFFF; }
	}
}

class Triangle2A03 extends Channel2A03 {
	constructor() { super(); this.linearCounter = -1; this.retrigger = false; }
	refreshChannel() {
		const f = this.calculatePeriod(), lo = f & 0xFF, hi = f >> 8;
		if (this.instVolume > 0 && this.volume > 0 && this.gate) {
			this.write(0x4008, ((this.envLoop ? 1 : 0) << 7) | (this.linearCounter & 0x7F));
			this.write(0x400A, lo);
			if (this.envLoop || this.resetEnv || this.retrigger) this.write(0x400B, hi + (this.lengthCounter << 3));
		} else {
			this.write(0x4008, 0);
			if (this.retrigger) this.write(0x400B, this.lengthCounter << 3);
		}
		this.resetEnv = false;
	}
	resetChannel() { super.resetChannel(); this.linearCounter = -1; this.retrigger = false; }
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.VOLUME:
				if (p < 0x20) { this.lengthCounter = p; this.envLoop = false; this.resetEnv = true; if (this.linearCounter === -1) this.linearCounter = 0x7F; }
				else if (p >= 0xE0 && p < 0xE4) { if (!this.envLoop) this.resetEnv = true; this.envLoop = (p & 1) !== 1; }
				break;
			case EF.NOTE_CUT:
				if (p >= 0x80) { this.linearCounter = p - 0x80; this.envLoop = false; this.resetEnv = true; }
				else { if (!this.retrigger) this.envLoop = true; return super.handleEffect(cmd, p); }
				break;
			case EF.RETRIGGER:
				if (p > 0x7F) return false;
				if (p === 0) { this.linearCounter = -1; this.envLoop = true; this.retrigger = false; }
				else { this.linearCounter = p; this.envLoop = false; this.resetEnv = true; this.retrigger = true; }
				break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	clearRegisters() { this.write(0x4008, 0); this.write(0x400A, 0); this.write(0x400B, 0); }
}

class Noise2A03 extends Channel2A03 {
	handleNote(note, octave) {
		ChannelHandler.prototype.handleNote.call(this, note, octave);
		const newNote = (MIDI_NOTE(octave, note) & 0x0F) | 0x100;
		const f = this.triggerNote(newNote);
		if (this.portaSpeed > 0 && this.effect === EF.PORTAMENTO) { if (this.period === 0) this.period = f; this.portaTo = f; }
		else this.period = f;
		this.gate = true;
		this.note = newNote;
	}
	setupSlide() {
		const sp = x => ((x & 0xF0) >> 3) + 1;
		switch (this.effect) {
			case EF.PORTAMENTO: this.portaSpeed = this.effectParam; break;
			case EF.SLIDE_UP: this.note += this.effectParam & 0xF; this.portaSpeed = sp(this.effectParam); break;
			case EF.SLIDE_DOWN: this.note -= this.effectParam & 0xF; this.portaSpeed = sp(this.effectParam); break;
		}
		this.portaTo = this.note;
	}
	limitPeriod(p) { return p; }
	limitRawPeriod(p) { return p; }
	refreshChannel() {
		let period = this.calculatePeriod();
		const volume = this.calculateVolume(), mode = (this.dutyPeriod & 1) << 7;
		period = (period & 0x0F) ^ 0x0F;
		if (this.gate) this.write(0x400C, ((this.envLoop ? 1 : 0) << 5) | ((this.hwEnv ? 0 : 1) << 4) | volume);
		else { this.write(0x400C, 0x30); return; }
		this.write(0x400E, mode | period);
		if (this.envLoop || this.resetEnv) this.write(0x400F, this.lengthCounter << 3);
		this.resetEnv = false;
	}
	clearRegisters() { this.write(0x400C, 0x30); this.write(0x400E, 0); this.write(0x400F, 0); }
	triggerNote(note) { return note | 0x100; }
}

class DPCM2A03 extends ChannelHandler {
	constructor() {
		super(0xF, 0x3F);
		this.enabled = false; this.trig = false; this.dac = 255; this.retrigPeriod = 0; this.retrigCtr = 0;
		this.customPitch = -1; this.offset = 0; this.loopOffset = 0; this.sampleLength = 0; this.loopLength = 0; this.loop = 0;
	}
	handleNoteData(nd, effCols) {
		this.customPitch = -1; this.retrigPeriod = 0;
		if (nd.note !== NONE) { this.noteCut = 0; this.noteRelease = 0; }
		super.handleNoteData(nd, effCols);
	}
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.DAC: this.dac = p & 0x7F; break;
			case EF.SAMPLE_OFFSET: this.offset = p & 0x3F; break;
			case EF.DPCM_PITCH: this.customPitch = p & 0x0F; break;
			case EF.RETRIGGER: this.retrigPeriod = Math.max(p, 1); if (this.retrigCtr === 0) this.queueSample(); break;
			case EF.PHASE_RESET: if (p === 0) this.triggerSample(); break;
			case EF.NOTE_CUT: case EF.NOTE_RELEASE: return super.handleEffect(cmd, p);
			default: return false;
		}
		return true;
	}
	handleCut() { this.cutNote(); }
	handleRelease() { this.release = true; }
	handleNote(note, octave) {
		super.handleNote(note, octave);
		this.note = MIDI_NOTE(octave, note);
		this.triggerNote(this.note);
		this.gate = true;
	}
	createInstHandler(type) {
		if (type === INST_2A03 && this.instTypeCurrent !== INST_2A03) { this.instHandler = new InstHandlerDPCM(this); return true; }
		return false;
	}
	playSample(samp, pitch) {
		const size = samp.length;
		this.P.apu.writeSample(samp);
		this.period = this.customPitch !== -1 ? this.customPitch : pitch;
		this.sampleLength = (size >> 4) - (this.offset << 2);
		this.loopLength = size - this.loopOffset;
		this.loop = (pitch & 0x80) >> 1;
		this.triggerSample();
	}
	triggerSample() { this.enabled = true; this.trig = true; this.queueSample(); }
	queueSample() { this.retrigCtr = this.retrigPeriod === 0 ? 0 : this.retrigPeriod + 1; }
	writeDCOffset(d) { if (d !== 255 && this.dac === 255) this.dac = d; }
	setLoopOffset(l) { this.loopOffset = l; }
	refreshChannel() {
		if (this.dac !== 255) { this.write(0x4011, this.dac); this.dac = 255; }
		if (this.retrigPeriod !== 0) {
			if (--this.retrigCtr === 0) { this.retrigCtr = this.retrigPeriod; this.enabled = true; this.trig = true; }
		}
		if (this.release) { this.write(0x4015, 0x0F); this.enabled = false; this.release = false; }
		if (!this.enabled) return;
		if (!this.gate) {
			this.write(0x4015, 0x0F); this.write(0x4011, 0); this.enabled = false;
		} else if (this.trig) {
			this.write(0x4010, (this.period & 0x0F) | this.loop);
			this.write(0x4012, this.offset);
			this.write(0x4013, this.sampleLength & 0xFF);
			this.write(0x4015, 0x0F); this.write(0x4015, 0x1F);
			if (this.loopOffset > 0) { this.write(0x4012, this.loopOffset); this.write(0x4013, this.loopLength & 0xFF); }
			this.trig = false;
		}
	}
	clearRegisters() {
		this.write(0x4015, 0x0F); this.write(0x4010, 0); this.write(0x4011, 0); this.write(0x4012, 0); this.write(0x4013, 0);
		this.offset = 0; this.dac = 255;
	}
}

