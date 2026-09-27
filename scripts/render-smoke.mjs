// Headless 3D test: constructs the full Three.js scene graph (no GPU needed),
// runs hundreds of frames of planet + living-world rendering, forces every
// visual system (rockets, satellites, moon base, effects, disasters, citizens,
// eclipses, comets, terraform refresh) and fails on any exception.
// Run: node scripts/render-smoke.mjs

// --- minimal DOM/canvas stubs (textures never upload without a renderer) ---
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') {
        return () => ({ addColorStop() {} });
      }
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'measureText') return () => ({ width: 8 });
      return () => {};
    },
    set() { return true; },
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx(), addEventListener() {} };
}
globalThis.document = { createElement: () => makeCanvas() };
globalThis.window = globalThis;

const THREE = await import('three');
const { PlanetData, World } = await import('../src/world.js');
const { PlanetView } = await import('../src/planetView.js');
const { WorldView } = await import('../src/worldView.js');

console.log('\n=== TERRASIM render smoke (headless) ===\n');
const seed = 20260704;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 60000);
camera.position.set(2600, 400, 600);

const planet = new PlanetData(seed);
const world = new World(planet, seed, { cellCount: 500, civCount: 6 });
const pv = new PlanetView(scene, planet, seed);
const wv = new WorldView(scene, pv, world);
wv.rebuildCities();
wv.rebuildTerritory();
wv.syncFauna();
console.log('scene constructed: OK');

// simulate frames across zooms + warps
const city = world.cities[0];
for (let i = 0; i < 500; i++) {
  const warp = i % 3 === 0 ? 100 : 5;
  world.update(0.5, 0.05, warp);
  const { sunDir } = pv.update(0.05, warp, world, camera);
  wv.update(0.05, warp, camera, sunDir);
  if (i === 60) {
    // dive close to a city → exercises citizen LOD
    const wp = wv.cityWorldPos(city, new THREE.Vector3());
    const pp = pv.planetWorldPos(new THREE.Vector3());
    const up = wp.clone().sub(pp).normalize();
    camera.position.copy(wp).addScaledVector(up, 8);
  }
  if (i === 120) {
    // god mayhem
    world.godMeteor({ ...world.cells[30].dir });
    world.godRaiseTerrain({ ...world.cells[60].dir }, 0.4, 0.06);
    world.godForest({ ...world.cells[90].dir });
    world.triggerDisaster('volcano', 120);
    world.triggerDisaster('tsunami', 10);
    pv.markTerrainDirty();
  }
  if (i === 200) {
    // pull back to system view + comet + eclipses logging
    const pp = pv.planetWorldPos(new THREE.Vector3());
    camera.position.copy(pp).add(new THREE.Vector3(900, 1900, 2400));
    pv.fireComet();
    world.onEclipse('solar');
    world.onEclipse('lunar');
    pv.setOrbitLinesVisible(false);
    pv.setOrbitLinesVisible(true);
  }
}
console.log('500 frames (surface → system, warp 5/100): OK');

// force every effect type
for (const t of ['explosion', 'fire', 'smoke', 'eruption', 'meteor', 'splash', 'battle', 'bless', 'smite', 'launchFlash', 'terraform', 'godForest', 'arrivalFlash', 'shower']) {
  wv.spawnEffect(t, { ...world.cells[40].dir }, 1.5);
}
for (let i = 0; i < 60; i++) wv.updateEffects(0.05, 5);
console.log('all effect types: OK');

// rockets through full flight
const cap = world.capitalOf(world.civs[0]);
const r1 = wv.launchRocket(0, cap.id, 'colony');
const r2 = wv.launchRocket(1, world.capitalOf(world.civs[1]).id, 'sat');
if (!r1 || !r2) throw new Error('rocket pool failed');
for (let i = 0; i < 200; i++) wv.updateRockets(0.5, 10);
console.log('rocket flights (lunar + orbital): OK');
wv.spawnEffectAtWorld('arrivalFlash', pv.moonWorldPos(new THREE.Vector3()), 4);

// satellites + moon base + era visuals
world.civs[0].space.satellites = 12;
wv.syncSatellites();
for (let i = 0; i < 30; i++) wv.updateSatellites(0.1, 10);
world.moon.bases.push({ civ: 0, size: 3 });
wv.syncMoonBase();
for (const c of world.civs) c.era = 9;
world.viewsDirty.cities = true;
wv.rebuildCities();
for (const c of world.civs) c.era = 4;
world.viewsDirty.cities = true;
wv.rebuildCities();
console.log('satellites, lunar base, era rebuilds: OK');

// fauna + citizens + storms + selection
wv.syncFauna();
wv.updateFauna(0.5);
wv.setCitizenCity(city);
wv.updateCitizens(0.5);
wv.setSelection(new THREE.Vector3(city.dir.x, city.dir.y, city.dir.z), 3, 0xffffff);
world.storms.push({ id: 999, cell: 50, type: 'hurricane', intensity: 1.4, life: 60, dir: { ...world.cells[50].dir } });
wv.syncStorms();
pv.refreshTerrain();
console.log('fauna, citizens, storms, selection, terrain refresh: OK');
console.log('phases:', PlanetView.phaseName(pv.dayPhase()), '/', pv.moonPhaseName());

console.log('\nRENDER SMOKE PASSED\n');
