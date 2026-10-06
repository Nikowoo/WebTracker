# WebTracker

Trying to get FamiTracker modules (.ftm / .0cc / .dnm) playing in the browser.

Right now theres no UI yet, its just the engine. Effects and instruments *should* behave how they do in any other tracker build.

You can hear it by rendering a song to a wav:

```sh
cd packages/webtracker
node scripts/render-wav.mjs ../../examples/assets/rainbow.0cc rainbow.wav
```

and `npm test` checks every chip plays at the right pitch.

## future roadmap

- [x] module parser (.ftm, .0cc, .dnm)
- [x] 2A03 + all other expansion chips
- [ ] live row viewer? (gui)
- [ ] skins
- [ ] easily embedable
- [ ] npm

The example song is Rainbow Tylenol by [em](https://msx.horse) (Kitsune²).


GPL-3.0, Not affiliated with any other FamiTracker forks.
