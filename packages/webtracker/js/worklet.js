function WORKLET_MAIN(E) {
	class FTProcessor extends AudioWorkletProcessor {
		constructor() {
			super();
			this.player = null; this.paused = true; this.volume = 1;
			this.port.onmessage = e => this.onMessage(e.data);
		}
		onMessage(m) {
			try {
				if (m.type === 'load') {
					this.player = new E.Player(m.mod, sampleRate);
					this.player.masterVolume = this.volume;
					const P = this.player;
					P.onRow = (frame, row) => this.port.postMessage({ type: 'row', frame, row, speed: P.speed, tempo: P.tempo, time: currentTime + P.renderPos / sampleRate });
					P.onEnd = () => this.port.postMessage({ type: 'end', time: currentTime + P.renderPos / sampleRate });
					let ticks = 0;
					P.onTick = () => { if ((++ticks & 1) === 0) this.port.postMessage({ type: 'meters', levels: P.levels(), time: currentTime + P.renderPos / sampleRate }); };
					this.paused = true;
				} else if (!this.player) return;
				else if (m.type === 'play') { this.player.start(m.track, m.frame); this.paused = false; }
				else if (m.type === 'pause') this.paused = m.paused;
				else if (m.type === 'stop') { this.player.stop(); this.paused = true; }
				else if (m.type === 'mute') this.player.muted[m.ch] = m.on;
				else if (m.type === 'volume') { this.volume = m.value; this.player.masterVolume = m.value; }
			} catch (err) {
				this.port.postMessage({ type: 'error', message: String(err && err.message || err) });
			}
		}
		process(inputs, outputs) {
			const out = outputs[0], L = out[0];
			if (this.player && !this.paused) {
				try { this.player.render(L, L.length); }
				catch (err) { this.paused = true; L.fill(0); this.port.postMessage({ type: 'error', message: String(err && err.message || err) }); }
			} else L.fill(0);
			for (let c = 1; c < out.length; ++c) out[c].set(L);
			return true;
		}
	}
	registerProcessor('ft-player', FTProcessor);
}
