function buildInstruments(mod) {
	const empty = { items: [], loop: -1, release: -1, setting: 0 };
	const seqColl = {};
	const getSeq = (type, st, idx) => {
		const k = type + ':' + st + ':' + idx;
		if (!seqColl[k]) {
			const s = mod.sequences[type] && mod.sequences[type][st] && mod.sequences[type][st][idx];
			seqColl[k] = s || { items: [], loop: -1, release: -1, setting: 0 };
		}
		return seqColl[k];
	};
	return mod.instruments.map(src => {
		if (!src) return null;
		const inst = Object.assign({}, src);
		if (src.type === INST_FDS) {
			inst.hasSeq = true;
			inst.getSeq = i => i < 3 ? src.fdsSeqs[i] || empty : null;
			inst.seqEnabled = i => i < 3;
		} else if (src.type === INST_VRC7) {
			inst.hasSeq = false;
		} else {
			inst.hasSeq = true;
			inst.getSeq = i => getSeq(src.type, i, src.seqIndex[i]);
			inst.seqEnabled = i => !!src.seqEnable[i];
		}
		return inst;
	});
}

const NEW_VIBRATO_DEPTH = [1.0, 1.5, 2.5, 4.0, 5.0, 7.0, 10.0, 12.0, 14.0, 17.0, 22.0, 30.0, 44.0, 64.0, 96.0, 128.0];
const OLD_VIBRATO_DEPTH = [1.0, 1.0, 2.0, 3.0, 4.0, 7.0, 8.0, 15.0, 16.0, 31.0, 32.0, 63.0, 64.0, 127.0, 128.0, 255.0];
const db = x => Math.pow(10, x / 20);

class Player {
	constructor(mod, sampleRate) {
		this.mod = mod; this.sr = sampleRate;
		this.instruments = buildInstruments(mod);
		this.pal = mod.machine === 1 && !mod.expansion;
		this.clock = this.pal ? CLK_PAL : CLK_NTSC;
		this.frameRate = mod.engineSpeed || (this.pal ? 50 : 60);
		this.updateCycles = Math.floor(this.clock / this.frameRate);
		this.cyclesPerSample = this.clock / sampleRate;
		this.chip = mod.expansion;

		// vibrato table
		this.vibTable = new Int32Array(256);
		for (let i = 0; i < 16; ++i) for (let j = 0; j < 16; ++j) {
			const angle = (j / 16) * (3.1415 / 2);
			this.vibTable[i * 16 + j] = mod.vibratoStyle === 1 ? Math.trunc(Math.sin(angle) * NEW_VIBRATO_DEPTH[i]) : Math.trunc(j * OLD_VIBRATO_DEPTH[i] / 16 + 1);
		}
		this.buildNoteTables();

		// chips
		this.apu = new APU2A03(this.pal);
		this.vrc6 = (this.chip & SNDCHIP_VRC6) ? new VRC6Chip() : null;
		this.mmc5 = (this.chip & SNDCHIP_MMC5) ? new MMC5Chip() : null;
		this.fds = (this.chip & SNDCHIP_FDS) ? new FDSChip() : null;
		this.n163 = (this.chip & SNDCHIP_N163) ? new N163Chip() : null;
		this.s5b = (this.chip & SNDCHIP_S5B) ? new S5BChip() : null;
		this.vrc7 = (this.chip & SNDCHIP_VRC7) ? new VRC7Chip(sampleRate, mod.opllPatches) : null;
		this.vrc7Shared = { dirty: false, patchFlag: 0, regs: new Uint8Array(8) };
		this.s5bShared = { modes: 0, noiseFreq: 0, noisePrev: -1, defaultNoise: 0, envHi: 0, envLo: 0, envTrigger: false, envType: 0 };

		// dnft legacy mix
		let att = 1.0;
		if (this.chip & SNDCHIP_VRC6) att *= 0.80;
		if (this.chip & SNDCHIP_VRC7) att *= 0.64;
		if (this.chip & SNDCHIP_FDS) att *= 0.90;
		if (this.chip & SNDCHIP_MMC5) att *= 0.83;
		if (this.chip & SNDCHIP_N163) att *= 0.70;
		if (this.chip & SNDCHIP_S5B) att *= 0.50;
		this.gApu1 = att; this.gApu2 = att * db(-0.65);
		this.gVRC6 = att * db(12.15) / 500;
		this.gMMC5 = att * db(1.06);
		this.gFDS = att * db(4.43) / (256 * 1152);
		this.gS5B = att * db(0.89) / 1200;
		this.gVRC7 = db(9.72) / 32768;
		const nc = mod.namcoChannels || 1;
		const n163v = (nc - 1) === 0 ? 1.3 : (1.5 + (nc - 1) / 1.5);
		this.gN163 = att * n163v * 1.1 * db(0.25) / (1600 * nc);
		this.fdsAlpha = 1 - Math.exp(-2 * Math.PI * 2000 / sampleRate);
		this.fdsLP = 0;
		this.hpPrevIn = 0; this.hpPrevOut = 0; this.hpR = Math.exp(-2 * Math.PI * 16 / sampleRate);
		this.masterVolume = 1;

		// channels
		this.channelIds = channelList(this.chip, mod.namcoChannels);
		this.channels = this.channelIds.map(id => {
			const c = makeChannel(id);
			c.init(this);
			c.setChannelID(id);
			c.noteTable = this.noteTableFor(id);
			c.newVib = mod.vibratoStyle === 1;
			c.linearPitch = !!mod.linearPitch;
			if (c instanceof ChannelN163) c.channels = mod.namcoChannels;
			return c;
		});
		this.muted = this.channelIds.map(() => false);
		this.playing = false; this.ended = false;
		this.track = 0; this.onRow = null; this.onEnd = null;
		this.frameLeft = 0; this.sampleFrac = 0;
	}
	buildNoteTables() {
		const m = this.mod, A440 = 45 - (m.detuneSemitone || 0) - (m.detuneCent || 0) / 100;
		const f = n => 440 * Math.pow(2, (n - A440) / 12);
		const off = (c, i) => (m.detuneTables && m.detuneTables[c] && m.detuneTables[c][i]) || 0;
		const NT = new Int32Array(96), PL = new Int32Array(96), SAW = new Int32Array(96), V7 = new Int32Array(12),
			FD = new Int32Array(96), N1 = new Int32Array(96), S5 = new Int32Array(96);
		const nn = m.namcoChannels || 1;
		for (let i = 0; i < 96; ++i) {
			NT[i] = Math.round(Math.round(CLK_NTSC / (f(i) * 16) - 1) - off(0, i));
			PL[i] = Math.round(Math.round(CLK_PAL / (f(i) * 16) - 1) - off(1, i));
			SAW[i] = Math.round(Math.round(CLK_NTSC / (f(i) * 14) - 1) - off(2, i));
			if (i < 12) V7[i] = Math.round(Math.round(f(i) * Math.pow(2, 18) / (CLK_VRC7 / 72)) + off(3, i));
			FD[i] = Math.round(Math.round(f(i) * 65536 * 16 / CLK_NTSC) + off(4, i));
			N1[i] = Math.min(0xFFFF, Math.round(Math.round(f(i) * 15 * 262144 * nn / CLK_NTSC) + off(5, i)));
			S5[i] = Math.round(Math.round(CLK_NTSC / (f(i) * 16)) - off(0, i));
		}
		this.tables = { NT, PL, SAW, V7, FD, N1, S5 };
	}
	noteTableFor(id) {
		const T = this.tables;
		if (id <= CH_TRI) return this.pal ? T.PL : T.NT;
		if (id === CH_V6P1 || id === CH_V6P2 || id === CH_M5P1 || id === CH_M5P2) return T.NT;
		if (id === CH_SAW) return T.SAW;
		if (id >= CH_FM1 && id <= CH_FM6) return T.V7;
		if (id === CH_FDS) return T.FD;
		if (id >= CH_N1 && id < CH_FDS) return T.N1;
		if (id >= CH_5B1) return T.S5;
		return null;
	}
	write(a, v) {
		// CAPU::Write sends every write to every chip so do the same
		v &= 0xFF;
		if (a >= 0x4000 && a <= 0x4017) { this.apu.write(a, v); return; }
		if (a >= 0x4040 && a <= 0x408A) { if (this.fds) this.fds.write(a, v); return; }
		if (a >= 0x5000 && a <= 0x5015) { if (this.mmc5) this.mmc5.write(a, v); return; }
		if (a === 0x9010 || a === 0x9030) { if (this.vrc7) this.vrc7.write(a, v); return; }
		if (a >= 0x9000 && a <= 0xB002 && (a & 0x0FFF) <= 2) { if (this.vrc6) this.vrc6.write(a, v); return; }
		const hi = a & 0xF800;
		if (this.n163 && (hi === 0x4800 || hi === 0xE000 || hi === 0xF800)) this.n163.write(a, v);
		if (this.s5b && (a === 0xC000 || a === 0xE000)) this.s5b.write(a, v);
	}
	resetAll() {
		this.apu.reset();
		if (this.vrc6) this.vrc6.reset(); if (this.mmc5) this.mmc5.reset(); if (this.fds) this.fds.reset();
		if (this.n163) this.n163.reset(); if (this.s5b) this.s5b.reset();
		if (this.vrc7) this.vrc7 = new VRC7Chip(this.sr, this.mod.opllPatches);
		this.vrc7Shared.dirty = false; this.vrc7Shared.patchFlag = 0; this.vrc7Shared.regs.fill(0);
		this.write(0x4015, 0x0F); this.write(0x4017, 0x00);
		if (this.mmc5) this.write(0x5015, 0x03);
		for (const c of this.channels) c.resetChannel();
	}
	setupSpeed() {
		if (this.tempo) { this.tempoDecrement = Math.trunc(this.tempo * 24 / this.speed); this.tempoRemainder = (this.tempo * 24) % this.speed; }
		else { this.tempoDecrement = 1; this.tempoRemainder = 0; }
	}
	groove(i) { const g = this.mod.grooves && this.mod.grooves[i]; return g && g.length ? g : null; }
	start(track, frame) {
		const T = this.mod.tracks[track];
		this.track = track; this.T = T;
		this.resetAll();
		this.playFrame = Math.min(frame || 0, T.frames.length - 1); this.playRow = 0;
		this.speed = T.speed; this.tempo = T.tempo; this.tempoAccum = 0;
		if (T.useGroove && this.groove(this.speed)) { this.grooveIndex = this.speed; this.groovePos = 0; this.speed = this.groove(this.grooveIndex)[0]; }
		else { this.grooveIndex = -1; if (T.useGroove) this.speed = DEFAULT_SPEED; }
		if (!this.speed) this.speed = DEFAULT_SPEED;
		this.setupSpeed();
		this.jumpTo = -1; this.skipTo = -1; this.doHalt = false; this.haltRequest = false; this.updateRow = false;
		this.queued = this.channels.map(() => null);
		this.playing = true; this.ended = false;
		this.frameLeft = 0;
	}
	stop() {
		this.playing = false;
		for (const c of this.channels) c.resetChannel();
	}
	evaluateGlobalEffects(nd, effCols) {
		for (let i = 0; i < effCols; ++i) {
			let p = nd.par[i];
			switch (nd.eff[i]) {
				case EF.SPEED:
					if (!p) ++p;
					if (this.tempo && p >= (this.mod.speedSplit)) this.tempo = p;
					else { this.speed = p; this.grooveIndex = -1; }
					this.setupSpeed();
					break;
				case EF.GROOVE: {
					const g = this.groove(p % MAX_GROOVE);
					if (!g) break;
					this.grooveIndex = p % MAX_GROOVE; this.speed = g[0]; this.groovePos = 1; this.setupSpeed();
					break;
				}
				case EF.JUMP: this.jumpTo = p; break;
				case EF.SKIP: this.skipTo = p; break;
				case EF.HALT: this.doHalt = true; break;
				default: continue;
			}
			nd.eff[i] = EF.NONE; nd.par[i] = 0;
		}
	}
	readPatternRow() {
		const T = this.T, f = this.playFrame, r = this.playRow;
		for (let i = 0; i < this.channels.length; ++i) {
			const pat = T.frames[f][i];
			const src = T.patterns[i] && T.patterns[i][pat] && T.patterns[i][pat][r];
			const nd = src ? { note: src.note, octave: src.octave, vol: src.vol, inst: src.inst, eff: src.eff.slice(), par: src.par.slice() }
				: { note: 0, octave: 0, vol: MAX_VOLUME, inst: MAX_INSTRUMENTS, eff: [0, 0, 0, 0], par: [0, 0, 0, 0] };
			let valid = true;
			if (this.muted[i]) {
				const PASS = [EF.HALT, EF.JUMP, EF.SPEED, EF.SKIP, EF.GROOVE, EF.VRC7_PORT, EF.VRC7_WRITE, EF.N163_WAVE_BUFFER,
					EF.SUNSOFT_ENV_HI, EF.SUNSOFT_ENV_LO, EF.SUNSOFT_ENV_TYPE, EF.SUNSOFT_NOISE];
				nd.note = HALT; nd.octave = 0; nd.inst = 0; valid = false;
				const cols = T.effCols[i] + 1;
				for (let j = 0; j < cols; ++j) { if (PASS.includes(nd.eff[j])) valid = true; else nd.eff[j] = EF.NONE; }
			}
			if (valid) this.queued[i] = nd;
		}
		if (this.doHalt) this.haltRequest = true;
		if (this.onRow) this.onRow(f, r);
	}
	stepRow() {
		if (++this.playRow >= this.T.rows) { this.playRow = 0; this.stepFrame(); }
	}
	stepFrame() { if (++this.playFrame >= this.T.frames.length) this.playFrame = 0; }
	checkControl() {
		if (this.doHalt) return;
		if (this.jumpTo !== -1) { this.playFrame = Math.min(this.jumpTo, this.T.frames.length - 1); this.playRow = 0; }
		else if (this.skipTo !== -1) {
			if (++this.playFrame >= this.T.frames.length) this.playFrame = 0;
			this.playRow = Math.min(this.skipTo, this.T.rows - 1);
		}
		else while (this.stepRows-- > 0) this.stepRow();
		this.jumpTo = -1; this.skipTo = -1;
	}
	tick() {
		if (this.playing) {
			this.stepRows = 0;
			if (this.tempoAccum <= 0) {
				if (this.grooveIndex !== -1 && this.groove(this.grooveIndex)) {
					const g = this.groove(this.grooveIndex);
					this.speed = g[this.groovePos % g.length]; this.setupSpeed(); this.groovePos++;
				}
				this.stepRows++;
				this.updateRow = true;
				this.readPatternRow();
			} else this.updateRow = false;
		}
		// play notes in channel order
		for (let i = 0; i < this.channels.length; ++i) {
			const nd = this.queued && this.queued[i];
			if (nd) { this.queued[i] = null; this.channels[i].playNote(nd, this.T.effCols[i] + 1); }
		}
		if (this.updateRow && !this.haltRequest && this.playing) this.checkControl();
		if (this.playing) {
			if (this.tempoAccum <= 0) this.tempoAccum += (this.tempo ? 60 * this.frameRate : this.speed) - this.tempoRemainder;
			this.tempoAccum -= this.tempoDecrement;
		}
		for (const c of this.channels) { if (this.haltRequest) c.resetChannel(); else c.processChannel(); }
		for (const c of this.channels) { c.refreshChannel(); c.finishTick(); }
		if (this.onTick) this.onTick();
		if (this.haltRequest) {
			this.playing = false; this.haltRequest = false; this.doHalt = false; this.ended = true;
			for (const c of this.channels) c.resetChannel();
			if (this.onEnd) this.onEnd();
		}
	}
	// 0-15 level vu meter
	levels() {
		return this.channels.map(c => {
			if (!c.gate || this.muted[this.channels.indexOf(c)]) return 0;
			if (c instanceof Triangle2A03) return c.instVolume > 0 && c.volume > 0 ? 15 : 0;
			if (c instanceof DPCM2A03) { const d = this.apu.dmc; return (d.remain > 0 || !d.silence) ? 15 : 0; }
			if (c instanceof ChannelFDS) return c.calculateVolume() >> 1;
			if (c instanceof SawVRC6) return (c.calculateVolume() & 0x3F) >> 2;
			return Math.min(15, c.calculateVolume());
		});
	}
	runChips(n) {
		const a = this.apu;
		a.run(n);
		let s = a.area1 * this.gApu1 + a.area2 * this.gApu2;
		if (this.vrc6) s += this.vrc6.run(n) * this.gVRC6;
		if (this.mmc5) s += this.mmc5.run(n) * this.gMMC5;
		if (this.n163) s += this.n163.run(n) * this.gN163;
		if (this.s5b) s += this.s5b.run(n) * this.gS5B;
		if (this.fds) this.fdsArea += this.fds.run(n) * this.gFDS;
		return s;
	}
	render(out, n) {
		for (let k = 0; k < n; ++k) {
			this.renderPos = k;
			this.sampleFrac += this.cyclesPerSample;
			let need = Math.floor(this.sampleFrac);
			this.sampleFrac -= need;
			const total = need;
			let area = 0;
			this.fdsArea = 0;
			while (need > 0) {
				if (this.frameLeft <= 0) {
					if (this.playing) this.tick();
					this.frameLeft = this.updateCycles;
				}
				const c = Math.min(need, this.frameLeft);
				area += this.runChips(c);
				need -= c; this.frameLeft -= c;
			}
			let s = total ? area / total : 0;
			if (this.fds) { this.fdsLP += this.fdsAlpha * ((total ? this.fdsArea / total : 0) - this.fdsLP); s += this.fdsLP; }
			if (this.vrc7) s += this.vrc7.sample() * this.gVRC7;
			// dc blocker
			const y = s - this.hpPrevIn + this.hpR * this.hpPrevOut;
			this.hpPrevIn = s; this.hpPrevOut = y;
			let o = y * this.masterVolume;
			if (o > 1) o = 1; else if (o < -1) o = -1;
			out[k] = o;
		}
	}
}

