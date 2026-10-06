const SEQ_STATE_DISABLED = 0, SEQ_STATE_RUNNING = 1, SEQ_STATE_END = 2, SEQ_STATE_HALT = 3;

class SeqInstHandler {
	constructor(iface, vol, duty) {
		this.iface = iface; this.volume = vol; this.defaultVolume = vol; this.defaultDuty = duty;
		this.seq = [null, null, null, null, null]; this.state = [0, 0, 0, 0, 0]; this.ptr = [0, 0, 0, 0, 0];
		this.inst = null;
	}
	loadInstrument(inst) {
		this.inst = inst;
		if (!inst.hasSeq) return;
		for (let i = 0; i < 5; ++i) {
			const seq = inst.getSeq(i);
			if (!inst.seqEnabled(i)) this.clearSeq(i);
			else if (seq !== this.seq[i] || this.state[i] === SEQ_STATE_DISABLED) this.setupSeq(i, seq);
		}
	}
	triggerInstrument() {
		for (let i = 0; i < 5; ++i) if (this.seq[i]) { this.state[i] = SEQ_STATE_RUNNING; this.ptr[i] = 0; }
		this.volume = this.defaultVolume;
		if (this.iface.isActive()) this.iface.setVolume(this.defaultVolume);
	}
	releaseInstrument() {
		if (this.iface.isReleasing()) return;
		for (let i = 0; i < 5; ++i) {
			const s = this.seq[i];
			if (s && (this.state[i] === SEQ_STATE_RUNNING || this.state[i] === SEQ_STATE_END)) {
				if (s.release !== -1) { this.ptr[i] = s.release; this.state[i] = SEQ_STATE_RUNNING; }
			}
		}
	}
	updateInstrument() {
		const I = this.iface;
		if (!I.isActive()) return;
		for (let i = 0; i < 5; ++i) {
			const s = this.seq[i];
			if (!s || s.items.length === 0) continue;
			switch (this.state[i]) {
				case SEQ_STATE_RUNNING: {
					this.processSequence(i, s.setting, s.items[this.ptr[i]] | 0);
					++this.ptr[i];
					const Release = s.release, Items = s.items.length, Loop = s.loop;
					if (this.ptr[i] === Release + 1 || this.ptr[i] >= Items) {
						if (Loop !== -1 && !(I.isReleasing() && Release !== -1) && Loop < Release) this.ptr[i] = Loop;
						else if (this.ptr[i] >= Items) {
							if (Loop >= Release && Loop !== -1) this.ptr[i] = Loop;
							else this.state[i] = SEQ_STATE_END;
						}
						else if (!I.isReleasing()) --this.ptr[i];
					}
					break;
				}
				case SEQ_STATE_END:
					if (i === SEQ_ARPEGGIO && s.setting === 1) I.setPeriod(I.triggerNote(I.getNote()));
					this.state[i] = SEQ_STATE_HALT;
					break;
			}
		}
	}
	processSequence(index, setting, value) {
		const I = this.iface;
		switch (index) {
			case SEQ_VOLUME: I.setVolume(value); return true;
			case SEQ_ARPEGGIO:
				switch (setting) {
					case 0: I.setPeriod(I.triggerNote(I.getNote() + value)); return true;
					case 1: I.setPeriod(I.triggerNote(value)); return true;
					case 2: I.setNote(I.getNote() + value); I.setPeriod(I.triggerNote(I.getNote())); return true;
					case 3: {
						if (value < 0) value += 256;
						let lim = value % 0x40; const scheme = Math.floor(value / 0x40);
						if (lim > ARPSCHEME_MAX) lim -= 64;
						const param = I.getArpParam();
						switch (scheme) { case 1: lim += param >> 4; break; case 2: lim += param & 0x0F; break; case 3: lim -= param & 0x0F; break; }
						I.setPeriod(I.triggerNote(I.getNote() + lim));
						return true;
					}
				}
				return false;
			case SEQ_PITCH:
				switch (setting) {
					case 0: I.setPeriod(I.getPeriod() + value); return true;
					case 1: I.setPeriod(I.triggerNote(I.getNote()) + value); return true;
				}
				return false;
			case SEQ_HIPITCH: I.setPeriod(I.getPeriod() + (value << 4)); return true;
			case SEQ_DUTYCYCLE: I.setDutyPeriod(value); return true;
		}
		return false;
	}
	setupSeq(i, seq) { this.state[i] = SEQ_STATE_RUNNING; this.ptr[i] = 0; this.seq[i] = seq; }
	clearSeq(i) { this.state[i] = SEQ_STATE_DISABLED; this.ptr[i] = 0; this.seq[i] = null; }
}

class SeqInstHandlerSawtooth extends SeqInstHandler {
	triggerInstrument() {
		super.triggerInstrument();
		this.ignoreDuty = this.seq[SEQ_VOLUME] !== null && this.seq[SEQ_VOLUME].setting === 1;
	}
}

class SeqInstHandlerS5B extends SeqInstHandler {
	processSequence(index, setting, value) {
		if (index === SEQ_DUTYCYCLE) {
			this.iface.setDutyPeriod(value & 0xE0);
			if (value & S5B_MODE_NOISE) this.iface.setNoiseFreq(value & 0x1F);
			return true;
		}
		return super.processSequence(index, setting, value);
	}
}

class SeqInstHandlerFDS extends SeqInstHandler {
	loadInstrument(inst) { super.loadInstrument(inst); if (inst.type === INST_FDS) this.updateTables(inst); }
	triggerInstrument() {
		super.triggerInstrument();
		const inst = this.inst;
		if (!inst || inst.type !== INST_FDS) return;
		this.iface.modulationSpeed = inst.modSpeed;
		this.iface.modulationDepth = inst.modDepth;
		this.iface.modulationDelay = inst.modDelay;
		this.updateTables(inst);
	}
	updateInstrument() { super.updateInstrument(); if (this.inst && this.inst.type === INST_FDS) this.updateTables(this.inst); }
	updateTables(inst) { this.iface.fillWaveRAM(inst.wave); this.iface.fillModulationTable(inst.mod); }
}

class SeqInstHandlerN163 extends SeqInstHandler {
	constructor(iface, vol, duty) { super(iface, vol, duty); this.bufCur = new Int16Array(240); this.bufPrev = new Int16Array(240); this.force = false; }
	loadInstrument(inst) {
		super.loadInstrument(inst);
		if (inst.type !== INST_N163) return;
		this.iface.waveLen = inst.waveSize; this.iface.wavePosOld = inst.wavePos; this.iface.waveCount = inst.waveCount;
		this.force = true;
	}
	triggerInstrument() { super.triggerInstrument(); this.force = true; }
	updateInstrument() {
		super.updateInstrument();
		if (this.inst && this.inst.type === INST_N163) this.updateWave(this.inst);
		this.force = false;
	}
	updateWave(inst) {
		const t = this.bufPrev; this.bufPrev = this.bufCur; this.bufCur = t;
		let index = this.iface.getDutyPeriod() & 0xFF;
		if (index >= inst.waveCount) index = inst.waveCount - 1;
		const count = inst.waveSize >> 1, w = inst.waves[index];
		let changed = this.force;
		for (let i = 0; i < count; ++i) {
			this.bufCur[i] = (w[2 * i] | (w[2 * i + 1] << 4)) & 0xFF;
			if (this.bufCur[i] !== this.bufPrev[i]) changed = true;
		}
		if (changed) this.iface.fillWaveRAM(this.bufCur, count);
	}
}

class InstHandlerDPCM {
	constructor(iface) { this.iface = iface; this.inst = null; }
	loadInstrument(inst) { this.inst = inst; }
	triggerInstrument() {
		const inst = this.inst;
		if (!inst || inst.type !== INST_2A03) return;
		const val = this.iface.getNote();
		if (val < 0 || val >= NOTE_COUNT) return;
		const a = inst.dpcm[val];
		if (!a || !a.sample) return;
		const samp = this.iface.P.mod.samples[a.sample - 1];
		if (!samp) return;
		this.iface.writeDCOffset(a.delta);
		this.iface.setLoopOffset(0);
		this.iface.playSample(samp, a.pitch);
	}
	releaseInstrument() { }
	updateInstrument() { }
}

class InstHandlerVRC7 {
	constructor(iface) { this.iface = iface; this.inst = null; this.update = false; }
	loadInstrument(inst) { this.inst = inst; this.update = true; }
	triggerInstrument() { this.update = true; }
	releaseInstrument() { }
	updateInstrument() {
		if (!this.update) return;
		const inst = this.inst;
		if (!inst || inst.type !== INST_VRC7) return;
		this.iface.setPatch(inst.patch);
		if (!inst.patch) for (let i = 0; i < 8; ++i) this.iface.setCustomReg(i, inst.regs[i]);
		this.update = false;
	}
}

