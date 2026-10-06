class ChannelS5B extends ChannelHandler {
	constructor() { super(0xFFF, 0x0F); this.envEnabled = false; this.autoEnvShift = 0; this.update = false; this.defaultDuty = S5B_MODE_SQUARE; }
	init(P) { super.init(P); P.s5bShared.defaultNoise = 0; }
	setMode(chan, square, noise) {
		const S = this.P.s5bShared;
		chan -= CH_5B1;
		S.modes &= [0x36, 0x2D, 0x1B][chan];
		S.modes |= (noise << (3 + chan)) | (square << chan);
	}
	updateAutoEnvelope(period) {
		const S = this.P.s5bShared;
		if (this.envEnabled && this.autoEnvShift) {
			if (this.autoEnvShift > 8) { period >>= this.autoEnvShift - 8 - 1; if (period & 1) ++period; period >>= 1; }
			else if (this.autoEnvShift < 8) period <<= 8 - this.autoEnvShift;
			S.envLo = period & 0xFF; S.envHi = (period >> 8) & 0xFF;
		}
	}
	updateRegs() {
		const S = this.P.s5bShared;
		if (S.noiseFreq !== S.noisePrev) { S.noisePrev = S.noiseFreq; this.writeReg(0x06, S.noiseFreq ^ 0x1F); }
		this.writeReg(0x07, S.modes); this.writeReg(0x0B, S.envLo); this.writeReg(0x0C, S.envHi);
		if (S.envTrigger) this.writeReg(0x0D, S.envType);
		S.envTrigger = false;
	}
	handleEffect(cmd, p) {
		const S = this.P.s5bShared;
		switch (cmd) {
			case EF.SUNSOFT_NOISE: S.defaultNoise = S.noiseFreq = p & 0x1F; break;
			case EF.SUNSOFT_ENV_HI: S.envHi = p; break;
			case EF.SUNSOFT_ENV_LO: S.envLo = p; break;
			case EF.SUNSOFT_ENV_TYPE: S.envTrigger = true; S.envType = p & 0x0F; this.update = true; this.envEnabled = p !== 0; this.autoEnvShift = p >> 4; break;
			case EF.DUTY_CYCLE: {
				let d = 0;
				if (p & 1) d |= S5B_MODE_SQUARE; if (p & 2) d |= S5B_MODE_NOISE; if (p & 4) d |= S5B_MODE_ENVELOPE;
				this.defaultDuty = this.dutyPeriod = d; break;
			}
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	handleNote(note, octave) {
		super.handleNote(note, octave);
		const S = this.P.s5bShared;
		if (this.defaultDuty & S5B_MODE_NOISE) S.noiseFreq = S.defaultNoise;
	}
	handleCut() { this.cutNote(); this.dutyPeriod = S5B_MODE_SQUARE; this.note = 0; }
	createInstHandler(type) {
		if (this.seqFamily(type)) { this.instHandler = new SeqInstHandlerS5B(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true; }
		return false;
	}
	writeReg(r, v) { this.write(0xC000, r); this.write(0xE000, v & 0xFF); }
	resetChannel() {
		super.resetChannel();
		const S = this.P.s5bShared;
		this.defaultDuty = this.dutyPeriod = S5B_MODE_SQUARE;
		S.defaultNoise = S.noiseFreq = 0; S.noisePrev = -1;
		this.envEnabled = false; this.autoEnvShift = 0;
		S.envHi = 0; S.envLo = 0; S.envType = 0; S.envTrigger = false;
	}
	calculateVolume() { return this.limitVolume((this.volume >> VOL_COLUMN_SHIFT) + this.instVolume - 15 - this.getTremolo()); }
	convertDuty(d) {
		switch (this.instTypeCurrent) { case INST_2A03: case INST_VRC6: case INST_N163: return S5B_MODE_SQUARE; default: return d; }
	}
	clearRegisters() { this.writeReg(8 + this.chanId - CH_5B1, 0); }
	setNoiseFreq(p) { this.P.s5bShared.noiseFreq = p; }
	refreshChannel() {
		const S = this.P.s5bShared;
		const period = this.calculatePeriod(), volume = this.calculateVolume();
		const noise = (this.gate && (this.dutyPeriod & S5B_MODE_NOISE)) ? 0 : 1;
		const square = (this.gate && (this.dutyPeriod & S5B_MODE_SQUARE)) ? 0 : 1;
		const env = (this.gate && (this.dutyPeriod & S5B_MODE_ENVELOPE)) ? 0x10 : 0;
		this.updateAutoEnvelope(period);
		this.setMode(this.chanId, square, noise);
		const c = this.chanId - CH_5B1;
		this.writeReg(c * 2, period & 0xFF); this.writeReg(c * 2 + 1, period >> 8); this.writeReg(c + 8, volume | env);
		if (env && (this.trigger || this.update)) S.envTrigger = true;
		this.update = false;
		if (this.chanId === CH_5B3) this.updateRegs();
	}
}

function makeChannel(id) {
	if (id === CH_SQ1 || id === CH_SQ2) return new Square2A03();
	if (id === CH_TRI) return new Triangle2A03();
	if (id === CH_NOI) return new Noise2A03();
	if (id === CH_DPCM) return new DPCM2A03();
	if (id === CH_V6P1 || id === CH_V6P2) return new SquareVRC6();
	if (id === CH_SAW) return new SawVRC6();
	if (id === CH_M5P1 || id === CH_M5P2) return new SquareMMC5();
	if (id >= CH_N1 && id < CH_FDS) return new ChannelN163();
	if (id === CH_FDS) return new ChannelFDS();
	if (id >= CH_FM1 && id <= CH_FM6) return new ChannelVRC7();
	return new ChannelS5B();
}

