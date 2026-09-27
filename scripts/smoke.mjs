// Headless simulation test: generates a planet, runs thousands of years of
// history, and asserts the core loop works (growth → eras → space → Moon).
// Run: npm run smoke
import { PlanetData, World, ERAS, BIOME_INFO } from '../src/world.js';

const seed = 1337;
console.log(`\n=== TERRASIM smoke test (seed ${seed}) ===\n`);

const planet = new PlanetData(seed);
const world = new World(planet, seed, { cellCount: 900, civCount: 7 });

// 1. geography sanity
const biomes = {};
let land = 0;
for (const c of world.cells) {
  biomes[c.biome] = (biomes[c.biome] || 0) + 1;
  if (!c.ocean) land++;
}
const landPct = (land / world.cells.length) * 100;
console.log(`cells=${world.cells.length} land=${landPct.toFixed(1)}% civs=${world.civs.length} herds=${world.herds.length}`);
console.log('biomes:', Object.entries(biomes).map(([k, v]) => `${BIOME_INFO[k].name}:${v}`).join(' '));
if (landPct < 15 || landPct > 70) throw new Error(`land coverage unrealistic: ${landPct}%`);
if (world.civs.length < 4) throw new Error('too few civilizations spawned');

// 2. god powers + disasters don't crash
const d0 = { ...world.cells[10].dir };
world.godForest(d0);
world.godRain(d0);
world.godStorm(d0);
world.spawnLife(d0);
world.triggerDisaster('earthquake', 20);
world.triggerDisaster('meteor', 30);
world.triggerDisaster('volcano', 40);
world.godBless(0);
world.godRaiseTerrain(d0, 0.2, 0.05);
console.log('god powers + disasters: OK');

// 3. run history
const step = 2; // years per tick
let maxYear = 6000;
let milestones = {};
const eraSeen = new Set([0]);
while (world.year < maxYear) {
  world.update(step, 0.1, 1);
  world.visualQueue.length = 0; // renderer would drain this
  for (const c of world.civs) {
    if (!eraSeen.has(c.era)) {
      eraSeen.add(c.era);
      milestones[ERAS[c.era].name] = Math.floor(world.year);
    }
  }
  if (world.moon.pop > 50 && !milestones['Lunar colony']) {
    milestones['Lunar colony'] = Math.floor(world.year);
    break;
  }
}

console.log('\nmilestones:');
for (const [k, v] of Object.entries(milestones)) console.log(`  Year ${v} — ${k}`);
console.log(`\nfinal: year=${Math.floor(world.year)} pop=${world.worldPop() | 0} maxEra=${ERAS[world.maxEra()].name}`);
console.log(`satellites=${world.stats.satellites} launches=${world.stats.launches} wars=${world.stats.wars} disasters=${world.stats.disasters}`);
console.log(`living civs=${world.civs.filter((c) => c.alive).length} cities=${world.cities.length} events=${world.history.length}`);
console.log(`moon pop=${world.moon.pop | 0} bases=${world.moon.bases.length}`);

// 4. assertions
const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); console.log('  ✓ ' + msg); };
assert(world.worldPop() > 5000, `world population grew (${world.worldPop() | 0})`);
assert(world.maxEra() >= 6, `reached at least Industrial Era (got ${ERAS[world.maxEra()].name})`);
assert(world.cities.length >= 8, `cities founded (${world.cities.length})`);
assert(world.stats.wars >= 1, `wars happened (${world.stats.wars})`);
assert(world.stats.disasters >= 5, `disasters happened (${world.stats.disasters})`);
assert(world.history.length > 40, `history recorded (${world.history.length} events)`);
assert(world.stats.satellites > 0, `satellites launched (${world.stats.satellites})`);
assert(world.moon.bases.length > 0 || world.maxEra() >= 9, 'Moon program reached (base or Space Age)');
if (world.moon.pop > 0) console.log(`  ✓ lunar colony thriving (${world.moon.pop | 0} settlers)`);
else console.log('  … no permanent lunar population yet (colony stage not reached in window)');

// late-game god powers still safe
world.godBless(0);
world.godSmite({ ...world.cells[50].dir });
world.triggerDisaster('tsunami', 60);
console.log('late-game god powers: OK');

console.log('\nSample annals:');
for (const e of world.history.filter((e) => e.kind === 'space' || e.kind === 'era').slice(-8)) {
  console.log('  ' + e.text);
}
console.log('\nALL SMOKE TESTS PASSED\n');
