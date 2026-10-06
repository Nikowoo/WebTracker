// renders a module to a .wav so you can hear the engine if you aren't using a browser (for some reason????)
// node scripts/render-wav.mjs <song.ftm|.0cc|.dnm> [out.wav] [seconds] [song number]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { coreSource } from './assemble.mjs';

const [file, out = basename(file || 'song').replace(/\.\w+$/, '') + '.wav', secs = '60', song = '1'] = process.argv.slice(2);
if (!file) {
	console.log('usage: node scripts/render-wav.mjs <song.ftm> [out.wav] [seconds] [song number]');
	process.exit(1);
}

const { ENGINE, parseModule } = new Function(coreSource() + '\nreturn { ENGINE, parseModule };')();
const E = ENGINE();
const buf = readFileSync(file);
const mod = parseModule(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), E);

const RATE = 48000;
const player = new E.Player(mod, RATE);
let ended = false;
player.onEnd = () => { ended = true; };
player.start(Math.max(0, (+song || 1) - 1), 0);

// TO DO: stereo?? the chips are all mono anyway so it's not a big deal
const total = RATE * (+secs || 60);
const pcm = new Float32Array(total);
let n = 0;
while (n < total && !ended) {
	const len = Math.min(1024, total - n);
	player.render(pcm.subarray(n, n + len), len);
	n += len;
}

const wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; ++i) wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
writeFileSync(out, wav);
console.log(`${mod.title || basename(file)} -> ${out} (${(n / RATE).toFixed(1)}s)`);
