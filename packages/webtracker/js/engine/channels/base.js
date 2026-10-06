class ChannelHandler {
	constructor(maxPeriod, maxVolume) {
		this.maxPeriod = maxPeriod; this.maxVolume = maxVolume;
		this.chanId = 0; this.instTypeCurrent = INST_NONE; this.instrument = 0; this.noteTable = null; this.instHandler = null;
		this.pitch = 0; this.note = 0; this.instVolume = 0; this.defaultDuty = 0; this.dutyPeriod = 0;
		this.gate = false; this.newVib = false; this.linearPitch = false; this.forceReload = false;
		this.effectParam = 0; this.volSlideTarget = -1; this.delayEnabled = false; this.delayCounter = 0; this.delayed = null; this.delayEffCols = 1;
		this.echo = [ECHO_NONE, ECHO_NONE, ECHO_NONE, ECHO_NONE];
		this.volume = VOL_COLUMN_MAX; this.defaultVolume = 0x78; this.period = 0; this.effect = 0;
		this.trigger = false; this.release = false;
	}
	init(P) { this.P = P; }
	setChannelID(id) { this.chanId = id; }
	write(a, v) { this.P.write(a, v); }
	resetChannel() {
		this.instrument = MAX_INSTRUMENTS; this.instTypeCurrent = INST_NONE; this.instHandler = null;
		this.volume = VOL_COLUMN_MAX; this.defaultVolume = (VOL_COLUMN_MAX >> VOL_COLUMN_SHIFT) << VOL_COLUMN_SHIFT;
		this.defaultDuty = 0; this.dutyPeriod = 0; this.instVolume = 0;
		this.note = 0; this.period = 0;
		this.effect = EF.NONE; this.effectParam = 0;
		this.portaSpeed = 0; this.portaTo = 0; this.arpState = 0; this.vibratoSpeed = 0; this.vibratoPhase = this.newVib ? 0 : 48;
		this.tremoloSpeed = 0; this.tremoloPhase = 0; this.finePitch = 0x80; this.volSlide = 0; this.volSlideTarget = -1;
		this.delayEnabled = false; this.noteCut = 0; this.noteRelease = 0; this.noteVolume = -1; this.newVolume = this.defaultVolume;
		this.transpose = 0; this.transposeDown = false; this.transposeTarget = 0; this.harmonic = 1;
		this.vibratoDepth = 0; this.tremoloDepth = 0;
		this.echo = [ECHO_NONE, ECHO_NONE, ECHO_NONE, ECHO_NONE];
		this.trigger = false; this.release = false; this.gate = false;
		this.clearRegisters();
	}
	clearRegisters() { }
	// instrument handlers call this
	setVolume(v) { this.instVolume = v; }
	getVolume() { return this.instVolume; }
	setPeriod(p) { this.period = this.limitPeriod(p); }
	getPeriod() { return this.period; }
	setNote(n) { this.note = n; }
	getNote() { return this.note; }
	setDutyPeriod(d) { this.dutyPeriod = this.convertDuty(d); }
	getDutyPeriod() { return this.dutyPeriod; }
	convertDuty(d) { return d; }
	isActive() { return this.gate; }
	isReleasing() { return this.release; }
	getArpParam() { return this.effect === EF.ARPEGGIO ? this.effectParam : 0; }

	playNote(nd, effCols) {
		this.P.evaluateGlobalEffects(nd, effCols);
		if (this.handleDelay(nd, effCols)) return;
		this.handleNoteData(nd, effCols);
	}
	writeEchoBuffer(nd, pos, effCols) {
		let value;
		switch (nd.note) {
			case NONE: value = ECHO_NONE; break;
			case HALT: value = ECHO_HALT; break;
			case ECHO: value = ECHO_ECHO + nd.octave; break;
			default:
				value = MIDI_NOTE(nd.octave, nd.note);
				for (let i = effCols - 1; i >= 0; --i) {
					const p = nd.par[i] & 0x0F;
					if (nd.eff[i] === EF.SLIDE_UP) { value += p; break; }
					else if (nd.eff[i] === EF.SLIDE_DOWN) { value -= p; break; }
					else if (nd.eff[i] === EF.TRANSPOSE) { value += (nd.par[i] & 0x80) ? -p : p; break; }
				}
				value = clamp(value, 0, NOTE_COUNT - 1);
		}
		this.echo[pos] = value;
	}
	handleNoteData(nd, effCols) {
		const lastInstrument = this.instrument;
		let instrument = nd.inst;
		const trigger = nd.note !== NONE && nd.note !== HALT && nd.note !== RELEASE && instrument !== HOLD_INSTRUMENT;
		let pushNone = false, handledTVS = false;
		if (nd.note === ECHO && nd.octave <= ECHO_BUFFER_LENGTH) {
			const nn = this.echo[nd.octave];
			if (nn === ECHO_NONE) { nd.note = NONE; pushNone = true; }
			else if (nn === ECHO_HALT) nd.note = HALT;
			else { nd.note = GET_NOTE(nn); nd.octave = GET_OCTAVE(nn); }
		}
		if ((nd.note !== RELEASE && nd.note !== NONE) || pushNone) {
			for (let i = ECHO_BUFFER_LENGTH; i > 0; --i) this.echo[i] = this.echo[i - 1];
			this.writeEchoBuffer(nd, 0, effCols);
		}
		if (nd.note !== NONE) {
			this.noteCut = 0; this.noteRelease = 0;
			if (trigger && this.noteVolume === 0 && !this.volSlide) { this.volume = this.defaultVolume; this.noteVolume = -1; }
			this.transpose = 0;
		}
		if (trigger && (this.effect === EF.SLIDE_UP || this.effect === EF.SLIDE_DOWN)) this.effect = EF.NONE;
		for (let n = 0; n < effCols; ++n) {
			const en = nd.eff[n], ep = nd.par[n];
			this.handleEffect(en, ep);
			if (en === EF.VOLUME_SLIDE && !ep && trigger && this.noteVolume === 0) { this.volume = this.defaultVolume; this.noteVolume = -1; }
			else if (en === EF.TARGET_VOLUME_SLIDE) handledTVS = true;
		}
		if (nd.vol < MAX_VOLUME) {
			this.volume = nd.vol << VOL_COLUMN_SHIFT;
			this.defaultVolume = this.volume;
			if (!handledTVS && this.volSlideTarget >= 0) { this.volSlide = 0; this.volSlideTarget = -1; }
		}
		if (nd.note === HALT || nd.note === RELEASE) instrument = MAX_INSTRUMENTS;
		if (instrument !== MAX_INSTRUMENTS && instrument !== HOLD_INSTRUMENT) this.instrument = instrument;
		const newInstrument = (this.instrument !== lastInstrument && this.instrument !== HOLD_INSTRUMENT) ||
			this.instrument === MAX_INSTRUMENTS || this.forceReload;
		switch (nd.note) {
			case NONE: case HALT: case RELEASE: break;
			default: this.note = this.runNote(nd.octave, nd.note);
		}
		switch (nd.note) {
			case NONE: this.handleEmptyNote(); break;
			case HALT: this.release = false; this.handleCut(); break;
			case RELEASE: this.handleRelease(); break;
			default: this.handleNote(nd.note, nd.octave);
		}
		if (trigger && (this.effect === EF.SLIDE_DOWN || this.effect === EF.SLIDE_UP)) this.setupSlide();
		if ((newInstrument || trigger) && this.instrument !== MAX_INSTRUMENTS) this.handleInstrument(trigger, newInstrument);
		this.forceReload = false;
	}
	handleInstrument(trigger, newInstrument) {
		const inst = this.P.instruments[this.instrument];
		if (!inst) return false;
		if (newInstrument) this.createInstHandler(inst.type);
		this.instTypeCurrent = inst.type;
		if (!this.instHandler) return false;
		if (newInstrument) this.instHandler.loadInstrument(inst);
		if (trigger || this.forceReload) this.instHandler.triggerInstrument();
		return true;
	}
	createInstHandler(type) { return false; }
	seqFamily(type, s5bAllowed) {
		// CreateInstHandler same for every sequence based channel
		const fam = t => t === INST_2A03 || t === INST_VRC6 || t === INST_N163 || t === INST_S5B || t === INST_FDS;
		return fam(type) && !fam(this.instTypeCurrent);
	}
	triggerNote(note) {
		note = clamp(note, 0, NOTE_COUNT - 1);
		if (this.linearPitch) return note << LINEAR_PITCH_AMOUNT;
		if (!this.noteTable) return note;
		return this.noteTable[note];
	}
	finishTick() { this.trigger = false; }
	cutNote() { this.gate = false; this.period = 0; this.portaTo = 0; }
	releaseNote() { if (this.instHandler) this.instHandler.releaseInstrument(); this.release = true; }
	runNote(octave, note) {
		const newNote = MIDI_NOTE(octave, note);
		const nesFreq = this.triggerNote(newNote);
		if (this.portaSpeed > 0 && this.effect === EF.PORTAMENTO && this.gate) {
			if (this.period === 0) this.period = nesFreq;
			this.portaTo = nesFreq;
		} else this.period = nesFreq;
		this.gate = true;
		return newNote;
	}
	handleNote(note, octave) { this.dutyPeriod = this.defaultDuty; this.trigger = true; this.release = false; }
	setupSlide() {
		const sp = x => ((x & 0xF0) >> 3) + 1;
		switch (this.effect) {
			case EF.PORTAMENTO:
				this.portaSpeed = this.effectParam;
				if (this.gate) this.portaTo = this.triggerNote(this.note);
				break;
			case EF.SLIDE_UP:
				this.note = this.note + (this.effectParam & 0xF); this.portaSpeed = sp(this.effectParam); this.portaTo = this.triggerNote(this.note); break;
			case EF.SLIDE_DOWN:
				this.note = this.note - (this.effectParam & 0xF); this.portaSpeed = sp(this.effectParam); this.portaTo = this.triggerNote(this.note); break;
		}
	}
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.PORTAMENTO: this.effectParam = p; this.effect = EF.PORTAMENTO; this.setupSlide(); if (!p) this.portaTo = 0; break;
			case EF.VIBRATO: this.vibratoDepth = (p & 0x0F) << 4; this.vibratoSpeed = p >> 4; if (!p) this.vibratoPhase = !this.newVib ? 48 : 0; break;
			case EF.TREMOLO: this.tremoloDepth = (p & 0x0F) << 4; this.tremoloSpeed = p >> 4; if (!p) this.tremoloPhase = 0; break;
			case EF.ARPEGGIO: this.effectParam = p; this.effect = EF.ARPEGGIO; break;
			case EF.PITCH: this.finePitch = p; break;
			case EF.PORTA_DOWN: this.portaSpeed = p; this.effectParam = p; this.effect = EF.PORTA_DOWN; break;
			case EF.PORTA_UP: this.portaSpeed = p; this.effectParam = p; this.effect = EF.PORTA_UP; break;
			case EF.SLIDE_UP: this.effectParam = p; this.effect = EF.SLIDE_UP; this.setupSlide(); break;
			case EF.SLIDE_DOWN: this.effectParam = p; this.effect = EF.SLIDE_DOWN; this.setupSlide(); break;
			case EF.VOLUME_SLIDE: this.volSlide = p; this.volSlideTarget = -1; if (!p) this.defaultVolume = this.volume; break;
			case EF.NOTE_CUT: if (p >= 0x80) return false; this.noteCut = p + 1; break;
			case EF.NOTE_RELEASE: if (p >= 0x80) return false; this.noteRelease = p + 1; break;
			case EF.DELAYED_VOLUME:
				if (!(p >> 4) || !(p & 0xF)) break;
				this.noteVolume = (p >> 4) + 1; this.newVolume = (p & 0x0F) << VOL_COLUMN_SHIFT; break;
			case EF.TRANSPOSE:
				this.transpose = ((p & 0x70) >> 4) + 1; this.transposeTarget = p & 0x0F; this.transposeDown = (p & 0x80) !== 0; break;
			case EF.HARMONIC: this.harmonic = p; break;
			case EF.TARGET_VOLUME_SLIDE:
				if (p) { this.volSlide = (p & 0xF0) >> 4; this.volSlideTarget = (p & 0x0F) << VOL_COLUMN_SHIFT; }
				else { this.volSlide = 0; this.volSlideTarget = -1; this.defaultVolume = this.volume; }
				break;
			default: return false;
		}
		return true;
	}
	handleDelay(nd, effCols) {
		if (this.delayEnabled) { this.delayEnabled = false; this.handleNoteData(this.delayed, this.delayEffCols); }
		for (let i = 0; i < effCols; ++i) {
			if (nd.eff[i] === EF.DELAY && nd.par[i] > 0) {
				this.delayEnabled = true; this.delayCounter = nd.par[i]; this.delayEffCols = effCols;
				for (let j = 0; j < effCols; ++j) if (nd.eff[j] === EF.DELAY) { nd.eff[j] = EF.NONE; nd.par[j] = 0; }
				this.delayed = { note: nd.note, octave: nd.octave, vol: nd.vol, inst: nd.inst, eff: nd.eff.slice(), par: nd.par.slice() };
				return true;
			}
		}
		return false;
	}
	updateNoteCut() { if (this.noteCut > 0 && !--this.noteCut) this.handleCut(); }
	updateNoteRelease() { if (this.noteRelease > 0 && !--this.noteRelease) { this.handleRelease(); this.releaseNote(); } }
	updateNoteVolume() {
		if (this.noteVolume > 0 && !--this.noteVolume) {
			this.volume = this.newVolume;
			if (this.volSlideTarget >= 0) { this.volSlideTarget = -1; this.volSlide = 0; }
		}
	}
	updateTranspose() {
		if (this.transpose > 0 && !--this.transpose) {
			this.setNote(this.note + this.transposeTarget * (this.transposeDown ? -1 : 1));
			this.setPeriod(this.triggerNote(this.note));
		}
	}
	updateDelay() {
		if (this.delayEnabled) {
			if (!this.delayCounter) { this.delayEnabled = false; this.playNote(this.delayed, this.delayEffCols); }
			else --this.delayCounter;
		}
	}
	updateVolumeSlide() {
		this.volume -= this.volSlide & 0x0F; if (this.volume < 0) this.volume = 0;
		this.volume += (this.volSlide & 0xF0) >> 4; if (this.volume > VOL_COLUMN_MAX) this.volume = VOL_COLUMN_MAX;
	}
	updateTargetVolumeSlide() {
		if (this.volume > this.volSlideTarget) {
			this.volume -= this.volSlide & 0x0F;
			if (this.volume <= this.volSlideTarget) { this.volume = this.volSlideTarget; this.volSlide = 0; this.volSlideTarget = -1; }
		} else {
			this.volume += this.volSlide & 0x0F;
			if (this.volume >= this.volSlideTarget) { this.volume = this.volSlideTarget; this.volSlide = 0; this.volSlideTarget = -1; }
		}
	}
	updateEffects() {
		switch (this.effect) {
			case EF.ARPEGGIO:
				if (this.effectParam !== 0) {
					switch (this.arpState) {
						case 0: this.setPeriod(this.triggerNote(this.note)); break;
						case 1: this.setPeriod(this.triggerNote(this.note + (this.effectParam >> 4))); if ((this.effectParam & 0x0F) === 0) ++this.arpState; break;
						case 2: this.setPeriod(this.triggerNote(this.note + (this.effectParam & 0x0F))); break;
					}
					this.arpState = (this.arpState + 1) % 3;
				}
				break;
			case EF.PORTAMENTO: case EF.SLIDE_UP: case EF.SLIDE_DOWN:
				if (this.portaSpeed > 0 && this.portaTo) {
					if (this.period > this.portaTo) {
						this.setPeriod(this.period - this.portaSpeed);
						if (this.period <= this.portaTo) {
							this.setPeriod(this.portaTo);
							if (this.effect !== EF.PORTAMENTO) { this.portaTo = 0; this.portaSpeed = 0; this.effect = EF.NONE; }
						}
					} else if (this.period < this.portaTo) {
						this.setPeriod(this.period + this.portaSpeed);
						if (this.period >= this.portaTo) {
							this.setPeriod(this.portaTo);
							if (this.effect !== EF.PORTAMENTO) { this.portaTo = 0; this.portaSpeed = 0; this.effect = EF.NONE; }
						}
					}
				}
				break;
			case EF.PORTA_DOWN: this.setPeriod(this.period + (this.linearPitch ? -this.portaSpeed : this.portaSpeed)); break;
			case EF.PORTA_UP: this.setPeriod(this.period + (this.linearPitch ? this.portaSpeed : -this.portaSpeed)); break;
		}
	}
	processChannel() {
		this.updateDelay();
		this.updateNoteCut();
		this.updateNoteRelease();
		this.updateNoteVolume();
		this.updateTranspose();
		if (this.volSlideTarget < 0) this.updateVolumeSlide(); else this.updateTargetVolumeSlide();
		this.vibratoPhase = (this.vibratoPhase + this.vibratoSpeed) & 63;
		this.tremoloPhase = (this.tremoloPhase + this.tremoloSpeed) & 63;
		this.updateEffects();
		if (this.instHandler) this.instHandler.updateInstrument();
	}
	getVibrato() {
		const T = this.P.vibTable, ph = this.vibratoPhase, d = this.vibratoDepth;
		let v;
		switch (ph & 0xF0) {
			case 0x00: v = T[d + ph]; break;
			case 0x10: v = T[d + 15 - (ph - 16)]; break;
			case 0x20: v = -T[d + (ph - 32)]; break;
			default: v = -T[d + 15 - (ph - 48)]; break;
		}
		if (!this.newVib) { v += T[d + 15] + 1; v >>= 1; }
		return v;
	}
	getTremolo() {
		const T = this.P.vibTable, ph = this.tremoloPhase >> 1, d = this.tremoloDepth;
		let v = 0;
		if ((ph & 0xF0) === 0x00) v = T[d + ph];
		else if ((ph & 0xF0) === 0x10) v = T[d + 15 - (ph - 16)];
		return v >> 1;
	}
	getFinePitch() { return 0x80 - this.finePitch; }
	calculatePeriod(mult = true) {
		const detune = this.getVibrato() - this.getFinePitch();
		let period;
		if (this.linearPitch && this.noteTable) {
			period = this.limitPeriod(this.period + detune);
			const note = period >> LINEAR_PITCH_AMOUNT, sub = period % (1 << LINEAR_PITCH_AMOUNT);
			let off = note < NOTE_COUNT - 1 ? this.noteTable[note] - this.noteTable[note + 1] : 0;
			off = (off * sub) >> LINEAR_PITCH_AMOUNT;
			if (sub && !off) off = 1;
			period = this.noteTable[note] - off;
		} else period = this.period - detune;
		if (mult) { if (this.harmonic > 0) period = Math.trunc(period / this.harmonic); else period = this.maxPeriod; }
		return this.limitRawPeriod(period);
	}
	calculateVolume() {
		return this.limitVolume(Math.trunc((this.instVolume * (this.volume >> VOL_COLUMN_SHIFT)) / 15) - this.getTremolo());
	}
	limitPeriod(p) {
		if (!this.linearPitch) return this.limitRawPeriod(p);
		return clamp(p, 0, (NOTE_COUNT - 1) << LINEAR_PITCH_AMOUNT);
	}
	limitRawPeriod(p) { return clamp(p, 0, this.maxPeriod); }
	limitVolume(v) {
		if (!this.gate) return 0;
		v = clamp(v, 0, this.maxVolume);
		if (v === 0 && this.instVolume > 0 && this.volume > 0) return 1;
		return v;
	}
	handleEmptyNote() { }
	handleCut() { this.cutNote(); }
	handleRelease() { if (!this.release) this.releaseNote(); }
	refreshChannel() { }
}

class FrequencyChannelHandler extends ChannelHandler {
	handleEffect(cmd, p) {
		if (!this.linearPitch) { if (cmd === EF.PORTA_UP) cmd = EF.PORTA_DOWN; else if (cmd === EF.PORTA_DOWN) cmd = EF.PORTA_UP; }
		return super.handleEffect(cmd, p);
	}
	calculatePeriod(mult = true) {
		let f = this.period + this.getVibrato() - this.getFinePitch();
		if (this.linearPitch && this.noteTable) {
			f = this.limitPeriod(f);
			const note = f >> LINEAR_PITCH_AMOUNT, sub = f % (1 << LINEAR_PITCH_AMOUNT);
			let off = note < NOTE_COUNT - 1 ? this.noteTable[note + 1] - this.noteTable[note] : 0;
			off = (off * sub) >> LINEAR_PITCH_AMOUNT;
			if (sub && !off) off = 1;
			f = this.noteTable[note] + off;
		}
		if (mult) f *= this.harmonic;
		return this.limitRawPeriod(f);
	}
}

