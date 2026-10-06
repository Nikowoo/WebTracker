// bare minimum .ftm writer
// 0x440, 2a03 only.
//  literally only for tests
export function writeFtm(mod) {
	const out = [];
	const u8 = v => out.push(v & 255);
	const i32 = v => { u8(v); u8(v >> 8); u8(v >> 16); u8(v >> 24); };
	const str = (s, n) => { for (let i = 0; i < n; ++i) u8(i < s.length ? s.charCodeAt(i) : 0); };
	const cstr = s => { for (const ch of s) u8(ch.charCodeAt(0)); u8(0); };
	const block = (id, version, fn) => {
		str(id, 16); i32(version);
		const sizeAt = out.length; i32(0);
		const start = out.length; fn();
		const size = out.length - start;
		for (let k = 0; k < 4; ++k) out[sizeAt + k] = (size >> (8 * k)) & 255;
	};
	const nch = mod.channelIds.length;
	str('FamiTracker Module', 18); i32(0x0440);
	block('PARAMS', 6, () => {
		u8(mod.expansion); i32(nch); i32(mod.machine); i32(mod.engineSpeed); i32(mod.vibratoStyle);
		i32(mod.highlight[0]); i32(mod.highlight[1]); i32(mod.speedSplit);
	});
	block('INFO', 1, () => { str(mod.title, 32); str(mod.artist, 32); str(mod.copyright, 32); });
	block('HEADER', 3, () => {
		u8(mod.tracks.length - 1);
		for (const t of mod.tracks) cstr(t.title);
		for (let c = 0; c < nch; ++c) { u8(mod.channelIds[c]); for (const t of mod.tracks) u8(t.effCols[c]); }
	});
	block('INSTRUMENTS', 6, () => {
		const list = mod.instruments.map((x, i) => [i, x]).filter(([, x]) => x);
		i32(list.length);
		for (const [i, inst] of list) {
			if (inst.type !== 1) throw new Error('The writer only supports 2A03 instruments.');
			i32(i); u8(1); i32(5);
			for (let k = 0; k < 5; ++k) { u8(inst.seqEnable[k] ? 1 : 0); u8(inst.seqIndex[k]); }
			for (let n = 0; n < 96; ++n) { const a = inst.dpcm[n]; u8(a ? a.sample : 0); u8(a ? a.pitch : 0); u8(a ? a.delta : 255); }
			i32(inst.name.length); str(inst.name, inst.name.length);
		}
	});
	block('SEQUENCES', 6, () => {
		const S = mod.sequences[1] || [[], [], [], [], []], list = [];
		S.forEach((arr, type) => arr.forEach((s, index) => { if (s) list.push([index, type, s]); }));
		i32(list.length);
		for (const [index, type, s] of list) { i32(index); i32(type); u8(s.items.length); i32(s.loop); for (const v of s.items) u8(v); }
		for (const [, , s] of list) { i32(s.release); i32(s.setting); }
	});
	block('FRAMES', 3, () => {
		for (const t of mod.tracks) {
			i32(t.frames.length); i32(t.speed); i32(t.tempo); i32(t.rows);
			for (const f of t.frames) for (let c = 0; c < nch; ++c) u8(f[c]);
		}
	});
	block('PATTERNS', 5, () => {
		mod.tracks.forEach((t, ti) => t.patterns.forEach((pats, c) => {
			for (const p of Object.keys(pats || {})) {
				const rows = pats[p], used = [];
				rows.forEach((nd, r) => { if (nd) used.push(r); });
				if (!used.length) continue;
				i32(ti); i32(c); i32(+p); i32(used.length);
				for (const r of used) {
					const nd = rows[r];
					i32(r); u8(nd.note); u8(nd.octave); u8(nd.inst); u8(nd.vol);
					for (let e = 0; e <= t.effCols[c]; ++e) { u8(nd.eff[e]); u8(nd.eff[e] ? nd.par[e] : 0); }
				}
			}
		}));
	});
	str('END', 3);
	return new Uint8Array(out);
}
