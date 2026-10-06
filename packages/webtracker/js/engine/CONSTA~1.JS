const CLK_NTSC = 1789773, CLK_PAL = 1662607, CLK_VRC7 = 3579545;
const SNDCHIP_VRC6 = 1, SNDCHIP_VRC7 = 2, SNDCHIP_FDS = 4, SNDCHIP_MMC5 = 8, SNDCHIP_N163 = 16, SNDCHIP_S5B = 32;

const CH_SQ1 = 0, CH_SQ2 = 1, CH_TRI = 2, CH_NOI = 3, CH_DPCM = 4,
	CH_V6P1 = 5, CH_V6P2 = 6, CH_SAW = 7, CH_M5P1 = 8, CH_M5P2 = 9, CH_M5V = 10,
	CH_N1 = 11, CH_FDS = 19, CH_FM1 = 20, CH_FM6 = 25, CH_5B1 = 26, CH_5B3 = 28;

const CHANNEL_INFO = [
	['Pulse 1', 'PU1', 0], ['Pulse 2', 'PU2', 0], ['Triangle', 'TRI', 0], ['Noise', 'NOI', 0], ['DPCM', 'DMC', 0],
	['VRC6 Pulse 1', 'V1', SNDCHIP_VRC6], ['VRC6 Pulse 2', 'V2', SNDCHIP_VRC6], ['Sawtooth', 'SAW', SNDCHIP_VRC6],
	['MMC5 Pulse 1', 'PU3', SNDCHIP_MMC5], ['MMC5 Pulse 2', 'PU4', SNDCHIP_MMC5], ['MMC5 PCM', 'PCM', SNDCHIP_MMC5],
	['Namco 1', 'N1', SNDCHIP_N163], ['Namco 2', 'N2', SNDCHIP_N163], ['Namco 3', 'N3', SNDCHIP_N163], ['Namco 4', 'N4', SNDCHIP_N163],
	['Namco 5', 'N5', SNDCHIP_N163], ['Namco 6', 'N6', SNDCHIP_N163], ['Namco 7', 'N7', SNDCHIP_N163], ['Namco 8', 'N8', SNDCHIP_N163],
	['FDS', 'FDS', SNDCHIP_FDS],
	['FM Channel 1', 'FM1', SNDCHIP_VRC7], ['FM Channel 2', 'FM2', SNDCHIP_VRC7], ['FM Channel 3', 'FM3', SNDCHIP_VRC7],
	['FM Channel 4', 'FM4', SNDCHIP_VRC7], ['FM Channel 5', 'FM5', SNDCHIP_VRC7], ['FM Channel 6', 'FM6', SNDCHIP_VRC7],
	['5B Square 1', '5B1', SNDCHIP_S5B], ['5B Square 2', '5B2', SNDCHIP_S5B], ['5B Square 3', '5B3', SNDCHIP_S5B],
];

// mmc5 pcm doesn't have a handler so it gets skipped
function channelList(chip, namco) {
	const list = [];
	for (let i = 0; i < CHANNEL_INFO.length; ++i) {
		if (i === CH_M5V) continue;
		if (!((CHANNEL_INFO[i][2] & chip) || i < 5)) continue;
		if (!(i >= CH_FDS || i < CH_N1 + namco)) continue;
		list.push(i);
	}
	return list;
}

const EF = {
	NONE: 0, SPEED: 1, JUMP: 2, SKIP: 3, HALT: 4, VOLUME: 5, PORTAMENTO: 6, PORTAOFF: 7, SWEEPUP: 8, SWEEPDOWN: 9,
	ARPEGGIO: 10, VIBRATO: 11, TREMOLO: 12, PITCH: 13, DELAY: 14, DAC: 15, PORTA_UP: 16, PORTA_DOWN: 17, DUTY_CYCLE: 18,
	SAMPLE_OFFSET: 19, SLIDE_UP: 20, SLIDE_DOWN: 21, VOLUME_SLIDE: 22, NOTE_CUT: 23, RETRIGGER: 24, DELAYED_VOLUME: 25,
	FDS_MOD_DEPTH: 26, FDS_MOD_SPEED_HI: 27, FDS_MOD_SPEED_LO: 28, DPCM_PITCH: 29, SUNSOFT_ENV_TYPE: 30, SUNSOFT_ENV_HI: 31,
	SUNSOFT_ENV_LO: 32, SUNSOFT_NOISE: 33, VRC7_PORT: 34, VRC7_WRITE: 35, NOTE_RELEASE: 36, GROOVE: 37, TRANSPOSE: 38,
	N163_WAVE_BUFFER: 39, FDS_VOLUME: 40, FDS_MOD_BIAS: 41, PHASE_RESET: 42, HARMONIC: 43, TARGET_VOLUME_SLIDE: 44, COUNT: 45,
};
const EFF_CHAR = ' FBDCE3 HI047PGZ12VYQRASXMHIJWHIJWHILOTZEZ=KN';

const NONE = 0, RELEASE = 13, HALT = 14, ECHO = 15;
const MAX_INSTRUMENTS = 64, HOLD_INSTRUMENT = 0xFF, MAX_VOLUME = 0x10;
const NOTE_RANGE = 12, NOTE_COUNT = 96;
const VOL_COLUMN_SHIFT = 3, VOL_COLUMN_MAX = 0x7F, LINEAR_PITCH_AMOUNT = 5;
const ECHO_BUFFER_LENGTH = 3, ECHO_NONE = -1, ECHO_HALT = 0x7F, ECHO_ECHO = -128;
const INST_NONE = 0, INST_2A03 = 1, INST_VRC6 = 2, INST_VRC7 = 3, INST_FDS = 4, INST_N163 = 5, INST_S5B = 6;
const SEQ_VOLUME = 0, SEQ_ARPEGGIO = 1, SEQ_PITCH = 2, SEQ_HIPITCH = 3, SEQ_DUTYCYCLE = 4;
const S5B_MODE_ENVELOPE = 0x20, S5B_MODE_SQUARE = 0x40, S5B_MODE_NOISE = 0x80;
const DUTY_2A03_FROM_VRC6 = [0, 0, 1, 1, 1, 1, 2, 2], DUTY_VRC6_FROM_2A03 = [1, 3, 7, 3];
const ARPSCHEME_MAX = 36;
const DEFAULT_SPEED = 6, MAX_GROOVE = 32;

const MIDI_NOTE = (o, n) => o * NOTE_RANGE + n - 1;
const GET_OCTAVE = m => { let x = Math.trunc(m / NOTE_RANGE); if (m < 0 && (m % NOTE_RANGE)) --x; return x; };
const GET_NOTE = m => { let x = m % NOTE_RANGE; if (x < 0) x += NOTE_RANGE; return x + 1; };
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const s8 = v => (v << 24) >> 24;

