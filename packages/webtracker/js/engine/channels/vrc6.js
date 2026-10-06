class ChannelVRC6 extends ChannelHandler {
	handleEffect(cmd, p) {
		switch (cmd) {
			case EF.DUTY_CYCLE: this.defaultDuty = this.dutyPeriod = p; break;
			case EF.PHASE_RESET: if (p === 0) this.write(this.addr() + 2, 0); break;
			default: return super.handleEffect(cmd, p);
		}
		return true;
	}
	createInstHandler(type) {
		if (this.seqFamily(type)) { this.instHandler = new SeqInstHandler(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true; }
		return false;
	}
	addr() { return ((this.chanId - CH_V6P1) << 12) + 0x9000; }
	clearRegisters() { const A = this.addr(); this.write(A, 0); this.write(A + 1, 0); this.write(A + 2, 0); }
}
class SquareVRC6 extends ChannelVRC6 {
	constructor() { super(0xFFF, 0x0F); }
	refreshChannel() {
		const A = this.addr(), period = this.calculatePeriod(), volume = this.calculateVolume(), duty = (this.dutyPeriod << 4) & 0xFF;
		if (!this.gate) { this.write(A, duty); return; }
		this.write(A, duty | volume); this.write(A + 1, period & 0xFF); this.write(A + 2, 0x80 | (period >> 8));
	}
	convertDuty(d) {
		switch (this.instTypeCurrent) { case INST_2A03: return DUTY_VRC6_FROM_2A03[d & 3]; case INST_S5B: return 7; default: return d; }
	}
}
class SawVRC6 extends ChannelVRC6 {
	constructor() { super(0xFFF, 0x3F); }
	refreshChannel() {
		if (!this.gate) { this.write(0xB000, 0); return; }
		const period = this.calculatePeriod(), volume = this.calculateVolume();
		this.write(0xB000, volume); this.write(0xB001, period & 0xFF); this.write(0xB002, 0x80 | (period >> 8));
	}
	createInstHandler(type) {
		if (this.seqFamily(type)) { this.instHandler = new SeqInstHandlerSawtooth(this, 0x0F, type === INST_S5B ? 0x40 : 0); return true; }
		return false;
	}
	calculateVolume() {
		const h = this.instHandler;
		if (h instanceof SeqInstHandlerSawtooth && h.ignoreDuty)
			return this.limitVolume(Math.trunc(((this.instVolume + 1) * ((this.volume >> VOL_COLUMN_SHIFT) + 1) - 1) / 16) - this.getTremolo());
		return ((super.calculateVolume() << 1) | ((this.dutyPeriod & 1) << 5)) & 0xFF;
	}
}

