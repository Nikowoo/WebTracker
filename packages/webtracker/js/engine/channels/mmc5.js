class SquareMMC5 extends ChannelHandler {
	constructor() { super(0x7FF, 0x0F); this.hwEnv = false; this.envLoop = true; this.resetEnv = false; this.lengthCounter = 1; this.lastPeriod = 0xFFFF; }
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
			case EF.PHASE_RESET:
				if (p === 0) this.write(0x5000 + (this.chanId - CH_M5P1) * 4 + 3, (this.calculatePeriod() >> 8) + (this.lengthCounter << 3));
				break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	createInstHandler(type) {
		if (this.seqFamily(type)) { this.instHandler = new SeqInstHandler(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true; }
		return false;
	}
	resetChannel() { super.resetChannel(); this.envLoop = true; this.hwEnv = false; this.lengthCounter = 1; }
	refreshChannel() {
		const period = this.calculatePeriod(), volume = this.calculateVolume(), duty = this.dutyPeriod & 3;
		const lo = period & 0xFF, hi = period >> 8, A = 0x5000 + 4 * (this.chanId - CH_M5P1);
		this.write(0x5015, 0x03);
		if (this.gate) this.write(A, (duty << 6) | ((this.envLoop ? 1 : 0) << 5) | ((this.hwEnv ? 0 : 1) << 4) | volume);
		else { this.write(A, 0x30); this.lastPeriod = 0xFFFF; return; }
		this.write(A + 2, lo);
		if (hi !== (this.lastPeriod >> 8) || this.resetEnv) this.write(A + 3, hi + (this.lengthCounter << 3));
		this.lastPeriod = period; this.resetEnv = false;
	}
	convertDuty(d) {
		switch (this.instTypeCurrent) { case INST_VRC6: return DUTY_2A03_FROM_VRC6[d & 7]; case INST_S5B: return 2; default: return d; }
	}
	clearRegisters() {
		const A = 0x5000 + 4 * (this.chanId - CH_M5P1);
		this.write(A, 0x30); this.write(A + 2, 0); this.write(A + 3, 0); this.lastPeriod = 0xFFFF;
	}
}

