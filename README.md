# TERRASIM — 3D Planetary Civilization Simulator

**What if WorldBox were a realistic 3D planetary simulator?** TERRASIM is a
god-game where you watch (and meddle with) an entire living planet: procedural
continents, a real day/night cycle, an orbiting Moon, evolving civilizations
that climb from the Stone Age to lunar colonies — all simulated live.

![stack](https://img.shields.io/badge/three.js-3D-blue) ![vite](https://img.shields.io/badge/vite-build-purple)

## Features

- **Procedural 3D planet** — continents, mountain ranges, rivers valleys, lakes,
  deserts, jungles, tundra, polar ice, beaches, shallow/deep oceans, with
  atmosphere, clouds, ocean shaders, fog and dynamic shadows.
- **Real rotation** — 10-minute days + 10-minute nights drive sunrise/sunset
  lighting; the Sun stays fixed while the planet turns.
- **Sun & Moon system** — cratered Moon with phases, orbital mechanics,
  solar/lunar eclipses, comets, meteor showers, orbit-path overlay.
- **Living civilizations** — population, cities, territory, governments,
  religions, cultures, trade, diplomacy, alliances, wars, schisms, environment
  adaptation (sailors, miners, desert survivors…).
- **11 eras** — Stone → Bronze → Iron → Classical → Medieval → Renaissance →
  Industrial → Modern → Information → Space → Lunar.
- **Moon colonization** — rocket launches you can watch, satellites, probes,
  crewed landings, outposts and permanent colonies with their own population.
- **Climate & weather** — temperature/precipitation simulation, seasons,
  hurricanes, thunderstorms, rain, snowstorms.
- **Ecosystems** — prey/predator herds, birds, marine life, hunting,
  deforestation, pollution consequences.
- **Disasters** — earthquakes, volcanoes, tsunamis, hurricanes, wildfires,
  floods, droughts, plagues, meteor impacts.
- **God powers** — raise/sink land, forests, lakes, rain, storms, fire,
  quakes, volcanoes, meteors, blessings, smiting, spawning life.
- **Full observability** — click any city/nation/person, world annals,
  event log, live minimap, nation stats, space-race tracking.
- **Speeds** — pause, 0.25×–1000× so you can watch an afternoon or a millennium.

## Quick start

```bash
npm install
npm run dev      # → http://localhost:5173
```

Build for production:

```bash
npm run build    # → dist/
npm run preview
```

Headless simulation test (runs 4000+ years of history in Node, no GPU needed):

```bash
npm run smoke
```

## Controls

| Input | Action |
|---|---|
| Left-drag / right-drag / wheel | Orbit / orbit / zoom (camera always faces the planet) |
| W A S D · Q / E · Shift | Orbit around / zoom out & in (fast with Shift) |
| Click | Inspect city / nation / wilds / Moon / Sun |
| Space | Pause · `1–8` speed presets · `Esc` deselect |
| Left toolbar | God powers — pick one, click the planet |
| Bottom bar | Jump: Surface → Nation → Planet → Moon → System |

Tip: every planet is seeded — share `?seed=12345` URLs to revisit the same world.

## How it works

- `src/planetData.js` — pure procedural planet math (noise → elevation →
  temperature/precipitation → biomes). No rendering code, testable in Node.
- `src/world.js` — the civilization/climate/eco/space simulation. Also
  headless-safe.
- `src/planetView.js` — Three.js star/planet/ocean/atmosphere/clouds/Moon.
- `src/worldView.js` — instanced cities, night lights, territory, wildlife,
  rockets, satellites, lunar bases, effects.
- `src/ui.js` + `src/style.css` — HUD, inspector, minimap, annals.
- `src/main.js` — boot, camera, input, main loop.
- `scripts/smoke.mjs` — automated full-history test.
