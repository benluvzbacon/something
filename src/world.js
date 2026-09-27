// ---------------------------------------------------------------------------
// world.js — living-world simulation: cells, resources, climate, ecosystems,
// civilizations, eras, diplomacy, war, trade, disasters, weather, space
// program, lunar colonies, procedural history. Pure logic (no three.js,
// no DOM) so it can run headless in Node for testing.
// ---------------------------------------------------------------------------
import { RNG, clamp, lerp, TAU } from './noise.js';
import { PlanetData, PLANET_R, WORLD_SCALE, B, BIOME_INFO, isOceanBiome } from './planetData.js';

export { PlanetData, PLANET_R, WORLD_SCALE, B, BIOME_INFO, isOceanBiome };

// ---- Time model ------------------------------------------------------------
// A full planetary rotation (visual day+night) lasts 20 real minutes at 1x and
// represents YEARS_PER_ROTATION calendar years, so a whole history from the
// Stone Age to lunar colonies unfolds in a watchable session.
export const ROTATION_SECONDS = 1200; // 10 min day + 10 min night
export const YEARS_PER_ROTATION = 25;
export const YEARS_PER_SECOND = YEARS_PER_ROTATION / ROTATION_SECONDS;

// ---- Technological eras ----------------------------------------------------
export const ERAS = [
  { name: 'Stone Age',       techAt: 0,    color: '#a08b6d', carry: 90,      rural: 26,   mil: 1.0 },
  { name: 'Bronze Age',      techAt: 300,   color: '#c98d4b', carry: 260,     rural: 60,   mil: 1.6 },
  { name: 'Iron Age',        techAt: 900,   color: '#b0b6bd', carry: 700,     rural: 130,  mil: 2.4 },
  { name: 'Classical Era',   techAt: 1900,  color: '#e3c878', carry: 2200,    rural: 260,  mil: 3.4 },
  { name: 'Medieval Era',    techAt: 3200,  color: '#7d8fc4', carry: 5200,    rural: 480,  mil: 4.4 },
  { name: 'Renaissance',     techAt: 5000,  color: '#6fd3a7', carry: 14000,   rural: 950,  mil: 6.0 },
  { name: 'Industrial Era',  techAt: 7500,  color: '#8a8f96', carry: 60000,   rural: 2600, mil: 9.0 },
  { name: 'Modern Era',      techAt: 10500, color: '#5fb4ff', carry: 420000,  rural: 9000, mil: 14.0 },
  { name: 'Information Era', techAt: 14000, color: '#37e0d2', carry: 1800000, rural: 22000, mil: 20.0 },
  { name: 'Space Age',       techAt: 18000, color: '#c792ff', carry: 9000000, rural: 60000, mil: 28.0 },
  { name: 'Lunar Era',       techAt: 23000, color: '#ffe9a8', carry: 40000000, rural: 160000, mil: 36.0 },
];

export const SPACE_STAGES = [
  { name: 'Theoretical rocketry', need: 25 },
  { name: 'Rocket development',   need: 60 },
  { name: 'Launch facilities',    need: 110 },
  { name: 'Orbital satellites',   need: 170 },
  { name: 'Crewed spaceflight',   need: 240 },
  { name: 'Lunar flyby probes',   need: 320 },
  { name: 'Crewed Moon landing',  need: 420 },
  { name: 'Lunar outpost',        need: 540 },
  { name: 'Permanent colony',     need: 700 },
];

const GOV_BY_ERA = [
  ['Tribe', 'Clan', 'Band'], ['Chiefdom', 'Tribe'], ['Chiefdom', 'Kingdom'],
  ['Kingdom', 'Republic', 'Empire'], ['Kingdom', 'Empire', 'Caliphate', 'Khanate'],
  ['Kingdom', 'Republic', 'Empire'], ['Empire', 'Republic', 'Union'],
  ['Republic', 'Federation', 'Union'], ['Federation', 'Republic', 'Union'],
  ['Federation', 'Union', 'Directorate'], ['Union', 'Federation', 'Directorate'],
];

const NAME_A = ['Ae', 'Bel', 'Cal', 'Dor', 'Esh', 'Fal', 'Gar', 'Hel', 'Ith', 'Jor', 'Kel', 'Lor', 'Mal', 'Nor', 'Ost', 'Pel', 'Qu', 'Rath', 'Sel', 'Tor', 'Ul', 'Vel', 'Wex', 'Yar', 'Zel', 'Ash', 'Bran', 'Cor', 'Dun'];
const NAME_B = ['ania', 'oria', 'ecca', 'imia', 'ara', 'ova', 'ica', 'asia', 'ea', 'uria', 'endor', 'aris', 'ath', 'ovia', 'una'];
const CITY_A = ['Ash', 'Bel', 'Cor', 'Dun', 'Eld', 'Fal', 'Glen', 'Har', 'Il', 'Kel', 'Lan', 'Mor', 'Neth', 'Ost', 'Per', 'Quel', 'Rav', 'Stan', 'Thal', 'Ul', 'Ver', 'West', 'Yan', 'Zar'];
const CITY_B = ['ton', 'burg', 'ford', 'mouth', 'haven', 'stad', 'polis', 'grad', 'ville', 'wick', 'holm', 'port', 'field', 'crest', 'fall', 'gate', 'shire', 'ness', 'mark', 'deep'];
const FIRST = ['Ada', 'Bryn', 'Cato', 'Dara', 'Elin', 'Finn', 'Gaia', 'Hald', 'Ilya', 'Juno', 'Kai', 'Lena', 'Mira', 'Niko', 'Ona', 'Petr', 'Quin', 'Rhea', 'Seth', 'Tara', 'Ulf', 'Vera', 'Wren', 'Yuki', 'Zane'];
const LAST = ['son', 'dottir', 'mar', 'vik', 'holm', 'gard', 'fell', 'shore', 'wood', 'stone', 'brook', 'field'];
const RELIGIONS = ['the Old Spirits', 'Solaris the Sun-Bringer', 'the Deep Current', 'the Ancestor Path', 'the Eternal Flame', 'the Lunar Covenant', 'the Silent Mountain', 'the Starwatch', 'the World-Tree', 'the First Fire'];
const ROLES = ['Farmer', 'Fisher', 'Hunter', 'Miner', 'Smith', 'Mason', 'Trader', 'Healer', 'Scribe', 'Priest', 'Soldier', 'Sailor', 'Weaver', 'Potter', 'Scout', 'Elder', 'Builder', 'Herder', 'Cook', 'Guard'];
const ROLES_MODERN = ['Engineer', 'Doctor', 'Teacher', 'Pilot', 'Scientist', 'Programmer', 'Driver', 'Nurse', 'Architect', 'Journalist', 'Mechanic', 'Officer', 'Researcher', 'Technician'];
const ART = ['stone carvings', 'woven tapestries', 'bone flutes', 'cave paintings', 'bronze masks', 'epic poetry', 'mosaics', 'cathedrals', 'oil paintings', 'symphonies', 'cinema', 'video games', 'orbital art'];
const FOODS = ['root stew', 'smoked fish', 'flatbread', 'roast game', 'grain porridge', 'spiced rice', 'noodle bowls', 'preserved meats', 'street food', 'synth-protein'];

const CIV_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xfd79a8, 0x7bed9f, 0x70a1ff];

function fmtPop(n) {
  if (n < 1000) return String(Math.floor(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
  return (n / 1e9).toFixed(2) + 'B';
}
export { fmtPop };

function angDist(ax, ay, az, bx, by, bz) {
  const d = clamp(ax * bx + ay * by + az * bz, -1, 1);
  return Math.acos(d);
}

let UID = 1;

export class World {
  constructor(planet, seed, opts = {}) {
    this.planet = planet;
    this.seed = seed >>> 0;
    this.rng = new RNG((seed ^ 0x5eed) >>> 0);
    this.cellCount = opts.cellCount || 1500;
    this.year = 1;
    this.orbitAngle = 0;
    this.cells = [];
    this.civs = [];
    this.cities = [];
    this.herds = [];
    this.storms = [];
    this.battles = []; // active battle callouts {dir,a,b,n,life}
    this.history = [];
    this.ticker = [];
    this.visualQueue = [];   // consumed by the 3D view
    this.viewsDirty = { territory: true, cities: true, lights: true };
    this.moon = { pop: 0, bases: [] };
    this.stats = { launches: 0, satellites: 0, disasters: 0, wars: 0 };
    this.slowAcc = 0;
    this.stormId = 1;
    this.nextDisasterIn = 6;
    this.eclipseCooldown = 0;
    this.meteorShowerIn = this.rng.range(30, 90);
    this.cometTimer = this.rng.range(20, 60);
    this.genCells();
    this.genHerds();
    this.spawnCivs(opts.civCount || 7);
  }

  // -- cells ----------------------------------------------------------------
  genCells() {
    const N = this.cellCount;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const s = {};
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i;
      const d = { x: Math.cos(th) * rad, y, z: Math.sin(th) * rad };
      this.planet.sample(d.x, d.y, d.z, s);
      const ocean = isOceanBiome(s.biome);
      const cell = {
        idx: i, dir: d, lat: s.lat, lon: Math.atan2(d.x, d.z),
        elev: s.elevation, temp: s.temperature, precip: s.precip,
        biome: s.biome, ocean,
        owner: -1, city: null, neighbor: [],
        fertility: 0, water: 0, habit: 0,
        coast: false, river: false,
        forest: 0, res: null, mod: null,
      };
      this.cells.push(cell);
    }
    // neighbors (brute force k-nearest; one-time cost)
    const K = 7;
    for (let i = 0; i < N; i++) {
      const a = this.cells[i].dir;
      const best = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const b = this.cells[j].dir;
        const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        if (best.length < K) { best.push([dd, j]); best.sort((p, q) => p[0] - q[0]); }
        else if (dd < best[K - 1][0]) { best[K - 1] = [dd, j]; best.sort((p, q) => p[0] - q[0]); }
      }
      this.cells[i].neighbor = best.map((e) => e[1]);
    }
    // derived attributes
    for (const c of this.cells) {
      c.coast = !c.ocean && c.neighbor.some((n) => this.cells[n].ocean);
      c.river = !c.ocean && c.precip > 0.55 && c.elev > 0.05 && c.elev < 0.5;
      c.water = c.ocean ? 1 : clamp(c.precip * 0.7 + (c.river ? 0.4 : 0) + (c.coast ? 0.15 : 0), 0, 1);
      const tComf = 1 - Math.abs(c.temp - 0.62) * 1.9;
      c.fertility = c.ocean ? 0 : clamp(0.15 + tComf * 0.5 + c.precip * 0.45 + (c.river ? 0.25 : 0) - Math.max(0, c.elev - 0.5) * 0.9, 0, 1.4);
      if (c.biome === B.DESERT) c.fertility *= 0.25;
      if (c.biome === B.TUNDRA || c.biome === B.ICE) c.fertility *= 0.3;
      if (c.biome === B.MOUNTAIN || c.biome === B.SNOW || c.biome === B.ROCK) c.fertility *= 0.35;
      c.habit = c.ocean ? 0 : clamp(c.fertility * 0.75 + c.water * 0.35 + (c.coast ? 0.12 : 0) - Math.max(0, c.elev - 0.6), 0.02, 1.5);
      c.forest = (c.biome === B.FOREST || c.biome === B.JUNGLE) ? 1 : (c.biome === B.GRASS || c.biome === B.SAVANNA ? 0.25 : 0);
      const r = this.rng;
      c.res = {
        wood: c.forest * r.range(0.5, 1),
        stone: (c.elev > 0.35 || c.biome === B.MOUNTAIN) ? r.range(0.4, 1) : r.range(0, 0.25),
        iron: (c.elev > 0.4 && r.chance(0.5)) ? r.range(0.3, 1) : (r.chance(0.06) ? r.range(0.2, 0.6) : 0),
        copper: (c.elev > 0.3 && r.chance(0.4)) ? r.range(0.3, 1) : (r.chance(0.05) ? r.range(0.2, 0.5) : 0),
        coal: (!c.ocean && r.chance(0.10)) ? r.range(0.3, 1) : 0,
        oil: ((c.biome === B.DESERT && r.chance(0.35)) || (c.ocean && c.elev > -0.3 && r.chance(0.12))) ? r.range(0.4, 1) : 0,
        uranium: (!c.ocean && r.chance(0.045)) ? r.range(0.3, 1) : 0,
        gold: (!c.ocean && r.chance(0.07)) ? r.range(0.3, 1) : 0,
        fish: c.ocean ? r.range(0.3, 1) : 0,
      };
      if (c.coast) c.res.fish = r.range(0.4, 1);
    }
  }

  nearestCell(dir) {
    let bi = 0, bd = 1e9;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i].dir;
      const dd = (c.x - dir.x) ** 2 + (c.y - dir.y) ** 2 + (c.z - dir.z) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    }
    return bi;
  }

  cellsNear(dir, radiusRad, max = 40) {
    const out = [];
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i].dir;
      if (angDist(c.x, c.y, c.z, dir.x, dir.y, dir.z) < radiusRad) {
        out.push(i);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  // -- ecosystems -------------------------------------------------------------
  genHerds() {
    const r = this.rng;
    const kinds = [
      { k: 'deer',    prey: true,  biomes: [B.FOREST, B.GRASS, B.SAVANNA], K: 900 },
      { k: 'rabbit',  prey: true,  biomes: [B.GRASS, B.FOREST, B.SAVANNA, B.TUNDRA], K: 2400 },
      { k: 'boar',    prey: true,  biomes: [B.FOREST, B.JUNGLE], K: 700 },
      { k: 'wolf',    prey: false, biomes: [B.FOREST, B.TUNDRA, B.GRASS], K: 120 },
      { k: 'bigcat',  prey: false, biomes: [B.JUNGLE, B.SAVANNA], K: 90 },
      { k: 'bird',    prey: true,  biomes: [B.FOREST, B.GRASS, B.JUNGLE, B.BEACH, B.SAVANNA], K: 3000 },
      { k: 'mammoth', prey: true,  biomes: [B.TUNDRA], K: 160 },
      { k: 'lizard',  prey: true,  biomes: [B.DESERT, B.SAVANNA], K: 1200 },
      { k: 'fish',    prey: true,  biomes: [B.SHALLOW, B.OCEAN], K: 6000, marine: true },
      { k: 'whale',   prey: false, biomes: [B.OCEAN, B.DEEP], K: 200, marine: true },
    ];
    let hid = 1;
    for (const def of kinds) {
      const spots = this.cells.filter((c) => def.biomes.includes(c.biome));
      const n = Math.min(spots.length, def.marine ? 26 : 14);
      for (let i = 0; i < n; i++) {
        const c = spots[(r.next() * spots.length) | 0];
        if (!c) continue;
        this.herds.push({ id: hid++, kind: def.k, prey: def.prey, cell: c.idx, n: def.K * r.range(0.3, 0.9), K: def.K, marine: !!def.marine });
      }
    }
  }

  // -- civilizations ----------------------------------------------------------
  civName(r) {
    const a = r.pick(NAME_A), b = r.pick(NAME_B);
    return a + b;
  }

  fullCivName(civ) {
    return `The ${civ.gov} of ${civ.name}`;
  }

  spawnCivs(count) {
    const r = this.rng;
    const land = this.cells.filter((c) => !c.ocean && c.habit > 0.55 && c.biome !== B.ICE);
    land.sort((a, b) => b.habit - a.habit);
    const picks = [];
    for (const c of land) {
      if (picks.length >= count) break;
      if (picks.every((p) => angDist(c.dir.x, c.dir.y, c.dir.z, p.dir.x, p.dir.y, p.dir.z) > 0.55)) picks.push(c);
    }
    let ci = 0;
    for (const home of picks) {
      const name = this.civName(r);
      const civ = {
        id: ci, name, color: CIV_COLORS[ci % CIV_COLORS.length],
        gov: r.pick(GOV_BY_ERA[0]),
        culture: r.pick(ART), food: r.pick(FOODS),
        religion: r.pick(RELIGIONS), language: `${name}ic`,
        tech: r.range(0, 12), era: 0,
        territory: [], cities: [], capital: -1,
        rural: r.range(40, 90), storedFood: 30,
        relations: {}, wars: [], allies: [],
        tradeRoutes: 0, pollution: 0, science: 0,
        alive: true, born: 1,
        bless: 0, // god-power blessing timer (years)
        personality: { aggr: r.range(0.15, 0.9), cur: r.range(0.3, 1), exp: r.range(0.3, 1), uni: r.range(0.2, 0.9) },
        traits: { naval: 0, mining: 0, farming: 0, desert: 0, isolated: 1 },
        space: { stage: -1, progress: 0, satellites: 0 },
        lunarPop: 0,
        history: [],
        envAdapted: false,
      };
      civ.colorCss = '#' + civ.color.toString(16).padStart(6, '0');
      this.civs.push(civ);
      // claim home + neighbors
      this.claimCell(civ, home.idx);
      for (const n of home.neighbor.slice(0, 4)) {
        const nc = this.cells[n];
        if (!nc.ocean && nc.owner === -1) this.claimCell(civ, n);
      }
      this.foundCity(civ, home.idx, true);
      this.log(`Year 1 — The ${civ.gov} of ${name} emerges on the shores of a new world.`, 'civ', civ.id);
      civ.history.push(`Year 1 — our people first gathered as one.`);
      ci++;
    }
    // initial relations
    for (const a of this.civs) for (const b of this.civs) {
      if (a.id !== b.id) a.relations[b.id] = this.rng.range(-10, 25);
    }
  }

  claimCell(civ, idx) {
    const c = this.cells[idx];
    if (c.owner === civ.id) return;
    if (c.owner !== -1) {
      const prev = this.civs[c.owner];
      if (prev) prev.territory = prev.territory.filter((t) => t !== idx);
    }
    c.owner = civ.id;
    civ.territory.push(idx);
    this.viewsDirty.territory = true;
  }

  cityName(r) { return r.pick(CITY_A) + r.pick(CITY_B); }

  foundCity(civ, cellIdx, isCapital = false) {
    const cell = this.cells[cellIdx];
    if (cell.city !== null && cell.city !== undefined) return null;
    const r = this.rng;
    const city = {
      id: UID++, name: this.cityName(r), civ: civ.id, cell: cellIdx,
      dir: { ...cell.dir }, pop: isCapital ? 30 : 14,
      founded: Math.floor(this.year), port: cell.coast,
      launchpad: false, damage: 0, smog: 0, seed: (r.next() * 1e9) | 0,
    };
    // unique-ish name
    if (this.cities.some((c) => c.name === city.name)) city.name += ' ' + r.pick(['New', 'Old', 'Upper', 'Lower', 'Port', 'Fort']);
    cell.city = city.id;
    this.claimCell(civ, cellIdx);
    this.cities.push(city);
    civ.cities.push(city.id);
    if (isCapital || civ.capital === -1) civ.capital = city.id;
    civ.rural = Math.max(10, civ.rural - city.pop);
    this.viewsDirty.cities = true;
    this.viewsDirty.lights = true;
    return city;
  }

  cityById(id) { return this.cities.find((c) => c.id === id); }
  civById(id) { return this.civs[id]; }
  capitalOf(civ) { return this.cityById(civ.capital); }

  civPop(civ) {
    let p = civ.rural;
    for (const id of civ.cities) { const c = this.cityById(id); if (c) p += c.pop; }
    return p;
  }

  worldPop() {
    let p = 0;
    for (const c of this.civs) if (c.alive) p += this.civPop(c);
    return p + this.moon.pop;
  }

  maxEra() {
    let m = 0;
    for (const c of this.civs) if (c.alive) m = Math.max(m, c.era);
    return m;
  }

  leaderCiv() {
    let best = null, bp = -1;
    for (const c of this.civs) {
      if (!c.alive) continue;
      const p = this.civPop(c);
      if (p > bp) { bp = p; best = c; }
    }
    return best;
  }

  // -- logging ------------------------------------------------------------------
  log(text, kind = 'info', civId = -1, cellIdx = -1) {
    const e = { year: Math.floor(this.year), text, kind, civ: civId, cell: cellIdx, id: UID++ };
    this.history.push(e);
    this.ticker.push(e);
    if (this.ticker.length > 60) this.ticker.shift();
    if (this.history.length > 1500) this.history.splice(0, this.history.length - 1500);
    return e;
  }

  // -- main update --------------------------------------------------------------
  update(dtYears, dtReal, warp) {
    if (dtYears <= 0 && dtReal <= 0) return;
    this.year += Math.max(0, dtYears);
    // Planet's year-orbit: 8 rotations per orbit (gameplay scale)
    this.orbitAngle = (this.orbitAngle + (dtYears / (YEARS_PER_ROTATION * 8)) * TAU) % TAU;

    for (const civ of this.civs) {
      if (civ.alive) this.tickCiv(civ, dtYears);
    }
    this.tickHerds(dtYears);
    this.tickStorms(dtReal, warp, dtYears);
    this.tickMoon(dtYears);
    // battle callouts fade in visual time (frozen while paused)
    const wEff = warp === 0 ? 0 : Math.min(warp, 8);
    for (let i = this.battles.length - 1; i >= 0; i--) {
      this.battles[i].life -= dtReal * wEff;
      if (this.battles[i].life <= 0) this.battles.splice(i, 1);
    }

    // slow strategic tick
    this.slowAcc += dtYears;
    while (this.slowAcc > 0.5) {
      this.slowAcc -= 0.5;
      this.slowTick(0.5);
    }

    // random disasters
    this.nextDisasterIn -= dtYears;
    if (this.nextDisasterIn <= 0) {
      this.nextDisasterIn = this.rng.range(2.5, 9);
      this.randomDisaster();
    }
    // meteor showers & comets (visual + minor effects)
    this.meteorShowerIn -= dtYears;
    if (this.meteorShowerIn <= 0) {
      this.meteorShowerIn = this.rng.range(40, 130);
      const cell = this.cells[(this.rng.next() * this.cells.length) | 0];
      this.visualQueue.push({ t: 'meteorShower', dir: { ...cell.dir } });
      this.log(`Year ${Math.floor(this.year)} — A brilliant meteor shower streaks across the night sky.`, 'astro', -1, cell.idx);
    }
    this.cometTimer -= dtYears;
    if (this.cometTimer <= 0) {
      this.cometTimer = this.rng.range(60, 160);
      this.visualQueue.push({ t: 'comet' });
      this.log(`Year ${Math.floor(this.year)} — A great comet with a fiery tail visits the inner system.`, 'astro');
    }
    if (this.eclipseCooldown > 0) this.eclipseCooldown -= dtYears;
  }

  onEclipse(kind) {
    if (this.eclipseCooldown > 0) return;
    this.eclipseCooldown = 4;
    if (kind === 'solar') {
      this.log(`Year ${Math.floor(this.year)} — A total solar eclipse darkens the day. Priests call it an omen.`, 'astro');
      for (const civ of this.civs) {
        if (civ.alive && this.rng.chance(0.4)) { civ.tech += 20; civ.history.push(`Year ${Math.floor(this.year)} — the day the Sun died and was reborn.`); }
      }
    } else {
      this.log(`Year ${Math.floor(this.year)} — The Moon turns blood-red in a lunar eclipse.`, 'astro');
    }
    this.visualQueue.push({ t: 'eclipse', kind });
  }

  // -- per-civ tick ---------------------------------------------------------------
  tickCiv(civ, dt) {
    const era = ERAS[civ.era];
    if (civ.bless > 0) civ.bless -= dt;

    // environment adaptation (once civs settle in)
    if (!civ.envAdapted && this.year - civ.born > 8) {
      civ.envAdapted = true;
      let coast = 0, mtn = 0, river = 0, desert = 0;
      for (const ti of civ.territory) {
        const c = this.cells[ti];
        if (c.coast) coast++; if (c.elev > 0.4) mtn++; if (c.river) river++; if (c.biome === B.DESERT) desert++;
      }
      const n = Math.max(1, civ.territory.length);
      civ.traits.naval = coast / n; civ.traits.mining = mtn / n;
      civ.traits.farming = river / n; civ.traits.desert = desert / n;
      const bits = [];
      if (coast / n > 0.35) bits.push('masterful sailors and fishers');
      if (mtn / n > 0.3) bits.push('skilled miners and stoneworkers');
      if (river / n > 0.25) bits.push('ingenious irrigation farmers');
      if (desert / n > 0.35) bits.push('hardy desert survivors');
      if (bits.length) {
        this.log(`Year ${Math.floor(this.year)} — The people of ${civ.name} become ${bits.join(' and ')}.`, 'civ', civ.id);
        civ.history.push(`Year ${Math.floor(this.year)} — our land shaped us: ${bits.join(', ')}.`);
      }
    }

    // food & growth
    let fertility = 0, fish = 0;
    for (const ti of civ.territory) {
      const c = this.cells[ti];
      fertility += c.fertility * (1 - (civ.pollution * 0.3));
      if (c.coast || c.ocean) fish += c.res.fish;
    }
    const pop = this.civPop(civ);
    const agriTech = 1 + civ.era * 0.55 + civ.traits.farming * 0.8 + (civ.tech / 900);
    const foodNeed = pop * 0.045;
    const foodMade = (fertility * 26 * agriTech + fish * 9 * (1 + civ.traits.naval)) * (civ.bless > 0 ? 1.6 : 1);
    civ.storedFood += (foodMade - foodNeed) * dt * 0.2;
    civ.storedFood = clamp(civ.storedFood, -200, 5000);
    const fed = civ.storedFood > -50 ? 1 : 0.35;
    if (civ.storedFood <= -50 && this.rng.chance(dt * 0.3)) {
      this.log(`Year ${Math.floor(this.year)} — Famine grips ${this.fullCivName(civ)}.`, 'war', civ.id);
    }

    // rural + urban growth (logistic, sublinear in territory so wide empires
    // grow denser rather than exploding)
    const growth = (0.009 + civ.era * 0.0014 + (civ.bless > 0 ? 0.02 : 0)) * fed;
    const ruralCap = Math.max(40, era.rural * (4 + 2 * Math.sqrt(Math.max(0, fertility))));
    civ._fert = fertility;
    civ.rural += (civ.rural * growth * (1 - civ.rural / ruralCap) + (civ.rural < ruralCap ? ruralCap * 0.004 : 0)) * dt;
    if (civ.storedFood <= -50) civ.rural *= (1 - 0.03 * dt);

    for (const id of civ.cities) {
      const city = this.cityById(id);
      if (!city) continue;
      const cell = this.cells[city.cell];
      const cap = Math.max(30, era.carry * (0.4 + cell.fertility) * (city.port ? 1.35 : 1) * (1 + civ.tech / 2500));
      city.pop += city.pop * growth * (1 - city.pop / cap) * dt * 1.4;
      // rural migration into cities
      if (city.pop < cap * 0.9 && civ.rural > 60) {
        const m = Math.min(civ.rural * 0.02, cap * 0.01) * dt;
        civ.rural -= m; city.pop += m;
      }
      if (civ.storedFood <= -50) city.pop *= (1 - 0.04 * dt);
      city.pop = Math.max(4, city.pop);
      city.damage = Math.max(0, city.damage - dt * 0.15);
      const targetSmog = civ.era === 6 ? 0.8 : civ.era === 7 ? 1 : civ.era >= 8 ? 0.45 : 0;
      city.smog += (targetSmog - city.smog) * Math.min(1, dt * 0.2);
      // deforestation pressure
      if (city.pop > 400 && cell.forest > 0.05 && this.rng.chance(dt * 0.05)) {
        cell.forest = Math.max(0, cell.forest - 0.08);
        if (cell.forest < 0.4) this.planet.addPaint(cell.dir, 0.035, 0.45, 0.42, 0.28, 0.5);
      }
    }

    // technology
    const p = this.civPop(civ);
    const sciRate = (0.7 + 2.2 * Math.log10(6 + p / 80) * (1 + civ.era * 0.05)
      + civ.tradeRoutes * 0.45 + civ.traits.mining * 0.6)
      * (0.6 + civ.personality.cur * 0.8) * (civ.bless > 0 ? 1.5 : 1);
    civ.tech += sciRate * dt;

    // era advancement
    while (civ.era < ERAS.length - 1 && civ.tech >= ERAS[civ.era + 1].techAt) {
      civ.era++;
      const e = ERAS[civ.era];
      if (this.rng.chance(0.55)) civ.gov = this.rng.pick(GOV_BY_ERA[civ.era]);
      this.log(`Year ${Math.floor(this.year)} — ${this.fullCivName(civ)} enters the ${e.name}.`, 'era', civ.id);
      civ.history.push(`Year ${Math.floor(this.year)} — we entered the ${e.name}.`);
      this.visualQueue.push({ t: 'eraUp', civ: civ.id, era: civ.era });
      this.viewsDirty.cities = true; this.viewsDirty.lights = true;
      if (civ.era === 6) this.log(`Year ${Math.floor(this.year)} — Black smoke rises over ${civ.name} as factories roar to life.`, 'civ', civ.id);
      if (civ.era === 9) {
        const cap = this.capitalOf(civ);
        if (cap) { cap.launchpad = true; this.viewsDirty.cities = true; }
      }
    }

    // pollution from industry
    civ.pollution = civ.era === 6 ? 0.7 : civ.era === 7 ? 1 : civ.era === 8 ? 0.6 : civ.era >= 9 ? 0.25 : 0;

    // space program
    if (civ.alive && civ.era >= 8 && civ.space.stage < SPACE_STAGES.length - 1) {
      const rate = (civ.era - 7) * (0.35 + Math.min(2.2, p / 3e6) + civ.tech / 6000) * (0.5 + civ.personality.cur * 0.9);
      civ.space.progress += rate * dt;
      const next = SPACE_STAGES[civ.space.stage + 1];
      if (civ.space.progress >= next.need) {
        civ.space.stage++;
        const st = SPACE_STAGES[civ.space.stage];
        const cap = this.capitalOf(civ);
        const nm = this.fullCivName(civ);
        if (civ.space.stage === 2 && cap) { cap.launchpad = true; this.viewsDirty.cities = true; }
        if (civ.space.stage === 3) {
          civ.space.satellites += 3; this.stats.satellites += 3;
          this.log(`Year ${Math.floor(this.year)} — ${nm} establishes its first orbital satellite.`, 'space', civ.id);
          this.visualQueue.push({ t: 'satellites', civ: civ.id, n: 3 });
        } else if (civ.space.stage === 5) {
          this.log(`Year ${Math.floor(this.year)} — ${nm} sends probes screaming past the Moon.`, 'space', civ.id);
          if (cap) { this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'probe' }); this.stats.launches++; }
        } else if (civ.space.stage === 6) {
          this.log(`Year ${Math.floor(this.year)} — The first ${civ.name} astronaut lands on the Moon.`, 'space', civ.id);
          if (cap) { this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'crewed' }); this.stats.launches++; }
        } else if (civ.space.stage === 7) {
          this.log(`Year ${Math.floor(this.year)} — ${nm} builds a permanent lunar outpost.`, 'space', civ.id);
          this.moon.bases.push({ civ: civ.id, size: 1 });
          if (cap) { this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'base' }); this.stats.launches++; }
        } else if (civ.space.stage === 8) {
          this.log(`Year ${Math.floor(this.year)} — The first permanent lunar colony is established by ${nm}.`, 'space', civ.id);
          const b = this.moon.bases.find((x) => x.civ === civ.id);
          if (b) b.size = 3; else this.moon.bases.push({ civ: civ.id, size: 3 });
          civ.history.push(`Year ${Math.floor(this.year)} — our children now live on the Moon.`);
          if (cap) { this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'colony' }); this.stats.launches++; }
          if (civ.era < 10 && civ.tech > ERAS[10].techAt * 0.9) { /* lunar era comes via tech */ }
        } else {
          this.log(`Year ${Math.floor(this.year)} — ${nm} achieves: ${st.name}.`, 'space', civ.id);
          if (cap && civ.space.stage >= 1 && civ.space.stage <= 4 && this.rng.chance(0.7)) {
            this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'test' }); this.stats.launches++;
          }
        }
        civ.history.push(`Year ${Math.floor(this.year)} — space milestone: ${st.name}.`);
      }
    }
    // routine satellite launches in space age
    if (civ.alive && civ.era >= 9 && this.rng.chance(dt * 0.25) && civ.space.satellites < 40) {
      civ.space.satellites++;
      this.stats.satellites++;
      this.visualQueue.push({ t: 'satellites', civ: civ.id, n: 1 });
      const cap = this.capitalOf(civ);
      if (cap && this.rng.chance(0.5)) { this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'sat' }); this.stats.launches++; }
    }
    // colony supply shuttles
    if (civ.alive && civ.space.stage >= 7 && this.rng.chance(dt * 0.4)) {
      const cap = this.capitalOf(civ);
      if (cap) { this.visualQueue.push({ t: 'launch', civ: civ.id, city: cap.id, mission: 'supply' }); this.stats.launches++; }
    }

    // wars tick
    for (const w of civ.wars) {
      w.years += dt;
      const foe = this.civs[w.foe];
      if (!foe || !foe.alive) continue;
      const myMil = this.military(civ), foMil = this.military(foe);
      // casualties
      const loss = dt * 0.02 * (0.5 + civ.personality.aggr);
      civ.rural *= (1 - loss * 0.5);
      for (const id of civ.cities) { const c = this.cityById(id); if (c) c.pop *= (1 - loss * 0.4); }
      // border skirmish: cells may flip (both sides tick, so wars visibly move borders)
      if (this.rng.chance(dt * 1.6)) {
        const border = this.borderCells(civ, foe);
        if (border.length && (myMil / Math.max(1, foMil)) > this.rng.range(0.4, 1.4)) {
          const idx = this.rng.pick(border);
          const cell = this.cells[idx];
          const oldCity = cell.city != null ? this.cityById(cell.city) : null;
          this.claimCell(civ, idx);
          // battle callout ("Zisa ⚔️ 68 fighting")
          const troops = Math.max(12, Math.floor(Math.min(this.civPop(civ), this.civPop(foe)) / 60) + this.rng.int(10, 120));
          this.battles.push({ dir: { ...cell.dir }, a: civ.name, b: foe.name, n: troops, life: 50 });
          if (this.battles.length > 8) this.battles.shift();
          if (oldCity && oldCity.civ !== civ.id) {
            // city captured
            const prevOwner = this.civs[oldCity.civ];
            if (prevOwner) prevOwner.cities = prevOwner.cities.filter((x) => x !== oldCity.id);
            oldCity.civ = civ.id;
            civ.cities.push(oldCity.id);
            oldCity.damage = 0.7;
            oldCity.pop *= 0.7;
            this.log(`Year ${Math.floor(this.year)} — ${oldCity.name} falls to ${this.fullCivName(civ)}.`, 'war', civ.id, idx);
            this.visualQueue.push({ t: 'battle', dir: { ...cell.dir } });
            this.viewsDirty.cities = true;
          }
        }
      }
      // war exhaustion → peace
      const exhaust = w.years > 10 + (1 - civ.personality.aggr) * 20;
      if (exhaust || foe.rural < 20) {
        this.makePeace(civ, foe, 'treaty');
      }
    }

    // death check
    if (civ.cities.length === 0 && civ.rural < 8 && civ.territory.length === 0) {
      civ.alive = false;
      this.log(`Year ${Math.floor(this.year)} — ${this.fullCivName(civ)} vanishes from history.`, 'war', civ.id);
    }
  }

  military(civ) {
    return Math.max(1, this.civPop(civ) * ERAS[civ.era].mil * (0.4 + civ.personality.aggr) * (civ.bless > 0 ? 1.4 : 1));
  }

  borderCells(a, b) {
    const out = [];
    for (const ti of b.territory) {
      const c = this.cells[ti];
      if (c.neighbor.some((n) => this.cells[n].owner === a.id)) out.push(ti);
    }
    return out;
  }

  // -- slow strategic tick (every 0.5 years) --------------------------------------
  slowTick(dt) {
    const r = this.rng;
    // expansion + founding
    for (const civ of this.civs) {
      if (!civ.alive) continue;
      // rump-state recovery: no land left → rally around surviving cities or perish
      if (civ.territory.length === 0) {
        for (const id of civ.cities) {
          const hc = this.cityById(id);
          if (hc) this.claimCell(civ, hc.cell);
        }
        if (civ.territory.length === 0) {
          civ.alive = false;
          this.log(`Year ${Math.floor(this.year)} — ${this.fullCivName(civ)} is wiped from the map.`, 'war', civ.id);
          continue;
        }
      }
      // expansion pressure (cooldown-paced so borders creep instead of flooding)
      const ruralCapNow = Math.max(60, ERAS[civ.era].rural * (4 + 2 * Math.sqrt(Math.max(0, civ._fert || 1))));
      const pressure = civ.rural / ruralCapNow;
      const softCap = 14 + civ.era * 12;
      if (civ._expandIn === undefined) civ._expandIn = r.range(0.6, 1.6);
      civ._expandIn -= dt;
      if (civ._expandIn <= 0) {
        civ._expandIn = r.range(0.8, 2.2) / (0.5 + civ.personality.exp) / (0.6 + Math.min(1.5, pressure));
        if (civ.territory.length > softCap * 2.2 && r.chance(0.7)) {
          // overextended: restless provinces rather than new conquests
        } else {
        // claim a batch so borders advance in visible chunks, not single cells
        const batch = 1 + (pressure > 0.7 ? 1 : 0) + (civ.era >= 3 ? 1 : 0) + (civ.era >= 6 ? 1 : 0) + (civ.personality.exp > 0.7 ? 1 : 0);
        const cand = [];
        for (const ti of civ.territory) {
          for (const n of this.cells[ti].neighbor) {
            const c = this.cells[n];
            if (c.owner === civ.id || c.ocean) continue;
            if (c.biome === B.ICE) continue;
            if ((c.biome === B.TUNDRA) && civ.era < 2) continue;
            if ((c.biome === B.DESERT) && civ.era < 3 && !c.river) continue;
            if ((c.biome === B.MOUNTAIN || c.biome === B.SNOW) && civ.era < 2) continue;
            if (c.owner !== -1 && c.owner !== civ.id) continue; // conquest handled by war
            cand.push(n);
          }
        }
        if (cand.length) {
          cand.sort((a, b) => this.cells[b].habit - this.cells[a].habit);
          const pool = Math.min(cand.length, 4 + batch * 2);
          const claimed = [];
          for (let k = 0; k < batch && claimed.length < pool; k++) {
            const pick = cand[(r.next() * r.next() * pool) | 0];
            if (this.cells[pick].owner === civ.id) continue;
            this.claimCell(civ, pick);
            claimed.push(pick);
            civ.rural = Math.max(8, civ.rural - 4);
          }
          // settler party: a new frontier town on the fresh border
          if (claimed.length && civ.cities.length < 14 && civ.rural > 60 && r.chance(0.25 + civ.personality.exp * 0.2)) {
            const spots = claimed.map((t) => this.cells[t]).filter((c) => c.city == null && c.habit > 0.4);
            if (spots.length) {
              const s = spots[0];
              const city = this.foundCity(civ, s.idx);
              if (city) {
                for (const n of s.neighbor) {
                  const c = this.cells[n];
                  if (!c.ocean && c.owner === -1 && c.biome !== B.ICE) this.claimCell(civ, n);
                }
                this.log(`Year ${Math.floor(this.year)} — Settlers from ${civ.name} found the frontier town of ${city.name}.`, 'civ', civ.id, s.idx);
              }
            }
          }
        }
        }
      }
      // overseas colonization (medieval+ seafarers; industrial+ anyone with a coast)
      const coastal = civ.territory.some((t) => this.cells[t].coast);
      const colonizeDrive = civ.era >= 6 ? 0.22 : civ.traits.naval > 0.2 ? 0.16 * (0.4 + civ.personality.exp) : 0;
      if (coastal && civ.era >= 4 && colonizeDrive > 0 && r.chance(colonizeDrive)) {
        const spots = this.cells.filter((c) => !c.ocean && c.owner === -1 && c.habit > 0.5 && c.coast);
        if (spots.length) {
          const s = r.pick(spots);
          this.claimCell(civ, s.idx);
          for (const n of s.neighbor) {
            if (!this.cells[n].ocean && this.cells[n].owner === -1) this.claimCell(civ, n);
          }
          this.log(`Year ${Math.floor(this.year)} — ${this.fullCivName(civ)} founds an overseas colony.`, 'civ', civ.id, s.idx);
          civ.history.push(`Year ${Math.floor(this.year)} — our sails found new shores.`);
        }
      }
      // found new city
      const cityThreshold = 200 + civ.era * 260;
      if (civ.rural > cityThreshold && civ.cities.length < 12 && r.chance(0.6)) {
        const spots = civ.territory
          .map((t) => this.cells[t])
          .filter((c) => c.city == null && !c.ocean && c.habit > 0.45);
        if (spots.length) {
          spots.sort((a, b) => (b.habit + (b.river ? 0.3 : 0) + (b.coast ? 0.2 : 0)) - (a.habit + (a.river ? 0.3 : 0) + (a.coast ? 0.2 : 0)));
          const s = spots[0];
          const city = this.foundCity(civ, s.idx);
          if (city) {
            this.log(`Year ${Math.floor(this.year)} — The city of ${city.name} is founded by ${this.fullCivName(civ)}.`, 'civ', civ.id, s.idx);
          }
        }
      }
      // peacetime border drift: frontier towns defect toward stronger neighbors
      if (civ.territory.length && r.chance(0.10 + civ.personality.exp * 0.08)) {
        const ti = r.pick(civ.territory);
        const cell = this.cells[ti];
        let best = null, bestPull = 0;
        for (const n of cell.neighbor) {
          const nc = this.cells[n];
          if (nc.ocean || nc.owner === -1 || nc.owner === civ.id) continue;
          const foe = this.civs[nc.owner];
          if (!foe || !foe.alive || civ.wars.some((w) => w.foe === foe.id)) continue;
          if (cell.city != null && cell.city === civ.capital) continue;
          const pull = (foe.tech - civ.tech) / 500 + (foe.era - civ.era) * 6 + r.range(-6, 3);
          if (pull > bestPull) { bestPull = pull; best = foe; }
        }
        if (best && bestPull > 4) {
          this.claimCell(best, ti);
          const driftCity = cell.city != null ? this.cityById(cell.city) : null;
          if (driftCity && driftCity.civ === civ.id) {
            civ.cities = civ.cities.filter((x) => x !== driftCity.id);
            driftCity.civ = best.id;
            best.cities.push(driftCity.id);
            this.viewsDirty.cities = true;
            this.log(`Year ${Math.floor(this.year)} — ${driftCity.name} defects from ${civ.name} to ${best.name}.`, 'civ', best.id, ti);
          }
        }
      }
      // splinter nations: large / overextended empires can fracture
      const overExt = civ.territory.length > softCap * 2.2;
      if ((civ.territory.length > 90 || overExt) && civ.cities.length > 5 && r.chance((overExt ? 0.06 : 0.02) * (1.2 - civ.personality.uni))) {
        this.splinter(civ);
      }
      // culture / religion events
      if (r.chance(0.05)) {
        const pick = r.next();
        if (pick < 0.3) {
          civ.religion = r.pick(RELIGIONS);
          this.log(`Year ${Math.floor(this.year)} — A new faith spreads through ${civ.name}: ${civ.religion}.`, 'civ', civ.id);
        } else if (pick < 0.55) {
          civ.culture = r.pick(ART);
          this.log(`Year ${Math.floor(this.year)} — ${civ.name} artisans become famed for their ${civ.culture}.`, 'civ', civ.id);
        } else if (pick < 0.75) {
          const old = civ.gov;
          civ.gov = r.pick(GOV_BY_ERA[civ.era]);
          if (old !== civ.gov) this.log(`Year ${Math.floor(this.year)} — ${civ.name} reforms from a ${old} into a ${civ.gov}.`, 'civ', civ.id);
        }
      }
    }

    // diplomacy between pairs
    const alive = this.civs.filter((c) => c.alive);
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const shareBorder = a.territory.some((t) => this.cells[t].neighbor.some((n) => this.cells[n].owner === b.id));
      let rel = a.relations[b.id] ?? 0;
      rel += r.range(-4, 4);
      if (shareBorder) rel -= 1.5;
      // trade brings peace
      const canTrade = shareBorder || (a.era >= 5 && b.era >= 5);
      if (canTrade && rel > -20) rel += 2;
      rel = clamp(rel, -100, 100);
      a.relations[b.id] = rel; b.relations[a.id] = rel;
      const atWar = a.wars.some((w) => w.foe === b.id);

      if (!atWar && rel < -45 && shareBorder && r.chance(0.16 + a.personality.aggr * 0.18 + b.personality.aggr * 0.08)) {
        // declare war
        a.wars.push({ foe: b.id, years: 0 });
        b.wars.push({ foe: a.id, years: 0 });
        this.stats.wars++;
        this.log(`Year ${Math.floor(this.year)} — ${this.fullCivName(a)} declares war on ${this.fullCivName(b)}!`, 'war', a.id);
        a.history.push(`Year ${Math.floor(this.year)} — war with ${b.name} began.`);
        b.history.push(`Year ${Math.floor(this.year)} — war with ${a.name} began.`);
      } else if (!atWar && rel > 60 && !a.allies.includes(b.id) && r.chance(0.12)) {
        a.allies.push(b.id); b.allies.push(a.id);
        this.log(`Year ${Math.floor(this.year)} — ${this.fullCivName(a)} and ${this.fullCivName(b)} sign an alliance.`, 'civ', a.id);
      }
    }
    // trade routes count
    for (const civ of alive) {
      let routes = 0;
      for (const o of alive) {
        if (o.id === civ.id) continue;
        const border = civ.territory.some((t) => this.cells[t].neighbor.some((n) => this.cells[n].owner === o.id));
        if (border || (civ.era >= 5 && (civ.relations[o.id] ?? 0) > 0)) routes++;
      }
      civ.tradeRoutes = Math.min(6, routes);
    }
  }

  makePeace(a, b, how) {
    a.wars = a.wars.filter((w) => w.foe !== b.id);
    b.wars = b.wars.filter((w) => w.foe !== a.id);
    a.relations[b.id] = -10; b.relations[a.id] = -10;
    this.log(`Year ${Math.floor(this.year)} — Peace ${how === 'treaty' ? 'treaty' : ''} between ${this.fullCivName(a)} and ${this.fullCivName(b)}.`, 'civ', a.id);
  }

  splinter(civ) {
    // farthest city breaks away as a new nation
    const cap = this.capitalOf(civ);
    if (!cap || civ.cities.length < 4) return;
    let far = null, fd = -1;
    for (const id of civ.cities) {
      const c = this.cityById(id);
      if (!c || id === civ.capital) continue;
      const d = angDist(c.dir.x, c.dir.y, c.dir.z, cap.dir.x, cap.dir.y, cap.dir.z);
      if (d > fd) { fd = d; far = c; }
    }
    if (!far || fd < 0.25) return;
    const r = this.rng;
    const name = this.civName(r);
    const nc = {
      id: this.civs.length, name, color: CIV_COLORS[this.civs.length % CIV_COLORS.length],
      gov: r.pick(GOV_BY_ERA[civ.era]), culture: civ.culture, food: r.pick(FOODS),
      religion: r.chance(0.5) ? civ.religion : r.pick(RELIGIONS), language: `${name}ic`,
      tech: civ.tech * r.range(0.7, 0.95), era: civ.era,
      territory: [], cities: [], capital: -1,
      rural: civ.rural * 0.3, storedFood: 30,
      relations: {}, wars: [], allies: [], tradeRoutes: 0,
      pollution: civ.pollution, science: 0, alive: true, born: Math.floor(this.year),
      bless: 0,
      personality: { aggr: r.range(0.15, 0.9), cur: r.range(0.3, 1), exp: r.range(0.3, 1), uni: r.range(0.2, 0.9) },
      traits: { ...civ.traits }, space: { stage: -1, progress: 0, satellites: 0 },
      lunarPop: 0, history: [], envAdapted: true,
    };
    nc.colorCss = '#' + nc.color.toString(16).padStart(6, '0');
    this.civs.push(nc);
    for (const o of this.civs) { if (o.id !== nc.id) { nc.relations[o.id] = -20; o.relations[nc.id] = -20; } }
    // transfer nearby territory + cities
    for (const ti of [...civ.territory]) {
      const c = this.cells[ti];
      if (angDist(c.dir.x, c.dir.y, c.dir.z, far.dir.x, far.dir.y, far.dir.z) < fd * 0.6) {
        this.claimCell(nc, ti);
        if (c.city != null) {
          const city = this.cityById(c.city);
          if (city) {
            civ.cities = civ.cities.filter((x) => x !== city.id);
            city.civ = nc.id;
            nc.cities.push(city.id);
          }
        }
      }
    }
    if (nc.cities.length === 0) {
      civ.cities = civ.cities.filter((x) => x !== far.id);
      far.civ = nc.id; nc.cities.push(far.id);
      this.claimCell(nc, far.cell);
    }
    nc.capital = nc.cities[0];
    civ.rural *= 0.7;
    this.log(`Year ${Math.floor(this.year)} — ${far.name} breaks away: ${this.fullCivName(nc)} is born!`, 'civ', nc.id, far.cell);
    this.viewsDirty.cities = true; this.viewsDirty.territory = true;
  }

  // -- ecosystems tick ------------------------------------------------------------
  tickHerds(dt) {
    const r = this.rng;
    for (const h of this.herds) {
      const cell = this.cells[h.cell];
      let K = h.K;
      if (cell.owner !== -1) {
        const civ = this.civs[cell.owner];
        if (civ) {
          K *= (1 - civ.pollution * 0.45);
          if (civ.era >= 6) K *= 0.7;
          // hunting
          const hunt = Math.min(h.n * 0.25, (40 + civ.era * 30) * dt * (h.marine ? 2 : 1));
          if (h.prey) {
            h.n -= hunt * 0.15 * dt * 10 * 0.1;
            civ.storedFood += hunt * 0.02;
          }
        }
      }
      if (cell.forest < 0.3 && (h.kind === 'deer' || h.kind === 'boar')) K *= 0.5;
      h.n += h.n * 0.25 * (1 - h.n / Math.max(20, K)) * dt;
      h.n = clamp(h.n, 0, h.K * 1.2);
      // predation
      if (!h.prey) {
        const prey = this.herds.find((o) => o.cell === h.cell && o.prey && o.n > 10);
        if (prey) { const eat = Math.min(prey.n * 0.1, h.n * 2) * dt; prey.n -= eat; h.n += eat * 0.05; }
      }
      // migrate
      if (r.chance(dt * 0.15)) {
        const nb = r.pick(cell.neighbor);
        const nc = this.cells[nb];
        const ok = h.marine ? nc.ocean : !nc.ocean;
        if (ok) h.cell = nb;
      }
    }
  }

  // -- weather (visual-time storms + climate effects) -------------------------------
  tickStorms(dtReal, warp, dtYears) {
    const r = this.rng;
    // spawn storms by climate
    const targetStorms = 4 + ((r.next() * 3) | 0);
    if (this.storms.length < targetStorms && r.chance(dtReal * 0.05)) {
      const c = this.cells[(r.next() * this.cells.length) | 0];
      const warmOcean = c.ocean && c.temp > 0.55;
      const type = warmOcean && r.chance(0.35) ? 'hurricane' : (c.temp < 0.18 ? 'snowstorm' : (r.chance(0.5) ? 'thunderstorm' : 'rain'));
      this.storms.push({
        id: this.stormId++, cell: c.idx, type,
        intensity: r.range(0.4, 1) * (type === 'hurricane' ? 1.4 : 1),
        life: r.range(40, 140), // real seconds at 1x
        dir: { ...c.dir },
      });
    }
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const st = this.storms[i];
      st.life -= dtReal * Math.min(warp, 6);
      // drift
      if (r.chance(dtReal * 0.4)) {
        const cell = this.cells[st.cell];
        const nb = r.pick(cell.neighbor);
        st.cell = nb;
        st.dir = { ...this.cells[nb].dir };
      }
      // effects on ground (per year while active)
      if (dtYears > 0) {
        const cell = this.cells[st.cell];
        if (cell.city != null) {
          const city = this.cityById(cell.city);
          if (city && st.type === 'hurricane' && st.intensity > 0.9) {
            city.damage = Math.min(1, city.damage + dtYears * 0.05 * st.intensity);
            city.pop *= (1 - 0.004 * dtYears * st.intensity);
          }
          if (city && (st.type === 'rain' || st.type === 'thunderstorm')) {
            const civ = this.civs[city.civ];
            if (civ) civ.storedFood += dtYears * 2 * st.intensity;
          }
        }
      }
      if (st.life <= 0) this.storms.splice(i, 1);
    }
  }

  // -- lunar colony ---------------------------------------------------------------
  tickMoon(dt) {
    if (this.moon.bases.length === 0) return;
    let total = 0;
    for (const b of this.moon.bases) {
      const civ = this.civs[b.civ];
      if (!civ || !civ.alive) continue;
      const cap = b.size >= 3 ? 50000 : b.size >= 2 ? 4000 : 300;
      civ.lunarPop += Math.max(2, civ.lunarPop * 0.02) * dt * (1 - civ.lunarPop / cap);
      civ.lunarPop = Math.min(cap, civ.lunarPop);
      if (b.size < 3 && civ.lunarPop > (b.size >= 2 ? 3000 : 250) && this.rng.chance(dt * 0.1)) {
        b.size++;
        this.log(`Year ${Math.floor(this.year)} — The lunar colony of ${civ.name} expands (domes, mines, landing pads).`, 'space', civ.id);
      }
      total += civ.lunarPop;
    }
    this.moon.pop = total;
  }

  // -- disasters ------------------------------------------------------------------
  randomDisaster() {
    const r = this.rng;
    const roll = r.next();
    const land = () => r.pick(this.cells.filter((c) => !c.ocean));
    if (roll < 0.22) {
      const c = land();
      this.triggerDisaster('earthquake', c.idx, 'nature');
    } else if (roll < 0.34) {
      const mtns = this.cells.filter((c) => c.biome === B.MOUNTAIN || c.elev > 0.5);
      this.triggerDisaster('volcano', (mtns.length ? r.pick(mtns) : land()).idx, 'nature');
    } else if (roll < 0.46) {
      const coasts = this.cells.filter((c) => c.coast);
      if (coasts.length) this.triggerDisaster('hurricane', r.pick(coasts).idx, 'nature');
      else this.triggerDisaster('storm', land().idx, 'nature');
    } else if (roll < 0.58) {
      const forests = this.cells.filter((c) => c.forest > 0.5);
      if (forests.length && r.chance(0.7)) this.triggerDisaster('wildfire', r.pick(forests).idx, 'nature');
      else this.triggerDisaster('drought', land().idx, 'nature');
    } else if (roll < 0.68) {
      const wet = this.cells.filter((c) => !c.ocean && (c.river || c.precip > 0.6));
      this.triggerDisaster('flood', (wet.length ? r.pick(wet) : land()).idx, 'nature');
    } else if (roll < 0.74) {
      this.triggerDisaster('meteor', (r.next() * this.cells.length) | 0, 'nature');
    } else if (roll < 0.82) {
      const ocean = this.cells.filter((c) => c.ocean && c.elev > -0.4);
      if (ocean.length) this.triggerDisaster('tsunami', r.pick(ocean).idx, 'nature');
    } else if (roll < 0.90) {
      this.triggerDisaster('plague', land().idx, 'nature');
    }
    // else: quiet years
  }

  triggerDisaster(type, cellIdx, cause = 'nature') {
    const cell = this.cells[cellIdx];
    if (!cell) return;
    const dir = { ...cell.dir };
    this.stats.disasters++;
    const byGod = cause === 'god' ? 'Your wrath falls: ' : '';
    const R = 0.09; // effect radius (radians)
    const affected = this.cellsNear(dir, R, 30);
    let deaths = 0;
    const killFrac = { earthquake: 0.16, volcano: 0.3, hurricane: 0.10, wildfire: 0.06, flood: 0.08, meteor: 0.55, tsunami: 0.28, plague: 0.22, storm: 0.02, drought: 0.05 }[type] || 0.05;

    for (const ai of affected) {
      const c = this.cells[ai];
      const d = angDist(c.dir.x, c.dir.y, c.dir.z, dir.x, dir.y, dir.z);
      const fall = 1 - d / R;
      if (c.city != null) {
        const city = this.cityById(c.city);
        if (city) {
          const dead = city.pop * killFrac * fall;
          deaths += dead;
          city.pop -= dead;
          city.damage = Math.min(1, city.damage + killFrac * 2 * fall);
        }
      }
      if (c.owner !== -1) {
        const civ = this.civs[c.owner];
        if (civ) { const rd = civ.rural * 0.02 * killFrac * fall; deaths += rd; civ.rural -= rd; }
      }
      if (type === 'wildfire' && c.forest > 0) {
        c.forest = Math.max(0, c.forest - 0.7 * fall);
        this.planet.addPaint(c.dir, 0.03, 0.25, 0.20, 0.16, 0.7);
      }
      if (type === 'volcano' && fall > 0.5) {
        c.fertility = Math.min(1.4, c.fertility + 0.2); // volcanic soil, later
        this.planet.addPaint(c.dir, 0.035, 0.30, 0.22, 0.20, 0.8);
      }
      if (type === 'meteor' && fall > 0.4) {
        this.planet.addBump(c.dir, 0.02, -0.35);
        this.planet.addPaint(c.dir, 0.03, 0.22, 0.18, 0.16, 0.85);
      }
    }
    // herds suffer
    for (const h of this.herds) {
      const hc = this.cells[h.cell];
      if (angDist(hc.dir.x, hc.dir.y, hc.dir.z, dir.x, dir.y, dir.z) < R) h.n *= (1 - killFrac);
    }

    this.visualQueue.push({ t: 'disaster', kind: type, dir, cell: cellIdx });
    this.viewsDirty.cities = true;

    const place = cell.city != null ? `near ${this.cityById(cell.city)?.name || 'a city'}` : `in the ${BIOME_INFO[cell.biome].name.toLowerCase()} wilds`;
    const msgs = {
      earthquake: `a mighty earthquake strikes ${place}`,
      volcano: `a volcano erupts ${place}, spewing ash across the sky`,
      hurricane: `a great hurricane batters the coast ${place}`,
      storm: `a violent storm rages ${place}`,
      wildfire: `wildfires sweep through the forests ${place}`,
      drought: `a cruel drought parches the land ${place}`,
      flood: `floodwaters drown the fields ${place}`,
      meteor: `a meteor slams into the planet ${place}`,
      tsunami: `a tsunami crashes ashore ${place}`,
      plague: `a terrible plague spreads ${place}`,
    };
    const owner = cell.owner !== -1 ? this.civs[cell.owner] : null;
    const msg = `Year ${Math.floor(this.year)} — ${byGod}${msgs[type] || 'disaster strikes'}${deaths > 50 ? ` (${fmtPop(deaths)} perish)` : ''}.`;
    this.log(msg, 'disaster', owner ? owner.id : -1, cellIdx);
    if (type === 'meteor') this.viewsDirty.territory = true;
  }

  // -- god powers -------------------------------------------------------------------
  godForest(dir) {
    const idxs = this.cellsNear(dir, 0.07, 24);
    let n = 0;
    for (const i of idxs) {
      const c = this.cells[i];
      if (!c.ocean && c.temp > 0.15) {
        c.forest = 1; c.res.wood = 1;
        c.fertility = Math.min(1.4, c.fertility + 0.1);
        this.planet.addPaint(c.dir, 0.03, 0.14, 0.40, 0.18, 0.9);
        n++;
      }
    }
    this.visualQueue.push({ t: 'godForest', dir: { ...dir } });
    this.log(`Year ${Math.floor(this.year)} — Forests spring from the earth where the gods touched the world.`, 'god');
    return n;
  }

  godRaiseTerrain(dir, amount, radius = 0.06) {
    this.planet.addBump(dir, radius, amount);
    const idxs = this.cellsNear(dir, radius * 1.4, 40);
    const s = {};
    for (const i of idxs) {
      const c = this.cells[i];
      this.planet.sample(c.dir.x, c.dir.y, c.dir.z, s);
      c.elev = s.elevation; c.temp = s.temperature; c.precip = s.precip;
      c.biome = s.biome; c.ocean = s.ocean;
      if (c.ocean && c.city != null) {
        // swallowed by the sea!
        const city = this.cityById(c.city);
        if (city) {
          const civ = this.civs[city.civ];
          if (civ) civ.cities = civ.cities.filter((x) => x !== city.id);
          this.cities = this.cities.filter((x) => x.id !== city.id);
          c.city = null;
          this.log(`Year ${Math.floor(this.year)} — ${city.name} sinks beneath the waves!`, 'god', city.civ, i);
        }
      }
      c.coast = !c.ocean && c.neighbor.some((nn) => this.cells[nn].ocean);
    }
    this.visualQueue.push({ t: 'terraform', dir: { ...dir } });
    this.viewsDirty.cities = true; this.viewsDirty.territory = true;
  }

  godLake(dir) {
    this.planet.addBump(dir, 0.035, -0.35);
    this.godRaiseTerrain(dir, 0, 0.05); // refresh cells
    this.planet.addPaint(dir, 0.03, 0.10, 0.28, 0.38, 0.8);
    this.log(`Year ${Math.floor(this.year)} — A lake shimmers into being.`, 'god');
  }

  godRain(dir) {
    const idx = this.nearestCell(dir);
    this.storms.push({ id: this.stormId++, cell: idx, type: 'rain', intensity: 1, life: 90, dir: { ...dir } });
    const c = this.cells[idx];
    if (c.owner !== -1 && this.civs[c.owner]) this.civs[c.owner].storedFood += 60;
    this.log(`Year ${Math.floor(this.year)} — Gentle rains bless the land.`, 'god');
  }

  godStorm(dir) {
    const idx = this.nearestCell(dir);
    this.storms.push({ id: this.stormId++, cell: idx, type: 'thunderstorm', intensity: 1.6, life: 120, dir: { ...dir } });
    this.visualQueue.push({ t: 'disaster', kind: 'storm', dir: { ...dir }, cell: idx });
    this.log(`Year ${Math.floor(this.year)} — The gods hurl lightning from black clouds.`, 'god');
  }

  godFire(dir) {
    const idx = this.nearestCell(dir);
    this.triggerDisaster('wildfire', idx, 'god');
  }

  godQuake(dir) {
    const idx = this.nearestCell(dir);
    this.triggerDisaster('earthquake', idx, 'god');
  }

  godVolcano(dir) {
    const idx = this.nearestCell(dir);
    this.triggerDisaster('volcano', idx, 'god');
  }

  godMeteor(dir) {
    const idx = this.nearestCell(dir);
    this.triggerDisaster('meteor', idx, 'god');
  }

  godBless(civId) {
    const civ = this.civs[civId];
    if (!civ || !civ.alive) return;
    civ.bless = 40;
    civ.tech += 200;
    civ.storedFood += 300;
    this.log(`Year ${Math.floor(this.year)} — Divine light shines upon ${this.fullCivName(civ)}. Crops flourish, minds quicken.`, 'god', civ.id);
    const cap = this.capitalOf(civ);
    if (cap) this.visualQueue.push({ t: 'bless', dir: { ...cap.dir }, cell: cap.cell });
  }

  godSmite(dir) {
    const idx = this.nearestCell(dir);
    const c = this.cells[idx];
    if (c.city != null) {
      const city = this.cityById(c.city);
      const civ = this.civs[city.civ];
      this.log(`Year ${Math.floor(this.year)} — ${city.name} is annihilated by divine fire.`, 'god', city.civ, idx);
      if (civ) civ.cities = civ.cities.filter((x) => x !== city.id);
      this.cities = this.cities.filter((x) => x.id !== city.id);
      c.city = null;
      this.planet.addPaint(dir, 0.04, 0.15, 0.12, 0.12, 0.9);
      this.visualQueue.push({ t: 'disaster', kind: 'smite', dir: { ...dir }, cell: idx });
      this.viewsDirty.cities = true;
    } else {
      this.triggerDisaster('meteor', idx, 'god');
    }
  }

  spawnLife(dir) {
    const idx = this.nearestCell(dir);
    const c = this.cells[idx];
    if (c.ocean) {
      this.herds.push({ id: UID++, kind: 'fish', prey: true, cell: idx, n: 1500, K: 6000, marine: true });
    } else {
      this.herds.push({ id: UID++, kind: 'deer', prey: true, cell: idx, n: 400, K: 900 });
      this.herds.push({ id: UID++, kind: 'rabbit', prey: true, cell: idx, n: 600, K: 2400 });
    }
    this.visualQueue.push({ t: 'bless', dir: { ...dir }, cell: idx });
    this.log(`Year ${Math.floor(this.year)} — Wild creatures multiply where the gods breathed life.`, 'god');
  }
}
