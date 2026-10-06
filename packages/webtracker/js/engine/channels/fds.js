class ChannelFDS extends FrequencyChannelHandler {
	constructor() {
		super(0xFFF, 32);
		this.modTable = new Uint8Array(32); this.waveTable = new Uint8Array(64);
		this.effModDepth = -1; this.effModSpeedHi = -1; this.effModSpeedLo = -1; this.autoMod = false; this.volModTrigger = false;
		this.modulationDepth = 0; this.modulationSpeed = 0; this.modulationDelay = 0; this.modulationOffset = 0;
		this.volModMode = 0; this.volModRate = 0;
	}
	handleNoteData(nd, effCols) {
		this.effModDepth = -1;
		if (!this.autoMod) { this.effModSpeedHi = -1; this.effModSpeedLo = -1; }
		this.volModTrigger = false;
		ChannelHandler.prototype.handleNoteData.call(this, nd, effCols);
		if (nd.note !== NONE && nd.note !== HALT && nd.note !== RELEASE) this.volModTrigger = true;
		if (this.effModDepth !== -1) this.modulationDepth = this.effModDepth;
		if (this.effModSpeedHi !== -1) this.modulationSpeed = (this.modulationSpeed & 0xFF) | (this.effModSpeedHi << 8);
		if (this.effModSpeedLo !== -1) this.modulationSpeed = (this.modulationSpeed & 0xF00) | this.effModSpeedLo;
	}
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.FDS_MOD_DEPTH:
				if (p < 0x40) this.effModDepth = p;
				else if (p >= 0x80 && this.autoMod) this.effModSpeedHi = p - 0x80;
				break;
			case EF.FDS_MOD_SPEED_HI:
				if (p >= 0x10) { this.effModSpeedHi = p >> 4; this.effModSpeedLo = (p & 0x0F) + 1; this.autoMod = true; }
				else { this.effModSpeedHi = p; if (this.autoMod) this.effModSpeedLo = 0; this.autoMod = false; }
				break;
			case EF.FDS_MOD_SPEED_LO:
				this.effModSpeedLo = p; if (this.autoMod) this.effModSpeedHi = 0; this.autoMod = false; break;
			case EF.FDS_VOLUME:
				if (p < 0x80) { this.volModRate = p & 0x3F; this.volModMode = (p >> 6) + 1; }
				else if (p === 0xE0) this.volModMode = 0;
				break;
			case EF.FDS_MOD_BIAS: this.modulationOffset = p - 0x80; break;
			case EF.PHASE_RESET: if (p === 0) this.write(0x4083, 0x80); break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	calculateVolume() {
		return this.limitVolume(Math.trunc(((this.instVolume + 1) * ((this.volume >> VOL_COLUMN_SHIFT) + 1) - 1) / 16) - this.getTremolo());
	}
	createInstHandler(type) {
		switch (type) {
			case INST_2A03: case INST_VRC6: case INST_N163: case INST_S5B:
				if (!(this.instTypeCurrent === INST_2A03 || this.instTypeCurrent === INST_VRC6 || this.instTypeCurrent === INST_N163 || this.instTypeCurrent === INST_S5B)) {
					this.instHandler = new SeqInstHandler(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true;
				}
				break;
			case INST_FDS:
				if (this.instTypeCurrent !== INST_FDS) { this.instHandler = new SeqInstHandlerFDS(this, 0x1F, 0); return true; }
		}
		return false;
	}
	refreshChannel() {
		const volume = this.calculateVolume();
		if (!this.gate) { this.write(0x4080, 0x80 | volume); return; }
		const carrier = this.calculatePeriod();
		let mlo = this.modulationSpeed & 0xFF, mhi = (this.modulationSpeed >> 8) & 0x0F;
		if (this.autoMod) {
			const fund = this.calculatePeriod(false);
			let mf = Math.trunc(fund * this.effModSpeedHi / this.effModSpeedLo) + this.modulationOffset;
			mf = clamp(mf, 0, 0xFFF);
			mlo = mf & 0xFF; mhi = (mf >> 8) & 0x0F;
		}
		if (this.volModMode) {
			if (this.volModTrigger) { this.volModTrigger = false; this.write(0x4080, 0x80 | volume); }
			this.write(0x4080, ((2 - this.volModMode) << 6) | this.volModRate);
		} else this.write(0x4080, 0x80 | volume);
		this.write(0x4082, carrier & 0xFF);
		this.write(0x4083, (carrier >> 8) & 0x0F);
		if (this.trigger) this.writeModTable();
		if (this.modulationDelay === 0) {
			this.write(0x4086, mlo); this.write(0x4087, mhi); this.write(0x4084, 0x80 | this.modulationDepth);
		} else { this.write(0x4087, 0x80); --this.modulationDelay; }
	}
	clearRegisters() {
		this.write(0x4080, 0x80); this.write(0x4082, 0); this.write(0x4083, 0x80); this.write(0x408A, 0xFF);
		this.write(0x4086, 0); this.write(0x4087, 0); this.write(0x4084, 0);
		this.autoMod = false; this.modulationOffset = 0; this.volModMode = 0; this.volModRate = 0; this.volModTrigger = false;
		this.modTable.fill(0); this.waveTable.fill(0);
	}
	writeModTable() {
		this.write(0x4087, 0x80);
		for (let i = 0; i < 32; ++i) this.write(0x4088, this.modTable[i]);
		this.write(0x4085, 0);
	}
	fillWaveRAM(buf) {
		let diff = false;
		for (let i = 0; i < 64; ++i) if (this.waveTable[i] !== (buf[i] & 0xFF)) { diff = true; this.waveTable[i] = buf[i] & 0xFF; }
		if (!diff) return;
		this.write(0x4089, 0x80);
		for (let i = 0; i < 64; ++i) this.write(0x4040 + i, this.waveTable[i]);
		this.write(0x4089, 0x00);
	}
	fillModulationTable(buf) {
		let diff = false;
		for (let i = 0; i < 32; ++i) if (this.modTable[i] !== (buf[i] & 0xFF)) { diff = true; this.modTable[i] = buf[i] & 0xFF; }
		if (diff) this.writeModTable();
	}
}

