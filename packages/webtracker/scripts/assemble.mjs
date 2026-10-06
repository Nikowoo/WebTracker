// puts files together for build.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
export const pkg = JSON.parse(read('package.json'));

export const ENGINE_FILES = [
	'constants.js',
	'chips/apu2a03.js', 'chips/vrc6.js', 'chips/mmc5.js', 'chips/fds.js', 'chips/n163.js', 'chips/s5b.js', 'chips/vrc7.js',
	'instruments.js',
	'channels/base.js', 'channels/2a03.js', 'channels/vrc6.js', 'channels/mmc5.js', 'channels/fds.js',
	'channels/n163.js', 'channels/vrc7.js', 'channels/s5b.js',
	'player.js',
	'exports.js',
].map(f => 'js/engine/' + f);

export const UI_FILES = ['util.js', 'skins.js', 'audio.js', 'icons.js', 'window.js', 'index.js'].map(f => 'js/ui/' + f);

const SCHEME_ORDER = ['Default', 'Monochrome', 'Renoise', 'White', 'Saturday'];
const STYLE_ORDER = ['Windows Classic', 'Windows 98', 'Luna Blue', 'Midnight'];
const ordered = (names, first) => [...first.filter(n => names.includes(n)), ...names.filter(n => !first.includes(n)).sort()];

export function builtinSchemes() {
	const files = readdirSync(join(ROOT, 'skins/schemes')).filter(f => f.endsWith('.txt'));
	const names = files.map(f => basename(f, '.txt'));
	const out = {};
	for (const n of ordered(names, SCHEME_ORDER)) if (n !== 'Default') out[n] = read('skins/schemes/' + n + '.txt');
	return out;
}
export function builtinStyles() {
	const files = readdirSync(join(ROOT, 'skins/window-styles')).filter(f => f.endsWith('.json'));
	const styles = files.map(f => JSON.parse(read('skins/window-styles/' + f)));
	return ordered(styles.map(s => s.name), STYLE_ORDER).map(n => styles.find(s => s.name === n));
}

export function engineSource() {
	return 'function ENGINE() {\n\'use strict\';\n' + ENGINE_FILES.map(read).join('\n') + '}\n';
}
export function coreSource() {
	return engineSource() + '\n' + read('js/parser.js') + '\n' + read('js/demoSong.js') + '\n' + read('js/worklet.js');
}

export function banner() {
	return `/*!
 * WebTracker ${pkg.version}
 * plays FamiTracker / 0CC / Dn-FamiTracker modules in the browser
 * ${pkg.homepage || ''}
 *
 * GPL-3.0. playback is ported from Dn-FamiTracker, vrc7 is emu2413 (MIT, Mitsutaka Okazaki)
 * and fds/n163 are based on Mesen. not affiliated with any of the famitracker projects.
 */
`;
}

// plain <script> version, sets window.WebTracker
export function bundleSource() {
	const ui = UI_FILES.map(read).join('\n')
		.replace(/version: '[^']*'/, "version: '" + pkg.version + "'");
	return banner() + coreSource() + `
(function () {
if (typeof window === 'undefined' || window.WebTracker) return;
const E = ENGINE();
const SCRIPT = document.currentScript;
const STYLE = ${JSON.stringify(read('css/webtracker.css'))};
const BUILTIN_SCHEMES = ${JSON.stringify(builtinSchemes(), null, 1)};
const BUILTIN_STYLES = ${JSON.stringify(builtinStyles())};
${ui}
})();
`;
}

export function moduleSource() {
	return bundleSource() + '\nconst WebTracker = window.WebTracker;\nexport default WebTracker;\nexport { WebTracker };\n';
}
