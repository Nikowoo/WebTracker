const VRC7_PATCH_NUKE = [
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x21, 0x05, 0x06, 0xE8, 0x81, 0x42, 0x27,
	0x13, 0x41, 0x14, 0x0D, 0xD8, 0xF6, 0x23, 0x12, 0x11, 0x11, 0x08, 0x08, 0xFA, 0xB2, 0x20, 0x12,
	0x31, 0x61, 0x0C, 0x07, 0xA8, 0x64, 0x61, 0x27, 0x32, 0x21, 0x1E, 0x06, 0xE1, 0x76, 0x01, 0x28,
	0x02, 0x01, 0x06, 0x00, 0xA3, 0xE2, 0xF4, 0xF4, 0x21, 0x61, 0x1D, 0x07, 0x82, 0x81, 0x11, 0x07,
	0x23, 0x21, 0x22, 0x17, 0xA2, 0x72, 0x01, 0x17, 0x35, 0x11, 0x25, 0x00, 0x40, 0x73, 0x72, 0x01,
	0xB5, 0x01, 0x0F, 0x0F, 0xA8, 0xA5, 0x51, 0x02, 0x17, 0xC1, 0x24, 0x07, 0xF8, 0xF8, 0x22, 0x12,
	0x71, 0x23, 0x11, 0x06, 0x65, 0x74, 0x18, 0x16, 0x01, 0x02, 0xD3, 0x05, 0xC9, 0x95, 0x03, 0x02,
	0x61, 0x63, 0x0C, 0x00, 0x94, 0xC0, 0x33, 0xF6, 0x21, 0x72, 0x0D, 0x00, 0xC1, 0xD5, 0x56, 0x06,
	0x01, 0x01, 0x18, 0x0F, 0xDF, 0xF8, 0x6A, 0x6D, 0x01, 0x01, 0x00, 0x00, 0xC8, 0xD8, 0xA7, 0x68,
	0x05, 0x01, 0x00, 0x00, 0xF8, 0xAA, 0x59, 0x55,
];
const OPLL = (() => {
	const PG_BITS = 10, PG_WIDTH = 1024, DP_BITS = 19, DP_WIDTH = 1 << DP_BITS, DP_BASE_BITS = DP_BITS - PG_BITS;
	const EG_MUTE = 127, EG_MAX = 123, EG_STEP = 0.375, DAMPER_RATE = 12;
	const ATTACK = 0, DECAY = 1, SUSTAIN = 2, REL = 3, DAMP = 4;
	const UPDATE_WS = 1, UPDATE_TLL = 2, UPDATE_RKS = 4, UPDATE_EG = 8, UPDATE_ALL = 255;
	const exp_table = new Uint16Array(256);
	for (let x = 0; x < 256; ++x) exp_table[x] = Math.round((Math.pow(2, x / 256) - 1) * 1024);
	const fullsin = new Uint16Array(PG_WIDTH), halfsin = new Uint16Array(PG_WIDTH);
	for (let x = 0; x < PG_WIDTH / 4; ++x) fullsin[x] = Math.round(-Math.log2(Math.sin((x + 0.5) * Math.PI / (PG_WIDTH / 4) / 2)) * 256);
	for (let x = 0; x < PG_WIDTH / 4; ++x) fullsin[PG_WIDTH / 4 + x] = fullsin[PG_WIDTH / 4 - x - 1];
	for (let x = 0; x < PG_WIDTH / 2; ++x) fullsin[PG_WIDTH / 2 + x] = 0x8000 | fullsin[x];
	for (let x = 0; x < PG_WIDTH / 2; ++x) halfsin[x] = fullsin[x];
	for (let x = PG_WIDTH / 2; x < PG_WIDTH; ++x) halfsin[x] = 0xfff;
	const waveMap = [fullsin, halfsin];
	const pm_table = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, -1, 0], [0, 1, 2, 1, 0, -1, -2, -1], [0, 1, 3, 1, 0, -1, -3, -1],
		[0, 2, 4, 2, 0, -2, -4, -2], [0, 2, 5, 2, 0, -2, -5, -2], [0, 3, 6, 3, 0, -3, -6, -3], [0, 3, 7, 3, 0, -3, -7, -3]];
	const am_table = [];
	for (let v = 0; v <= 12; ++v) for (let k = 0; k < 8; ++k) am_table.push(v);
	am_table.push(13, 13, 13);
	for (let v = 12; v >= 1; --v) for (let k = 0; k < 8; ++k) am_table.push(v);
	for (let k = 0; k < 7; ++k) am_table.push(0);
	const eg_step = [[0, 1, 0, 1, 0, 1, 0, 1], [0, 1, 0, 1, 1, 1, 0, 1], [0, 1, 1, 1, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 1]];
	const ml_table = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
	const kl_table = [0, 9, 12, 13.875, 15, 16.125, 16.875, 17.625, 18, 18.75, 19.125, 19.5, 19.875, 20.25, 20.625, 21].map(x => x * 2);
	const tll_table = new Uint32Array(128 * 64 * 4);
	for (let fnum = 0; fnum < 16; ++fnum) for (let block = 0; block < 8; ++block) for (let TL = 0; TL < 64; ++TL) for (let KL = 0; KL < 4; ++KL) {
		const idx = ((((block << 4) | fnum) * 64) + TL) * 4 + KL;
		if (KL === 0) tll_table[idx] = TL << 1;
		else {
			const tmp = Math.trunc(kl_table[fnum] - 6 * (7 - block));
			tll_table[idx] = tmp <= 0 ? TL << 1 : Math.trunc((tmp >> (3 - KL)) / EG_STEP) + (TL << 1);
		}
	}
	const rks_table = [];
	for (let i = 0; i < 16; ++i) rks_table.push([i >> 2, i]);  // [(block<<1)|fnum8][KR]

	const mkPatch = () => ({ AM: 0, PM: 0, EG: 0, KR: 0, ML: 0, KL: 0, TL: 0, WS: 0, FB: 0, AR: 0, DR: 0, SL: 0, RR: 0 });
	const dumpToPatch = (d, o, p0, p1) => {
		p0.AM = (d[o] >> 7) & 1; p1.AM = (d[o + 1] >> 7) & 1; p0.PM = (d[o] >> 6) & 1; p1.PM = (d[o + 1] >> 6) & 1;
		p0.EG = (d[o] >> 5) & 1; p1.EG = (d[o + 1] >> 5) & 1; p0.KR = (d[o] >> 4) & 1; p1.KR = (d[o + 1] >> 4) & 1;
		p0.ML = d[o] & 15; p1.ML = d[o + 1] & 15; p0.KL = (d[o + 2] >> 6) & 3; p1.KL = (d[o + 3] >> 6) & 3;
		p0.TL = d[o + 2] & 63; p1.TL = 0; p0.FB = d[o + 3] & 7; p1.FB = 0;
		p0.WS = (d[o + 3] >> 3) & 1; p1.WS = (d[o + 3] >> 4) & 1;
		p0.AR = (d[o + 4] >> 4) & 15; p1.AR = (d[o + 5] >> 4) & 15; p0.DR = d[o + 4] & 15; p1.DR = d[o + 5] & 15;
		p0.SL = (d[o + 6] >> 4) & 15; p1.SL = (d[o + 7] >> 4) & 15; p0.RR = d[o + 6] & 15; p1.RR = d[o + 7] & 15;
	};

	class Slot {
		constructor(n) {
			this.number = n; this.type = n % 2; this.wave = fullsin; this.pg_phase = 0; this.out0 = 0; this.out1 = 0;
			this.eg_state = REL; this.eg_shift = 0; this.rks = 0; this.tll = 0; this.key_flag = 0; this.sus_flag = 0;
			this.blk_fnum = 0; this.blk = 0; this.fnum = 0; this.volume = 0; this.pg_out = 0; this.eg_out = EG_MUTE;
			this.patch = mkPatch(); this.upd = 0; this.eg_rate_h = 0; this.eg_rate_l = 0;
		}
	}
	class Chip {
		constructor(patchBytes) {
			this.patch = []; for (let i = 0; i < 38; ++i) this.patch.push(mkPatch());
			const d = patchBytes || VRC7_PATCH_NUKE;
			for (let i = 0; i < 19; ++i) dumpToPatch(d, i * 8, this.patch[i * 2], this.patch[i * 2 + 1]);
			this.reset();
		}
		reset() {
			this.reg = new Uint8Array(0x40); this.pm_phase = 0; this.am_phase = 0; this.lfo_am = 0; this.eg_counter = 0;
			this.slot_key_status = 0; this.test_flag = 0;
			this.slot = []; for (let i = 0; i < 12; ++i) this.slot.push(new Slot(i));
			this.patch_number = [0, 0, 0, 0, 0, 0];
			for (let i = 0; i < 6; ++i) this.setPatch(i, 0);
			for (let i = 0; i < 0x40; ++i) this.writeReg(i, 0);
			this.chOut = new Int16Array(6);
		}
		commit(s) {
			if (s.upd & UPDATE_WS) s.wave = waveMap[s.patch.WS];
			if (s.upd & UPDATE_TLL) s.tll = tll_table[(((s.blk_fnum >> 5) * 64) + ((s.type & 1) === 0 ? s.patch.TL : s.volume)) * 4 + s.patch.KL];
			if (s.upd & UPDATE_RKS) s.rks = rks_table[s.blk_fnum >> 8][s.patch.KR];
			if (s.upd & (UPDATE_RKS | UPDATE_EG)) {
				const p = this.paramRate(s);
				if (p === 0) { s.eg_shift = 0; s.eg_rate_h = 0; s.eg_rate_l = 0; s.upd = 0; return; }
				s.eg_rate_h = Math.min(15, p + (s.rks >> 2)); s.eg_rate_l = s.rks & 3;
				if (s.eg_state === ATTACK) s.eg_shift = (0 < s.eg_rate_h && s.eg_rate_h < 12) ? 13 - s.eg_rate_h : 0;
				else s.eg_shift = s.eg_rate_h < 13 ? 13 - s.eg_rate_h : 0;
			}
			s.upd = 0;
		}
		paramRate(s) {
			if ((s.type & 1) === 0 && s.key_flag === 0) return 0;
			switch (s.eg_state) {
				case ATTACK: return s.patch.AR;
				case DECAY: return s.patch.DR;
				case SUSTAIN: return s.patch.EG ? 0 : s.patch.RR;
				case REL: return s.sus_flag ? 5 : s.patch.EG ? s.patch.RR : 7;
				case DAMP: return DAMPER_RATE;
			}
			return 0;
		}
		setPatch(ch, num) {
			this.patch_number[ch] = num;
			this.slot[ch * 2].patch = this.patch[num * 2]; this.slot[ch * 2 + 1].patch = this.patch[num * 2 + 1];
			this.slot[ch * 2].upd |= UPDATE_ALL; this.slot[ch * 2 + 1].upd |= UPDATE_ALL;
		}
		updateKeyStatus() {
			let ns = 0;
			for (let ch = 0; ch < 6; ++ch) if (this.reg[0x20 + ch] & 0x10) ns |= 3 << (ch * 2);
			const upd = this.slot_key_status ^ ns;
			if (upd) for (let i = 0; i < 12; ++i) if ((upd >> i) & 1) {
				const s = this.slot[i];
				if ((ns >> i) & 1) { s.key_flag = 1; s.eg_state = DAMP; s.upd |= UPDATE_EG; }
				else { s.key_flag = 0; if (s.type & 1) { s.eg_state = REL; s.upd |= UPDATE_EG; } }
			}
			this.slot_key_status = ns;
		}
		writeReg(reg, data) {
			if (reg >= 0x40) return;
			if ((0x19 <= reg && reg <= 0x1f) || (0x29 <= reg && reg <= 0x2f) || (0x39 <= reg && reg <= 0x3f)) reg -= 9;
			this.reg[reg] = data;
			const P0 = this.patch[0], P1 = this.patch[1];
			const forUser = (car, flag) => { for (let i = 0; i < 6; ++i) if (this.patch_number[i] === 0) this.slot[i * 2 + car].upd |= flag; };
			switch (reg) {
				case 0x00: P0.AM = (data >> 7) & 1; P0.PM = (data >> 6) & 1; P0.EG = (data >> 5) & 1; P0.KR = (data >> 4) & 1; P0.ML = data & 15; forUser(0, UPDATE_RKS | UPDATE_EG); break;
				case 0x01: P1.AM = (data >> 7) & 1; P1.PM = (data >> 6) & 1; P1.EG = (data >> 5) & 1; P1.KR = (data >> 4) & 1; P1.ML = data & 15; forUser(1, UPDATE_RKS | UPDATE_EG); break;
				case 0x02: P0.KL = (data >> 6) & 3; P0.TL = data & 63; forUser(0, UPDATE_TLL); break;
				case 0x03: P1.KL = (data >> 6) & 3; P1.WS = (data >> 4) & 1; P0.WS = (data >> 3) & 1; P0.FB = data & 7; forUser(0, UPDATE_WS); forUser(1, UPDATE_WS | UPDATE_TLL); break;
				case 0x04: P0.AR = (data >> 4) & 15; P0.DR = data & 15; forUser(0, UPDATE_EG); break;
				case 0x05: P1.AR = (data >> 4) & 15; P1.DR = data & 15; forUser(1, UPDATE_EG); break;
				case 0x06: P0.SL = (data >> 4) & 15; P0.RR = data & 15; forUser(0, UPDATE_EG); break;
				case 0x07: P1.SL = (data >> 4) & 15; P1.RR = data & 15; forUser(1, UPDATE_EG); break;
				case 0x0f: this.test_flag = data; break;
				default:
					if (reg >= 0x10 && reg <= 0x15) this.setFnumber(reg - 0x10, data + ((this.reg[0x20 + reg - 0x10] & 1) << 8));
					else if (reg >= 0x20 && reg <= 0x25) {
						const ch = reg - 0x20;
						this.setFnumber(ch, ((data & 1) << 8) + this.reg[0x10 + ch]);
						this.setBlock(ch, (data >> 1) & 7);
						const car = this.slot[ch * 2 + 1]; car.sus_flag = (data >> 5) & 1; car.upd |= UPDATE_EG;
						this.updateKeyStatus();
					}
					else if (reg >= 0x30 && reg <= 0x35) {
						this.setPatch(reg - 0x30, (data >> 4) & 15);
						const car = this.slot[(reg - 0x30) * 2 + 1]; car.volume = (data & 15) << 2; car.upd |= UPDATE_TLL;
					}
			}
		}
		setFnumber(ch, fnum) {
			for (let k = 0; k < 2; ++k) {
				const s = this.slot[ch * 2 + k];
				s.fnum = fnum; s.blk_fnum = (s.blk_fnum & 0xe00) | (fnum & 0x1ff); s.upd |= UPDATE_EG | UPDATE_RKS | UPDATE_TLL;
			}
		}
		setBlock(ch, blk) {
			for (let k = 0; k < 2; ++k) {
				const s = this.slot[ch * 2 + k];
				s.blk = blk; s.blk_fnum = ((blk & 7) << 9) | (s.blk_fnum & 0x1ff); s.upd |= UPDATE_EG | UPDATE_RKS | UPDATE_TLL;
			}
		}
		attackStep(s, counter) {
			let index;
			switch (s.eg_rate_h) {
				case 12: index = (counter & 0xc) >> 1; return 4 - eg_step[s.eg_rate_l][index];
				case 13: index = (counter & 0xc) >> 1; return 3 - eg_step[s.eg_rate_l][index];
				case 14: index = (counter & 0xc) >> 1; return 2 - eg_step[s.eg_rate_l][index];
				case 0: case 15: return 0;
				default: index = counter >> s.eg_shift; return eg_step[s.eg_rate_l][index & 7] ? 4 : 0;
			}
		}
		decayStep(s, counter) {
			let index;
			switch (s.eg_rate_h) {
				case 0: return 0;
				case 13: index = ((counter & 0xc) >> 1) | (counter & 1); return eg_step[s.eg_rate_l][index];
				case 14: index = (counter & 0xc) >> 1; return eg_step[s.eg_rate_l][index] + 1;
				case 15: return 2;
				default: index = counter >> s.eg_shift; return eg_step[s.eg_rate_l][index & 7];
			}
		}
		calcEnvelope(s, buddy, counter) {
			const mask = (1 << s.eg_shift) - 1;
			if (s.eg_state === ATTACK) {
				if (0 < s.eg_out && 0 < s.eg_rate_h && (counter & mask & ~3) === 0) {
					const st = this.attackStep(s, counter);
					if (st > 0) s.eg_out = Math.max(0, s.eg_out - (s.eg_out >> st) - 1);
				}
			} else if (s.eg_rate_h > 0 && (counter & mask) === 0) s.eg_out = Math.min(EG_MUTE, s.eg_out + this.decayStep(s, counter));
			switch (s.eg_state) {
				case DAMP:
					if (s.eg_out >= EG_MAX && (counter & mask) === 0) {
						if (Math.min(15, s.patch.AR + (s.rks >> 2)) === 15) { s.eg_state = DECAY; s.eg_out = 0; }
						else s.eg_state = ATTACK;
						s.upd |= UPDATE_EG;
						if (s.type & 1) { s.pg_phase = 0; if (buddy) buddy.pg_phase = 0; }
					}
					break;
				case ATTACK: if (s.eg_out === 0) { s.eg_state = DECAY; s.upd |= UPDATE_EG; } break;
				case DECAY: if ((s.eg_out >> 3) === s.patch.SL) { s.eg_state = SUSTAIN; s.upd |= UPDATE_EG; } break;
			}
			if (this.test_flag & 1) s.eg_out = 0;
		}
		calcPhase(s) {
			const pm = s.patch.PM ? pm_table[(s.fnum >> 6) & 7][(this.pm_phase >> 10) & 7] : 0;
			if (this.test_flag & 4) s.pg_phase = 0;
			s.pg_phase = (s.pg_phase + ((((s.fnum & 0x1ff) * 2 + pm) * ml_table[s.patch.ML]) << s.blk >> 2)) & (DP_WIDTH - 1);
			s.pg_out = s.pg_phase >> DP_BASE_BITS;
		}
		toLinear(h, s, am) {
			if (s.eg_out > EG_MAX) return 0;
			const i = h + (Math.min(EG_MUTE, s.eg_out + s.tll + am) << 4);
			const t = exp_table[(i & 0xff) ^ 0xff] + 1024;
			const res = t >> ((i & 0x7f00) >> 8);
			return ((i & 0x8000) ? ~res : res) << 1;
		}
		calc() {
			if (this.test_flag & 2) { this.pm_phase = 0; this.am_phase = 0; }
			else { this.pm_phase += (this.test_flag & 8) ? 1024 : 1; this.am_phase += (this.test_flag & 8) ? 64 : 1; }
			this.lfo_am = am_table[(this.am_phase >> 6) % am_table.length];
			this.eg_counter = (this.eg_counter + 1) & 0xFFFF;
			for (let i = 0; i < 12; ++i) {
				const s = this.slot[i];
				const buddy = s.type === 0 ? this.slot[i + 1] : this.slot[i - 1];
				if (s.upd) this.commit(s);
				this.calcEnvelope(s, buddy, this.eg_counter);
				this.calcPhase(s);
			}
			let out = 0;
			for (let ch = 0; ch < 6; ++ch) {
				const m = this.slot[ch * 2], c = this.slot[ch * 2 + 1];
				const fm = m.patch.FB > 0 ? (m.out1 + m.out0) >> (9 - m.patch.FB) : 0;
				m.out1 = m.out0;
				m.out0 = this.toLinear(m.wave[(m.pg_out + fm) & (PG_WIDTH - 1)], m, m.patch.AM ? this.lfo_am : 0);
				c.out1 = c.out0;
				c.out0 = this.toLinear(c.wave[(c.pg_out + 2 * (m.out0 >> 1)) & (PG_WIDTH - 1)], c, c.patch.AM ? this.lfo_am : 0);
				const o = (-c.out0) >> 1;
				this.chOut[ch] = o;
				out += o;
			}
			return out;
		}
	}
	return Chip;
})();

class VRC7Chip {
	constructor(sampleRate, patchBytes) {
		this.opll = new OPLL(patchBytes); this.port = 0;
		this.step = (CLK_VRC7 / 72) / sampleRate; this.phase = 1; this.prev = 0; this.cur = 0;
	}
	write(a, v) {
		if (a === 0x9010) this.port = v;
		else if (a === 0x9030) this.opll.writeReg(this.port, v);
	}
	sample() {
		this.phase += this.step;
		while (this.phase >= 1) { this.phase -= 1; this.prev = this.cur; this.cur = this.opll.calc(); }
		return this.prev + (this.cur - this.prev) * this.phase;
	}
}

