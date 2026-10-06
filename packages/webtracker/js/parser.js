// hopefully plays .ftm/.0cc/.dnm.
// follows ReadBlock_* functions in dnft
function parseModule(buffer, E) {
	const u8 = new Uint8Array(buffer);
	const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
	const EF = E.EF;
	const text = (o, n) => { let s = ''; for (let i = 0; i < n && o + i < u8.length; ++i) s += String.fromCharCode(u8[o + i]); return s; };

	let pos, dn = false;
	if (text(0, 18) === 'FamiTracker Module') pos = 18;
	else if (text(0, 21) === 'Dn-FamiTracker Module') { pos = 21; dn = true; }
	else throw new Error('This is not a FamiTracker, 0CC-FamiTracker or Dn-FamiTracker module.');
	const fileVersion = dv.getUint32(pos, true) & 0xFFFF; pos += 4;
	if (fileVersion < 0x0200) throw new Error('Module version 0x' + fileVersion.toString(16) + ' (FamiTracker 0.2 or older) is not supported.');
	if (fileVersion > 0x0450) throw new Error('Module version 0x' + fileVersion.toString(16) + ' is newer than this player understands.');

	const M = {
		dn, fileVersion, expansion: 0, machine: 0, engineSpeed: 0, vibratoStyle: 1, linearPitch: false,
		speedSplit: 32, namcoChannels: 0, detuneSemitone: 0, detuneCent: 0, detuneTables: null,
		title: '', artist: '', copyright: '', comment: '',
		tracks: [], instruments: new Array(64).fill(null), sequences: {}, samples: new Array(64).fill(null),
		grooves: new Array(32).fill(null), opllPatches: null, highlight: [4, 16], channelIds: [0, 1, 2, 3, 4],
	};
	const tmpSeqs = [];
	let fdsPatternVersion = 99;
	const newTrack = () => ({
		title: '', speed: 6, tempo: 150, rows: 64, frames: [], effCols: new Array(32).fill(0), useGroove: false, patterns: [],
	});
	const track = i => { while (M.tracks.length <= i) M.tracks.push(newTrack()); return M.tracks[i]; };
	if (fileVersion < 0x0210) track(0);

	const seqSlot = (type, st, idx) => {
		const S = M.sequences[type] || (M.sequences[type] = [[], [], [], [], []]);
		return S[st][idx] || (S[st][idx] = { items: [], loop: -1, release: -1, setting: 0 });
	};
	const setLoop = (seq, lp) => { seq.loop = (lp < 0 || lp > seq.items.length) ? -1 : lp; };
	const setRelease = (seq, rp) => { seq.release = (rp < 0 || rp > seq.items.length) ? -1 : rp; };
	const convertOld = (old, type) => {
		const count = old.len.length;
		if (count === 0 || count >= 252) return null;
		let loop = -1, length = 0;
		const items = [];
		for (let i = 0; i < count; ++i) {
			if (old.len[i] < 0) {
				loop = 0;
				for (let x = count + old.len[i] - 1; x < count - 1; ++x) loop += old.len[x] + 1;
			} else {
				for (let l = 0; l < old.len[i] + 1; ++l) { items.push((type === 2 || type === 3) && l ? 0 : old.val[i]); length++; }
			}
		}
		if (loop !== -1) { if (loop > length) loop = length; loop = length - loop; }
		const s = { items, loop: -1, release: -1, setting: 0 };
		setLoop(s, loop);
		return s;
	};

	const R = (o, size) => {
		let p = o; const end = o + size;
		return {
			int() { const v = p + 4 <= end ? dv.getInt32(p, true) : 0; p += 4; return v; },
			char() { const v = p < end ? dv.getInt8(p) : 0; p += 1; return v; },
			uchar() { const v = p < end ? u8[p] : 0; p += 1; return v; },
			bytes(n) { const v = u8.slice(p, Math.min(p + n, end)); p += n; return v; },
			str(n) { let s = ''; for (let i = 0; i < n; ++i) { const c = p + i < end ? u8[p + i] : 0; if (!c) { s += '\0'; } else s += String.fromCharCode(c); } p += n; return s.split('\0')[0]; },
			cstr() { let s = ''; while (p < end) { const c = u8[p++]; if (!c) break; s += String.fromCharCode(c); } return s; },
			done() { return p >= end; },
		};
	};

	const chanCount = () => M.channelIds.length;
	const setupChannels = () => {
		if (M.expansion !== 0) M.machine = 0;
		M.channelIds = E.channelList(M.expansion, M.namcoChannels);
	};

	const B = {};
	B['PARAMS'] = (r, v) => {
		if (v === 1) track(0).speed = r.int(); else M.expansion = r.uchar();
		let channels = r.int();
		M.machine = r.int();
		if (v >= 7) {
			const type = r.int(), rate = r.int();
			M.engineSpeed = type === 1 && rate ? Math.round(1000000 / rate) : 0;
		} else M.engineSpeed = r.int();
		M.vibratoStyle = v > 2 ? r.int() : 0;
		if (v >= 9) r.int();
		if (v > 3 && v <= 6) { M.highlight = [r.int(), r.int()]; }
		if (channels === 5) M.expansion = 0;
		if (fileVersion === 0x0200) { const t = track(0); if (t.speed < 20) t.speed++; }
		if (v === 1) {
			const t = track(0);
			if (t.speed > 19) { t.tempo = t.speed; t.speed = 6; } else t.tempo = M.machine === 0 ? 150 : 125;
		}
		M.namcoChannels = (v >= 5 && (M.expansion & E.SNDCHIP_N163)) ? Math.max(1, Math.min(8, r.int())) : 0;
		M.speedSplit = v >= 6 ? r.int() : 21;
		if (v === 8) { M.detuneSemitone = r.char(); M.detuneCent = r.char(); }
		M.expansion &= 0x3F;
		setupChannels();
	};
	B['INFO'] = r => { M.title = r.str(32); M.artist = r.str(32); M.copyright = r.str(32); };
	B['TUNING'] = (r, v) => { if (v === 1) { M.detuneSemitone = r.char(); M.detuneCent = r.char(); } };
	B['HEADER'] = (r, v) => {
		if (v === 1) {
			const t = track(0);
			for (let i = 0; i < chanCount(); ++i) { r.uchar(); t.effCols[i] = Math.min(3, r.uchar()); }
		} else {
			const count = r.uchar() + 1;
			for (let i = 0; i < count; ++i) track(i);
			if (v >= 3) for (let i = 0; i < count; ++i) M.tracks[i].title = r.cstr();
			for (let i = 0; i < chanCount(); ++i) {
				r.uchar();
				for (let j = 0; j < count; ++j) M.tracks[j].effCols[i] = Math.min(3, r.uchar());
			}
			if (v >= 4) for (let i = 0; i < count; ++i) { const a = r.uchar(), b = r.uchar(); if (i === 0) M.highlight = [a, b]; }
		}
	};
	const loadSeqInst = (r, inst) => {
		r.int();
		inst.seqEnable = []; inst.seqIndex = [];
		for (let i = 0; i < 5; ++i) { inst.seqEnable.push(r.char() !== 0); inst.seqIndex.push(r.uchar() & 0x7F); }
	};
	const loadFDSSeq = r => {
		const count = r.uchar(), loop = r.int(), release = r.int(), setting = r.int();
		const s = { items: [], loop: -1, release: -1, setting };
		for (let i = 0; i < count; ++i) s.items.push(r.char());
		if (s.items.length > 252) s.items.length = 252;
		setLoop(s, loop); setRelease(s, release);
		return s;
	};
	B['INSTRUMENTS'] = (r, v) => {
		const count = r.int();
		for (let i = 0; i < count; ++i) {
			const index = r.int() & 63, type = r.uchar();
			const inst = { type, name: '' };
			switch (type) {
				case E.INST_2A03: {
					loadSeqInst(r, inst);
					inst.dpcm = new Array(96).fill(null);
					const read = flat => {
						let sample = r.char(); if (sample > 64 || sample < 0) sample = 0;
						const pitch = r.char() & 0x8F;
						let delta = 255;
						if (v > 5) { let d = r.char(); if (d < -1) d = -1; delta = d & 0xFF; }
						if (flat >= 0 && flat < 96) inst.dpcm[flat] = { sample, pitch, delta };
					};
					if (v >= 7) {
						const n = r.int();
						for (let k = 0; k < n; ++k) read(r.uchar());
					} else {
						const oct = v === 1 ? 6 : 8;
						for (let o = 0; o < oct; ++o) for (let n = 0; n < 12; ++n) read(o * 12 + n);
					}
					break;
				}
				case E.INST_VRC6: case E.INST_S5B: loadSeqInst(r, inst); break;
				case E.INST_VRC7:
					inst.patch = r.int() & 15; inst.regs = [];
					for (let k = 0; k < 8; ++k) inst.regs.push(r.uchar());
					break;
				case E.INST_FDS: {
					inst.wave = []; inst.mod = [];
					for (let k = 0; k < 64; ++k) inst.wave.push(r.uchar() & 0x3F);
					for (let k = 0; k < 32; ++k) inst.mod.push(r.uchar() & 7);
					inst.modSpeed = r.int() & 0xFFF; inst.modDepth = r.int() & 0x3F; inst.modDelay = r.int() & 0xFF;
					inst.fdsSeqs = [];
					for (let k = 0; k < 3; ++k) {
						if (v > 2 || k < 2) inst.fdsSeqs.push(loadFDSSeq(r));
						else inst.fdsSeqs.push({ items: [], loop: -1, release: -1, setting: 0 });
					}
					if (v <= 3) inst.fdsSeqs[0].items = inst.fdsSeqs[0].items.map(x => x * 2);
					break;
				}
				case E.INST_N163: {
					loadSeqInst(r, inst);
					inst.waveSize = Math.max(4, Math.min(240, r.int()));
					inst.wavePos = r.int() & 0xFF;
					if (v >= 8) r.int();
					inst.waveCount = Math.max(1, Math.min(64, r.int()));
					inst.waves = [];
					for (let w = 0; w < inst.waveCount; ++w) {
						const wave = [];
						for (let k = 0; k < inst.waveSize; ++k) wave.push(r.uchar() & 15);
						inst.waves.push(wave);
					}
					break;
				}
				default: throw new Error('Unknown instrument type ' + type + ' in instrument ' + index.toString(16));
			}
			const len = r.int();
			inst.name = r.str(Math.max(0, Math.min(len, 256)));
			M.instruments[index] = inst;
		}
	};
	const readSeqBlock = (r, v, type, hasSettingsInline) => {
		const count = r.int();
		const idx = [], typ = [];
		for (let i = 0; i < count; ++i) {
			const index = r.int() & 127, st = r.int();
			idx.push(index); typ.push(st);
			const n = r.uchar();
			const seq = seqSlot(type, Math.min(4, Math.max(0, st)), index);
			seq.items = []; seq.loop = -1; seq.release = -1; seq.setting = 0;
			const loop = r.int();
			let release = -1, setting = 0;
			if (hasSettingsInline || v === 4) { release = r.int(); setting = r.int(); }
			for (let k = 0; k < n; ++k) { const val = r.char(); if (k < 252) seq.items.push(val); }
			if (type === E.INST_2A03) { if (loop !== n) setLoop(seq, loop); }
			else setLoop(seq, loop);
			if (hasSettingsInline || v === 4) { setRelease(seq, release); seq.setting = setting; }
		}
		if (!hasSettingsInline) {
			if (v === 5) {
				for (let i = 0; i < 128; ++i) for (let j = 0; j < 5; ++j) {
					const rp = r.int(), st = r.int();
					const S = M.sequences[type];
					const seq = S && S[j][i];
					if (seq && seq.items.length > 0) { setRelease(seq, rp); seq.setting = st; }
				}
			} else if (v >= 6) {
				for (let i = 0; i < count; ++i) {
					const seq = seqSlot(type, Math.min(4, Math.max(0, typ[i])), idx[i]);
					setRelease(seq, r.int()); seq.setting = r.int();
				}
			}
		}
	};
	B['SEQUENCES'] = (r, v) => {
		if (v === 1 || v === 2) {
			const count = r.int();
			for (let i = 0; i < count; ++i) {
				const index = r.int();
				const type = v === 2 ? r.int() : 0;
				const n = r.uchar();
				const old = { len: [], val: [] };
				for (let k = 0; k < n; ++k) { const val = r.char(); old.val.push(val); old.len.push(r.char()); }
				if (v === 1) tmpSeqs.push(old);
				else {
					const s = convertOld(old, type);
					if (s) { const slot = seqSlot(E.INST_2A03, type, index & 127); Object.assign(slot, s); }
				}
			}
			return;
		}
		readSeqBlock(r, v, E.INST_2A03, false);
	};
	B['SEQUENCES_VRC6'] = (r, v) => readSeqBlock(r, v, E.INST_VRC6, false);
	B['SEQUENCES_N163'] = B['SEQUENCES_N106'] = (r, v) => readSeqBlock(r, v, E.INST_N163, true);
	B['SEQUENCES_S5B'] = (r, v) => readSeqBlock(r, v, E.INST_S5B, true);
	B['FRAMES'] = (r, v) => {
		if (v === 1) {
			const frames = r.int(); r.int();
			const t = track(0);
			t.frames = [];
			for (let i = 0; i < frames; ++i) { const f = []; for (let j = 0; j < chanCount(); ++j) f.push(r.uchar()); t.frames.push(f); }
			return;
		}
		for (const t of M.tracks) {
			const frames = r.int(), speed = r.int();
			if (v >= 3) { t.tempo = r.int(); t.speed = speed; }
			else if (speed < 20) { t.tempo = M.machine === 0 ? 150 : 125; t.speed = speed; }
			else { t.tempo = speed; t.speed = 6; }
			t.rows = Math.max(1, Math.min(256, r.int()));
			t.frames = [];
			for (let i = 0; i < frames; ++i) { const f = []; for (let j = 0; j < chanCount(); ++j) f.push(r.uchar()); t.frames.push(f); }
		}
	};
	B['PATTERNS'] = (r, v) => {
		fdsPatternVersion = v;
		if (v === 1) track(0).rows = Math.max(1, r.int());
		const ids = M.channelIds;
		const n163 = !!(M.expansion & E.SNDCHIP_N163);
		while (!r.done()) {
			const t = v > 1 ? track(r.int()) : track(0);
			const ch = r.int(), pat = r.int(), items = r.int();
			if (ch < 0 || ch >= 32 || pat < 0 || pat > 255 || items < 0 || items > 256) throw new Error('Corrupt pattern data');
			const chans = t.patterns[ch] || (t.patterns[ch] = {});
			const rows = chans[pat] || (chans[pat] = []);
			for (let i = 0; i < items; ++i) {
				const row = (fileVersion === 0x0200 || v >= 6) ? r.uchar() : r.int() & 0xFF;
				const nd = { note: r.uchar(), octave: r.uchar(), inst: r.uchar(), vol: r.uchar(), eff: [0, 0, 0, 0], par: [0, 0, 0, 0] };
				if (nd.note > 15) nd.note = 0;
				if (nd.octave > 7) nd.octave = 7;
				if (nd.vol > 16) nd.vol = 16;
				const fx = fileVersion === 0x0200 ? 1 : v >= 6 ? 4 : t.effCols[ch] + 1;
				for (let n = 0; n < fx; ++n) {
					let num = r.uchar();
					if (num) {
						let par = r.uchar();
						if (v < 3) {
							if (num === EF.PORTAOFF) { num = EF.PORTAMENTO; par = 0; }
							else if (num === EF.PORTAMENTO && par < 0xFF) par++;
						}
						if (n < 4) { nd.eff[n] = num < EF.COUNT ? num : 0; nd.par[n] = par; }
					} else if (v < 6) r.uchar();
				}
				if (fileVersion === 0x0200) {
					if (nd.eff[0] === EF.SPEED && nd.par[0] < 20) nd.par[0]++;
					if (nd.vol === 0) nd.vol = 16; else { nd.vol--; nd.vol &= 0x0F; }
					if (nd.note === 0) nd.inst = 64;
				}
				const id = ids[ch];
				if (v === 3) {
					if ((M.expansion & E.SNDCHIP_VRC7) && ch > 4) {
						for (let n = 0; n < 4; ++n) {
							if (nd.eff[n] === EF.PORTA_DOWN) nd.eff[n] = EF.PORTA_UP;
							else if (nd.eff[n] === EF.PORTA_UP) nd.eff[n] = EF.PORTA_DOWN;
						}
					} else if ((M.expansion & E.SNDCHIP_FDS) && id === E.CH_FDS) {
						for (let n = 0; n < 4; ++n) if (nd.eff[n] === EF.PITCH && nd.par[n] !== 0x80) nd.par[n] = (0x100 - nd.par[n]) & 0xFF;
					}
				}
				// FamiTracker 0.5.0 beta effect order!!!
				if (fileVersion < 0x450 || dn) for (let n = 0; n < 4; ++n) nd.eff[n] = EFF_050[nd.eff[n]];
				if (n163 && id >= E.CH_N1 && id < E.CH_FDS)
					for (let n = 0; n < 4; ++n) if (nd.eff[n] === EF.SAMPLE_OFFSET) nd.eff[n] = EF.N163_WAVE_BUFFER;
				rows[row] = nd;
			}
		}
	};
	const EFF_050 = [];
	for (let i = 0; i < EF.COUNT; ++i) EFF_050.push(i);
	[[EF.SUNSOFT_NOISE, EF.NOTE_RELEASE], [EF.VRC7_PORT, EF.GROOVE], [EF.VRC7_WRITE, EF.TRANSPOSE], [EF.NOTE_RELEASE, EF.N163_WAVE_BUFFER],
	[EF.GROOVE, EF.FDS_VOLUME], [EF.TRANSPOSE, EF.FDS_MOD_BIAS], [EF.N163_WAVE_BUFFER, EF.SUNSOFT_NOISE], [EF.FDS_VOLUME, EF.VRC7_PORT],
	[EF.FDS_MOD_BIAS, EF.VRC7_WRITE]].forEach(([a, b]) => { EFF_050[a] = b; });

	B['DPCM SAMPLES'] = r => {
		const count = r.uchar();
		for (let i = 0; i < count; ++i) {
			const index = r.uchar() & 63;
			const nlen = r.int(); r.str(Math.max(0, Math.min(nlen, 256)));
			const size = Math.max(0, Math.min(r.int(), 0x7FFF));
			const trueSize = size + ((1 - size) & 0x0F);
			const data = new Uint8Array(trueSize).fill(0xAA);
			data.set(r.bytes(size));
			M.samples[index] = data;
		}
	};
	B['DETUNETABLES'] = r => {
		const count = r.char();
		M.detuneTables = M.detuneTables || [0, 1, 2, 3, 4, 5].map(() => new Array(96).fill(0));
		for (let i = 0; i < count; ++i) {
			const chip = r.char(), n = r.char();
			for (let j = 0; j < n; ++j) {
				const note = r.char(), off = r.int();
				if (chip >= 0 && chip < 6 && note >= 0 && note < 96) M.detuneTables[chip][note] = off;
			}
		}
	};
	B['GROOVES'] = r => {
		const count = r.char();
		for (let i = 0; i < count; ++i) {
			const index = r.char() & 31, size = r.uchar();
			const g = [];
			for (let j = 0; j < size; ++j) g.push(r.uchar() || 1);
			M.grooves[index] = g;
		}
		const tracks = r.uchar();
		for (let i = 0; i < tracks; ++i) { const use = r.char(); if (i < M.tracks.length) M.tracks[i].useGroove = use === 1; }
	};
	B['PARAMS_EXTRA'] = (r, v) => {
		M.linearPitch = r.int() !== 0;
		if (v >= 2) { M.detuneSemitone = r.char(); M.detuneCent = r.char(); }
	};
	B['PARAMS_EMU'] = r => {
		if (r.int() !== 0) {
			const bytes = [];
			for (let i = 0; i < 19; ++i) { for (let j = 0; j < 8; ++j) bytes.push(r.uchar()); r.cstr(); }
			M.opllPatches = bytes;
		}
	};
	B['COMMENTS'] = r => { r.int(); M.comment = r.cstr(); };

	while (pos + 3 <= u8.length) {
		if (text(pos, 3) === 'END') break;
		if (pos + 24 > u8.length) break;
		const id = text(pos, 16).split('\0')[0];
		const version = dv.getUint32(pos + 16, true), size = dv.getUint32(pos + 20, true);
		pos += 24;
		if (size > 50000000 || pos + size > u8.length) throw new Error('The module is truncated or corrupt (block ' + id + ').');
		const fn = B[id];
		if (fn) {
			try { fn(R(pos, size), version); }
			catch (e) { throw new Error('Could not read the ' + id + ' block: ' + e.message); }
		}
		pos += size;
	}

	// very old modules
	if (fileVersion <= 0x0201 && tmpSeqs.length) {
		const slots = [0, 0, 0, 0, 0];
		const indices = [];
		for (let i = 0; i < 128; ++i) indices.push([-1, -1, -1, -1, -1]);
		for (const inst of M.instruments) {
			if (!inst || inst.type !== E.INST_2A03) continue;
			for (let j = 0; j < 5; ++j) {
				if (inst.seqEnable[j]) {
					const index = inst.seqIndex[j];
					if (indices[index][j] >= 0) inst.seqIndex[j] = indices[index][j];
					else {
						const old = tmpSeqs[index];
						if (!old) continue;
						if (j === 0) old.val = old.val.map(x => Math.max(0, Math.min(15, x)));
						else if (j === 4) old.val = old.val.map(x => Math.max(0, Math.min(3, x)));
						indices[index][j] = slots[j];
						inst.seqIndex[j] = slots[j];
						const s = convertOld(old, j);
						if (s) Object.assign(seqSlot(E.INST_2A03, j, slots[j]), s);
						slots[j]++;
					}
				} else inst.seqIndex[j] = 0;
			}
		}
	}

	if (fdsPatternVersion < 5 && (M.expansion & E.SNDCHIP_FDS)) {
		const ch = M.channelIds.indexOf(E.CH_FDS);
		if (ch >= 0) for (const t of M.tracks) {
			const pats = t.patterns[ch];
			if (!pats) continue;
			for (const k in pats) for (const nd of pats[k]) {
				if (nd && nd.note >= 1 && nd.note <= 12) {
					const m = Math.min(95, nd.octave * 12 + nd.note - 1 + 24);
					nd.note = m % 12 + 1; nd.octave = Math.floor(m / 12);
				}
			}
		}
		for (const inst of M.instruments) {
			if (inst && inst.type === E.INST_FDS) {
				const s = inst.fdsSeqs[1];
				if (s.items.length && s.setting === 1) s.items = s.items.map(x => Math.min(95, x + 24));
			}
		}
	}

	if (!M.tracks.length) throw new Error('The module contains no songs.');
	for (const t of M.tracks) {
		if (!t.frames.length) t.frames.push(new Array(chanCount()).fill(0));
		for (const f of t.frames) while (f.length < chanCount()) f.push(0);
	}
	return M;
}
