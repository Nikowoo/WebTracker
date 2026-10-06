const VRC7_PITCH_RESOLUTION = 2;
const CMD_NONE = 0, CMD_NOTE_ON = 1, CMD_NOTE_TRIGGER = 2, CMD_NOTE_HALT = 4, CMD_NOTE_RELEASE = 5;
class ChannelVRC7 extends FrequencyChannelHandler {
	constructor() {
		super((1 << (VRC7_PITCH_RESOLUTION + 9)) - 1, 15);
		this.command = CMD_NONE; this.hold = true; this.octave = -1; this.oldOctave = -1; this.patch = -1; this.customPort = 0; this.idx = 0;
	}
	setChannelID(id) { this.chanId = id; this.idx = id - CH_FM1; }
	setPatch(p) { this.dutyPeriod = p; }
	setCustomReg(i, v) { const S = this.P.vrc7Shared; if (!(S.patchFlag & (1 << i))) S.regs[i] = v; }
	handleNoteData(nd, effCols) {
		super.handleNoteData(nd, effCols);
		if (this.command === CMD_NOTE_TRIGGER && nd.inst === HOLD_INSTRUMENT) this.command = CMD_NOTE_ON;
	}
	handleEffect(cmd, p) {
		const S = this.P.vrc7Shared;
		switch (cmd) {
			case EF.DUTY_CYCLE: this.patch = p; break;
			case EF.VRC7_PORT: this.customPort = p & 7; break;
			case EF.VRC7_WRITE: S.regs[this.customPort] = p; S.patchFlag |= 1 << this.customPort; S.dirty = true; break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	handleCut() { this.gate = false; this.command = CMD_NOTE_HALT; }
	updateNoteRelease() { if (this.noteRelease > 0) { if (--this.noteRelease === 0) this.handleRelease(); } }
	handleRelease() { if (!this.release) this.command = CMD_NOTE_RELEASE; }
	handleNote(note, octave) {
		ChannelHandler.prototype.handleNote.call(this, note, octave);
		this.hold = true;
		if (this.portaSpeed > 0 && this.effect === EF.PORTAMENTO && this.command !== CMD_NOTE_HALT && this.command !== CMD_NOTE_RELEASE) this.correctOctave();
		else this.command = CMD_NOTE_TRIGGER;
	}
	runNote(octave, note) {
		const newNote = MIDI_NOTE(octave, note);
		const f = this.triggerNote(newNote);
		if (this.portaSpeed > 0 && this.effect === EF.PORTAMENTO && this.gate) {
			if (this.period === 0) { this.period = f; this.oldOctave = this.octave = octave; }
			this.portaTo = f;
		} else { this.period = f; this.portaTo = 0; this.oldOctave = this.octave = octave; }
		this.gate = true;
		this.correctOctave();
		return newNote;
	}
	createInstHandler(type) {
		if (type === INST_VRC7) { if (this.instTypeCurrent !== INST_VRC7) this.instHandler = new InstHandlerVRC7(this); return true; }
		return false;
	}
	setupSlide() { super.setupSlide(); this.correctOctave(); }
	correctOctave() {
		if (this.linearPitch) return;
		if (this.oldOctave === -1) { this.oldOctave = this.octave; return; }
		const off = this.octave - this.oldOctave;
		if (off > 0) { this.period >>= off; this.oldOctave = this.octave; }
		else if (off < 0) { this.portaTo >>= -off; this.octave = this.oldOctave; }
	}
	triggerNote(note) {
		if (this.command !== CMD_NOTE_TRIGGER && this.command !== CMD_NOTE_HALT) this.command = CMD_NOTE_ON;
		this.octave = Math.trunc(note / NOTE_RANGE);
		return this.linearPitch ? (note << LINEAR_PITCH_AMOUNT) : this.getFnum(note);
	}
	getFnum(note) { return this.noteTable[((note % NOTE_RANGE) + NOTE_RANGE) % NOTE_RANGE] << VRC7_PITCH_RESOLUTION; }
	calculateVolume() { return clamp((this.volume >> VOL_COLUMN_SHIFT) - this.getTremolo(), 0, 15); }
	calculatePeriod() {
		const detune = this.getVibrato() - this.getFinePitch();
		let period = this.limitPeriod(this.period + (detune << VRC7_PITCH_RESOLUTION));
		if (this.linearPitch && this.noteTable) {
			period = this.limitPeriod(this.period + detune);
			const note = (period >> LINEAR_PITCH_AMOUNT) % NOTE_RANGE, sub = period % (1 << LINEAR_PITCH_AMOUNT);
			let off = (this.getFnum(note + 1) << (note < NOTE_RANGE - 1 ? 0 : 1)) - this.getFnum(note);
			off = (off * sub) >> LINEAR_PITCH_AMOUNT;
			if (sub && off < (1 << VRC7_PITCH_RESOLUTION)) off = 1 << VRC7_PITCH_RESOLUTION;
			period = this.getFnum(note) + off;
		}
		return this.limitRawPeriod(period) >> VRC7_PITCH_RESOLUTION;
	}
	refreshChannel() {
		const S = this.P.vrc7Shared;
		const volume = this.calculateVolume(), fnum = this.calculatePeriod();
		const bnum = !this.linearPitch ? this.octave :
			Math.trunc(((this.period + this.getVibrato() - this.getFinePitch()) >> LINEAR_PITCH_AMOUNT) / NOTE_RANGE);
		if (this.patch !== -1) { this.dutyPeriod = this.patch; this.patch = -1; }
		if ((this.dutyPeriod === 0 && this.command === CMD_NOTE_TRIGGER) || S.dirty)
			for (let i = 0; i < 8; ++i) this.regWrite(i, S.regs[i]);
		S.dirty = false;
		if (!this.gate) this.command = CMD_NOTE_HALT;
		let cmd = 0;
		switch (this.command) {
			case CMD_NOTE_TRIGGER: this.regWrite(0x20 + this.idx, 0); this.command = CMD_NOTE_ON; cmd = 0x30; break;
			case CMD_NOTE_ON: cmd = this.hold ? 0x10 : 0x20; break;
			case CMD_NOTE_HALT: cmd = 0; break;
			case CMD_NOTE_RELEASE: cmd = 0x20; break;
		}
		this.regWrite(0x10 + this.idx, fnum & 0xFF);
		if (this.command !== CMD_NOTE_HALT) this.regWrite(0x30 + this.idx, ((this.dutyPeriod << 4) | (volume ^ 0x0F)) & 0xFF);
		this.regWrite(0x20 + this.idx, (((fnum >> 8) & 1) | ((bnum & 7) << 1) | cmd) & 0xFF);
		if (this.chanId === CH_FM6) S.patchFlag = 0;
	}
	clearRegisters() {
		this.regWrite(0x10 + this.idx, 0); this.regWrite(0x20 + this.idx, 0); this.regWrite(0x30 + this.idx, 0x0F);
		this.note = 0; this.octave = this.oldOctave = -1; this.patch = -1; this.effect = EF.NONE; this.command = CMD_NOTE_HALT; this.customPort = 0;
	}
	regWrite(r, v) { this.write(0x9010, r); this.write(0x9030, v); }
}

