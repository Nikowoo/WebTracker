// little 2a03 song so there's something to look at before you open a file
function makeDemoModule(E) {
	const NOTES = { 'C-': 1, 'C#': 2, 'D-': 3, 'D#': 4, 'E-': 5, 'F-': 6, 'F#': 7, 'G-': 8, 'G#': 9, 'A-': 10, 'A#': 11, 'B-': 12 };
	const EFX = { '0': E.EF.ARPEGGIO, '4': E.EF.VIBRATO, 'Q': E.EF.SLIDE_UP, 'R': E.EF.SLIDE_DOWN };
	// "row:note:inst:vol:fx", eg "00:G-3:01:4:443". noise is N-x (x = noise freq in hex)
	const pattern = list => {
		const rows = [];
		for (const tok of list.split(/\s+/).filter(Boolean)) {
			const [r, n, i, v, fx] = tok.split(':');
			const nd = { note: 0, octave: 0, vol: 16, inst: 64, eff: [0, 0, 0, 0], par: [0, 0, 0, 0] };
			if (n === '===') nd.note = 13;
			else if (n === '---') nd.note = 14;
			else if (n[0] === 'N') { const m = 0x30 + parseInt(n[2], 16); nd.note = m % 12 + 1; nd.octave = Math.floor(m / 12); }
			else { nd.note = NOTES[n.slice(0, 2)]; nd.octave = +n[2]; }
			if (i) nd.inst = parseInt(i, 16);
			if (v && v !== '.') nd.vol = parseInt(v, 16);
			if (fx) { nd.eff[0] = EFX[fx[0]]; nd.par[0] = parseInt(fx.slice(1), 16); }
			rows[parseInt(r, 16)] = nd;
		}
		return rows;
	};
	const lead = [
		'00:G-3:01 04:D#4:01 08:D-4:01 0C:C-4:01:.:443 12:A#3:01 14:C-4:01 18:D-4:01 1C:D#4:01',
		'00:D#4:01:.:443 06:D-4:01 08:C-4:01 0C:G#3:01 10:C-4:01:.:443 14:D#4:01 18:F-4:01 1C:D#4:01',
		'00:G-4:01:.:443 04:F-4:01 08:D#4:01 0C:A#3:01 10:D#4:01 14:F-4:01 18:G-4:01 1C:A#4:01:.:443',
		'00:A#4:01:.:443 08:G#4:01 0A:G-4:01 0C:F-4:01 10:D-4:01:.:443 14:F-4:01 18:D-4:01 1C:B-3:01:.:R21',
	];
	const pad = [
		'00:C-4:02:6:037 08:C-4:02:4:037 10:C-4:02:6:037 18:C-4:02:4:037',
		'00:G#3:02:6:047 08:G#3:02:4:047 10:G#3:02:6:047 18:G#3:02:4:047',
		'00:D#4:02:6:047 08:D#4:02:4:047 10:D#4:02:6:047 18:D#4:02:4:047',
		'00:A#3:02:6:047 08:A#3:02:4:047 10:A#3:02:6:047 18:A#3:02:4:047',
	];
	const bassLine = (r, f) => `00:${r}2:03 06:${r}2:03 08:${r}3:03 0C:${r}2:03 10:${r}2:03 16:${r}2:03 18:${r}3:03 1C:${f}2:03`;
	const bass = [bassLine('C-', 'G-'), bassLine('G#', 'D#'), bassLine('D#', 'A#'), bassLine('A#', 'F-')];
	const drums = '00:N-C:06 02:N-F:04 04:N-F:04 06:N-F:04 08:N-7:05 0A:N-F:04 0C:N-F:04 0E:N-C:06 ' +
		'10:N-C:06 12:N-F:04 14:N-F:04 16:N-C:06 18:N-7:05 1A:N-F:04 1C:N-7:05 1E:N-7:05';
	const seq = (items, loop = -1, setting = 0) => ({ items, loop, release: -1, setting });
	const S = [[], [], [], [], []];
	S[0][0] = seq([15, 14, 13, 12, 11, 10, 10, 9, 9, 9, 8]);
	S[0][1] = seq([9, 8, 7, 7, 6, 6, 6, 5, 5, 5, 4]);
	S[0][2] = seq([15, 15, 15, 15, 15, 15, 15, 0]);
	S[0][3] = seq([9, 5, 2, 1, 0]);
	S[0][4] = seq([15, 12, 10, 8, 6, 5, 4, 3, 2, 1, 0]);
	S[0][5] = seq([15, 11, 7, 4, 2, 1, 0]);
	S[1][0] = seq([0, -3, -6, -8]);
	S[4][0] = seq([2]); S[4][1] = seq([1]); S[4][2] = seq([0]);
	const inst = (name, en, idx) => ({ type: E.INST_2A03, name, seqEnable: en, seqIndex: idx, dpcm: new Array(96).fill(null) });
	const instruments = new Array(64).fill(null);
	instruments[1] = inst('Lead', [1, 0, 0, 0, 1], [0, 0, 0, 0, 0]);
	instruments[2] = inst('Chord arp', [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]);
	instruments[3] = inst('Bass', [1, 0, 0, 0, 0], [2, 0, 0, 0, 0]);
	instruments[4] = inst('Hi-hat', [1, 0, 0, 0, 1], [3, 0, 0, 0, 2]);
	instruments[5] = inst('Snare', [1, 0, 0, 0, 0], [4, 0, 0, 0, 0]);
	instruments[6] = inst('Kick', [1, 1, 0, 0, 0], [5, 0, 0, 0, 0]);
	const pats = [{}, {}, {}, {}, {}];
	for (let p = 0; p < 4; ++p) { pats[0][p] = pattern(lead[p]); pats[1][p] = pattern(pad[p]); pats[2][p] = pattern(bass[p]); }
	pats[3][0] = pattern(drums);
	return {
		dn: false, fileVersion: 0x440, expansion: 0, machine: 0, engineSpeed: 0, vibratoStyle: 1, linearPitch: false,
		speedSplit: 32, namcoChannels: 0, detuneSemitone: 0, detuneCent: 0, detuneTables: null,
		title: 'Night Shift', artist: 'Built-in demo', copyright: 'Open a module to replace it', comment: '',
		highlight: [4, 16], channelIds: [0, 1, 2, 3, 4], opllPatches: null,
		tracks: [{
			title: 'Demo', speed: 6, tempo: 150, rows: 32, useGroove: false,
			frames: [[0, 0, 0, 0, 0], [1, 1, 1, 0, 0], [2, 2, 2, 0, 0], [3, 3, 3, 0, 0]],
			effCols: [0, 0, 0, 0, 0], patterns: pats,
		}],
		instruments, sequences: { [E.INST_2A03]: S }, samples: new Array(64).fill(null), grooves: new Array(32).fill(null),
	};
}
