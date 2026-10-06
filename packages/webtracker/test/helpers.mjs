import { coreSource } from '../scripts/assemble.mjs';

// engine + parser + demo
export function loadCore() {
	const src = coreSource().replace('return { Player,', 'return { APU2A03, VRC6Chip, MMC5Chip, FDSChip, N163Chip, S5BChip, VRC7Chip, Player,');
	return new Function(src + '\nreturn { ENGINE, parseModule, makeDemoModule };')();
}
