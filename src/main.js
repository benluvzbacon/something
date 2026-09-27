// ---------------------------------------------------------------------------
// main.js — game boot, render loop, camera, input, selection, god powers.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TAU, clamp } from './noise.js';
import { World, PlanetData, YEARS_PER_SECOND, PLANET_R, WORLD_SCALE } from './world.js';
import { PlanetView, MOON_DIST, ORBIT_DIST } from './planetView.js';
import { WorldView } from './worldView.js';
import { UI } from './ui.js';

export const SPEEDS = [0, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 1000];

const FIRST = ['Ada', 'Bryn', 'Cato', 'Dara', 'Elin', 'Finn', 'Gaia', 'Hald', 'Ilya', 'Juno', 'Kai', 'Lena', 'Mira', 'Niko', 'Ona', 'Petr', 'Quin', 'Rhea', 'Seth', 'Tara', 'Ulf', 'Vera', 'Wren', 'Yuki', 'Zane', 'Ash', 'Birgit', 'Cole', 'Dov', 'Eska'];
const LAST = ['Stone', 'Brook', 'Field', 'Wood', 'Shore', 'Fell', 'Gard', 'Holm', 'Mar', 'Vik', 'Ash', 'Thorn', 'Reed', 'Hale', 'Nor'];
const ROLES_OLD = ['Farmer', 'Fisher', 'Hunter', 'Miner', 'Smith', 'Trader', 'Healer', 'Scribe', 'Priest', 'Soldier', 'Sailor', 'Weaver', 'Scout', 'Elder', 'Builder', 'Herder'];
const ROLES_NEW = ['Engineer', 'Doctor', 'Teacher', 'Pilot', 'Scientist', 'Programmer', 'Nurse', 'Architect', 'Mechanic', 'Officer', 'Researcher', 'Technician', 'Astronaut'];

function frame() { return new Promise((r) => requestAnimationFrame(r)); }

class Game {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.seed = (parseInt(params.get('seed') || '', 10) >>> 0) || ((Math.random() * 0xffffffff) >>> 0);
    this.warpIndex = 6;
    this.warp = SPEEDS[this.warpIndex];
    this.prevWarpIndex = 6;
    this.godPower = 'inspect';
    this.selection = { kind: 'none' };
    this.follow = { kind: 'planet' }; // camera always tracks the planet by default
    this.followPrev = new THREE.Vector3();
    this.followInit = false;
    this.camTween = null;
    this.keys = new Set();
    this.fps = 60;
    this.quality = 0; // 0 high, 1 med, 2 low
    this.qTimer = 0;
  }

  setLoad(pct, step) {
    document.querySelector('#load-fill').style.width = `${pct}%`;
    document.querySelector('#load-step').textContent = step;
  }

  async init() {
    this.setLoad(6, 'Igniting star…');
    await frame();
    const container = document.querySelector('#scene');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040a);
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 60000);
    this.camera.position.set(ORBIT_DIST + 260, 190, 320);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    // Planet-locked camera: no panning — left-drag AND right-drag orbit,
    // wheel zooms, and the view always faces the tracked body.
    this.controls.enablePan = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.minDistance = 3.2 * WORLD_SCALE;
    this.controls.maxDistance = 22000;
    this.controls.zoomSpeed = 1.15;
    this.controls.addEventListener('start', () => { this.camTween = null; });

    this.setLoad(18, 'Condensing planet…');
    await frame();
    // world (pure sim) + planet data
    this.planetData = new PlanetData(this.seed);
    this.setLoad(34, 'Raising continents…');
    await frame();
    this.world = new World(this.planetData, this.seed, { cellCount: 1500, civCount: 7 });
    this.setLoad(58, 'Seeding life…');
    await frame();
    this.planetView = new PlanetView(this.scene, this.planetData, this.seed);
    this.setLoad(74, 'Founding tribes…');
    await frame();
    this.worldView = new WorldView(this.scene, this.planetView, this.world);
    this.worldView.rebuildCities();
    this.worldView.rebuildTerritory();
    this.worldView.syncFauna();
    this.setLoad(88, 'Building interface…');
    await frame();
    this.ui = new UI(this);
    this.setLoad(100, 'Opening your eyes…');
    await frame();

    this.bindInput();
    addEventListener('resize', () => this.onResize());

    // opening shot: full planet, camera locked on
    const pp = this.planetView.planetWorldPos(new THREE.Vector3());
    this.controls.target.copy(pp);
    this.camera.position.copy(pp).add(new THREE.Vector3(200, 150, 260).multiplyScalar(WORLD_SCALE));
    this.follow = { kind: 'planet' };

    document.querySelector('#loading').classList.add('done');
    setTimeout(() => {
      this.ui.toast('Drag to orbit · scroll to zoom · click a city to inspect · god powers on the left', 6000);
    }, 600);

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // -- input ----------------------------------------------------------------------
  bindInput() {
    const el = this.renderer.domElement;
    let downX = 0, downY = 0;
    el.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
    el.addEventListener('pointerup', (e) => {
      const dx = e.clientX - downX, dy = e.clientY - downY;
      if (dx * dx + dy * dy < 25) this.handleClick(e);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys.add(e.code);
      if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
      const digit = { Digit1: 3, Digit2: 4, Digit3: 5, Digit4: 6, Digit5: 7, Digit6: 8, Digit7: 9, Digit8: 10 }[e.code];
      if (digit !== undefined) this.setWarpIndex(digit);
      if (e.code === 'Escape') this.deselect();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  handleClick(e) {
    const r = new THREE.Raycaster();
    const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    r.setFromCamera(m, this.camera);
    // sun / moon first
    const hits = r.intersectObjects([this.planetView.sunMesh, this.planetView.moonMesh], false);
    if (hits.length) {
      const o = hits[0].object;
      if (o === this.planetView.sunMesh) { this.selection = { kind: 'sun' }; this.worldView.setSelection(null); this.ui.switchTab('inspect'); return; }
      if (o === this.planetView.moonMesh) {
        if (this.godPower !== 'inspect' && this.godPower !== 'bless') { this.ui.toast('Your powers shape the living world, not the Moon — yet.'); return; }
        this.selection = { kind: 'moon' }; this.worldView.setSelection(null); this.ui.switchTab('inspect'); return;
      }
    }
    // terrain
    const th = r.intersectObject(this.planetView.terrainMesh, false);
    if (!th.length) { return; }
    const wp = th[0].point;
    // world → spin-local direction
    this.worldView.spin.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(this.worldView.spin.matrixWorld).invert();
    const local = wp.clone().applyMatrix4(inv);
    const dir = local.normalize();

    if (this.godPower === 'inspect') {
      // city? (threshold scales with zoom)
      const { city, dist } = this.worldView.nearestCity(dir);
      const thresh = this.camDistToPlanet() < 60 ? 0.05 : 0.028;
      if (city && dist < thresh) { this.selectCity(city.id); return; }
      const cellIdx = this.world.nearestCell(dir);
      this.selection = { kind: 'cell', cell: cellIdx };
      this.worldView.setSelection(new THREE.Vector3(dir.x, dir.y, dir.z), 1.6, 0xffffff);
      this.ui.switchTab('inspect');
    } else {
      this.applyGod(dir, wp);
    }
  }

  applyGod(dir, worldPoint) {
    const w = this.world;
    const p = this.godPower;
    const cellIdx = w.nearestCell(dir);
    const cell = w.cells[cellIdx];
    if (p === 'forest') { w.godForest(dir); this.planetView.markTerrainDirty(); }
    else if (p === 'mountain') { w.godRaiseTerrain(dir, 0.34, 0.055); }
    else if (p === 'valley') { w.godRaiseTerrain(dir, -0.34, 0.055); }
    else if (p === 'lake') { w.godLake(dir); this.planetView.markTerrainDirty(); }
    else if (p === 'life') { w.spawnLife(dir); }
    else if (p === 'rain') { w.godRain(dir); }
    else if (p === 'storm') { w.godStorm(dir); }
    else if (p === 'fire') { w.godFire(dir); this.planetView.markTerrainDirty(); }
    else if (p === 'quake') {
      if (cell.ocean) w.triggerDisaster('tsunami', cellIdx, 'god');
      else w.godQuake(dir);
      if (this.camDistToPlanet() < 200) this.shake = 1;
    }
    else if (p === 'volcano') { w.godVolcano(dir); this.planetView.markTerrainDirty(); }
    else if (p === 'meteor') { w.godMeteor(dir); if (this.camDistToPlanet() < 300) this.shake = 1.4; }
    else if (p === 'bless') {
      const { city } = this.worldView.nearestCity(dir);
      const civId = city ? city.civ : cell.owner;
      if (civId !== undefined && civId !== -1 && w.civs[civId]?.alive) w.godBless(civId);
      else this.ui.toast('Bless a nation — click one of its cities.');
    }
    else if (p === 'smite') { w.godSmite(dir); this.planetView.markTerrainDirty(); }
    this.ui.renderTab(true);
  }

  setGodPower(id) {
    this.godPower = id;
    const names = { inspect: 'Inspect', forest: 'Grow Forest', mountain: 'Raise Land', valley: 'Lower Land', lake: 'Create Lake', life: 'Spawn Wildlife', rain: 'Blessed Rain', storm: 'Great Storm', fire: 'Wildfire', quake: 'Earthquake', volcano: 'Volcano', meteor: 'Meteor Strike', bless: 'Bless Nation', smite: 'Smite' };
    if (id !== 'inspect') this.ui.toast(`${names[id]} selected — click the planet to unleash it`);
    this.renderer.domElement.style.cursor = id === 'inspect' ? 'default' : 'crosshair';
  }

  // -- selection / follow ---------------------------------------------------------------
  selectCity(id) {
    const city = this.world.cityById(id);
    if (!city) return;
    this.selection = { kind: 'city', city: id, cell: city.cell };
    const civ = this.world.civs[city.civ];
    this.worldView.setSelection(new THREE.Vector3(city.dir.x, city.dir.y, city.dir.z), (city._spread || 2) + 1.2, civ ? civ.color : 0xffffff);
    this.ui.switchTab('inspect');
  }

  selectCiv(id) {
    const civ = this.world.civs[id];
    if (!civ) return;
    const cap = this.world.capitalOf(civ);
    this.selection = { kind: 'civ', civ: id, cell: cap ? cap.cell : null };
    if (cap) this.worldView.setSelection(new THREE.Vector3(cap.dir.x, cap.dir.y, cap.dir.z), (cap._spread || 2) + 1.6, civ.color);
    else this.worldView.setSelection(null);
  }

  deselect() {
    this.selection = { kind: 'none' };
    this.worldView.setSelection(null);
    if (this.ui.tab === 'inspect') this.ui.renderTab(true);
  }

  sampleResidents(city, n) {
    const civ = this.world.civs[city.civ];
    const modern = civ && civ.era >= 7;
    const roles = modern ? ROLES_NEW : ROLES_OLD;
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = (city.seed * 31 + i * 101) >>> 0;
      out.push({
        name: `${FIRST[h % FIRST.length]} ${(LAST[(h >> 3) % LAST.length])}${(h >> 5) % 2 ? 'son' : ''}`,
        age: 14 + (h >> 4) % 58,
        role: roles[(h >> 7) % roles.length],
        city: city.id, idx: i,
      });
    }
    return out;
  }

  followPersonIn(cityId, idx) {
    const city = this.world.cityById(cityId);
    if (!city) return;
    const p = this.sampleResidents(city, idx + 1)[idx];
    const h = (city.seed * 31 + idx * 101) >>> 0;
    p.a = (h % 628) / 100;
    p.rr = 0.8 + ((h >> 2) % 100) / 100 * ((city._spread || 2) * 1.2);
    p.sp = 0.15 + ((h >> 5) % 100) / 100 * 0.35;
    this.selection = { kind: 'person', person: p };
    this.worldView.followPerson = p;
    this.worldView.setCitizenCity(city);
    this.setFollow({ kind: 'person', person: p });
    this.ui.switchTab('inspect');
  }

  setFollow(f) {
    // null = release back to the default planet lock (camera always tracks it)
    this.follow = f || { kind: 'planet' };
    this.followInit = false;
    if (this.follow.kind !== 'person') this.worldView.followPerson = null;
  }

  gotoCity(id) {
    const city = this.world.cityById(id);
    if (!city) return;
    const wp = this.worldView.cityWorldPos(city, new THREE.Vector3());
    const pp = this.planetView.planetWorldPos(new THREE.Vector3());
    const up = wp.clone().sub(pp).normalize();
    const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const to = wp.clone().addScaledVector(up, 7 * WORLD_SCALE).addScaledVector(side, 5 * WORLD_SCALE);
    this.flyTo(to, wp, 1.8);
    this.setFollow({ kind: 'city', city: id });
  }

  followCity(id) { this.setFollow({ kind: 'city', city: id }); this.gotoCity(id); }
  followCiv(id) {
    const cap = this.world.capitalOf(this.world.civs[id]);
    if (cap) { this.setFollow({ kind: 'civ', civ: id }); this.gotoCity(cap.id); this.setFollow({ kind: 'civ', civ: id }); }
  }
  gotoCiv(id) {
    const cap = this.world.capitalOf(this.world.civs[id]);
    if (cap) this.gotoCity(cap.id);
  }

  locateCell(idx) {
    const cell = this.world.cells[idx];
    if (!cell) return;
    const local = new THREE.Vector3(cell.dir.x, cell.dir.y, cell.dir.z).multiplyScalar(PLANET_R + 1);
    this.worldView.spin.updateWorldMatrix(true, false);
    const wp = local.applyMatrix4(this.worldView.spin.matrixWorld);
    const pp = this.planetView.planetWorldPos(new THREE.Vector3());
    const up = wp.clone().sub(pp).normalize();
    // swing the camera around to face this spot; target stays on the planet
    this.setFollow({ kind: 'planet' });
    this.flyTo(wp.clone().addScaledVector(up, 42 * WORLD_SCALE), pp, 1.8);
  }

  focusLatLon(lat, lon) {
    const d = this.planetData.dirFromLatLon(lat, lon, {});
    const local = new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(PLANET_R + 1);
    this.worldView.spin.updateWorldMatrix(true, false);
    const wp = local.applyMatrix4(this.worldView.spin.matrixWorld);
    const pp = this.planetView.planetWorldPos(new THREE.Vector3());
    const up = wp.clone().sub(pp).normalize();
    this.setFollow({ kind: 'planet' });
    this.flyTo(wp.clone().addScaledVector(up, 60 * WORLD_SCALE), pp, 1.8);
  }

  gotoPreset(name) {
    const pp = this.planetView.planetWorldPos(new THREE.Vector3());
    if (name === 'surface' || name === 'nation') {
      const lead = this.world.leaderCiv();
      const cap = lead && this.world.capitalOf(lead);
      const city = cap || this.world.cities[0];
      if (!city) return;
      const wp = this.worldView.cityWorldPos(city, new THREE.Vector3());
      const up = wp.clone().sub(pp).normalize();
      const dist = (name === 'surface' ? 9 : 60) * WORLD_SCALE;
      const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      side.normalize();
      this.setFollow({ kind: 'city', city: city.id });
      this.flyTo(wp.clone().addScaledVector(up, dist).addScaledVector(side, dist * 0.6), wp, 2.0);
      this.selectCity(city.id);
    } else if (name === 'planet') {
      this.setFollow({ kind: 'planet' });
      const dir = this.camera.position.clone().sub(pp).normalize();
      this.flyTo(pp.clone().addScaledVector(dir, 360 * WORLD_SCALE), pp, 2.2);
    } else if (name === 'moon') {
      const mp = this.planetView.moonWorldPos(new THREE.Vector3());
      this.setFollow({ kind: 'moon' });
      this.flyTo(mp.clone().add(new THREE.Vector3(55, 34, 62).multiplyScalar(WORLD_SCALE)), mp, 2.2);
      this.selection = { kind: 'moon' };
      this.ui.switchTab('inspect');
    } else if (name === 'system') {
      this.setFollow({ kind: 'planet' });
      const to = pp.clone().add(new THREE.Vector3(900, 1900, 2400).multiplyScalar(WORLD_SCALE));
      this.flyTo(to, pp, 2.6);
    }
  }

  flyTo(pos, target, dur = 2) {
    this.camTween = {
      t: 0, dur,
      fromPos: this.camera.position.clone(), toPos: pos.clone(),
      fromTg: this.controls.target.clone(), toTg: target.clone(),
      off: pos.clone().sub(target), // camera offset, re-anchored to follow target each frame
    };
  }

  followAnchor(out, dt) {
    const f = this.follow;
    if (!f) return null;
    if (f.kind === 'planet') return this.planetView.planetWorldPos(out);
    if (f.kind === 'city') {
      const c = this.world.cityById(f.city);
      return c ? this.worldView.cityWorldPos(c, out) : null;
    }
    if (f.kind === 'civ') {
      const civ = this.world.civs[f.civ];
      const cap = civ && this.world.capitalOf(civ);
      return cap ? this.worldView.cityWorldPos(cap, out) : null;
    }
    if (f.kind === 'moon') return this.planetView.moonWorldPos(out);
    if (f.kind === 'sun') return out.set(0, 0, 0);
    if (f.kind === 'rocket') {
      const r = this.worldView.rockets[f.idx];
      return r && r.active ? out.copy(r.g.position) : null;
    }
    if (f.kind === 'person') {
      const p = f.person;
      const city = this.world.cityById(p.city);
      if (!city) return null;
      p.a += p.sp * dt;
      const cell = this.world.cells[city.cell];
      const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
      const d = city.dir;
      const up = new THREE.Vector3(d.x, d.y, d.z);
      const ref = Math.abs(up.y) > 0.93 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      t1.crossVectors(up, ref).normalize();
      t2.crossVectors(up, t1).normalize();
      const h = this.worldView.surfH(cell.elev) + 0.4;
      out.set(d.x, d.y, d.z).multiplyScalar(PLANET_R + h)
        .addScaledVector(t1, Math.cos(p.a) * p.rr)
        .addScaledVector(t2, Math.sin(p.a) * p.rr);
      this.worldView.spin.updateWorldMatrix(true, false);
      return out.applyMatrix4(this.worldView.spin.matrixWorld);
    }
    return null;
  }

  // -- speed ----------------------------------------------------------------------------------
  setWarpIndex(i) {
    this.warpIndex = clamp(i, 0, SPEEDS.length - 1);
    this.warp = SPEEDS[this.warpIndex];
    if (this.warp !== 0) this.prevWarpIndex = this.warpIndex;
  }
  togglePause() {
    if (this.warp === 0) this.setWarpIndex(this.prevWarpIndex || 6);
    else { this.prevWarpIndex = this.warpIndex; this.setWarpIndex(0); }
  }

  camDistToPlanet() {
    const pp = this.planetView.planetWorldPos(new THREE.Vector3());
    return this.camera.position.distanceTo(pp) - PLANET_R;
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // -- per-frame ----------------------------------------------------------------------------------
  tick() {
    const dtReal = Math.min(this.clock.getDelta(), 0.1);
    const fpsNow = dtReal > 0 ? 1 / dtReal : 60;
    this.fps += (fpsNow - this.fps) * 0.05;
    const warp = this.warp;
    const dtYears = dtReal * warp * YEARS_PER_SECOND;

    // simulation (fully frozen while paused)
    this.world.update(dtYears, warp === 0 ? 0 : dtReal, warp);
    // planet / orbits / lighting
    const { sunDir } = this.planetView.update(dtReal, warp, this.world, this.camera);
    // living-world rendering
    this.worldView.update(dtReal, warp, this.camera, sunDir);

    // rocket auto-track
    if (this.ui?.trackLaunches) {
      const active = this.worldView.rockets.findIndex((r) => r.active);
      if (active >= 0 && (!this.follow || this.follow.kind !== 'rocket')) {
        this.setFollow({ kind: 'rocket', idx: active });
        this.ui.toast('🚀 Tracking launch — use a camera preset to break away', 2600);
      } else if (active < 0 && this.follow && this.follow.kind === 'rocket') {
        this.setFollow(null);
      }
    }

    // follow
    if (this.follow) {
      const anchor = this.followAnchor(new THREE.Vector3(), dtReal);
      if (anchor) {
        if (!this.followInit) { this.followPrev.copy(anchor); this.followInit = true; }
        const delta = anchor.clone().sub(this.followPrev);
        this.camera.position.add(delta);
        this.controls.target.copy(anchor);
        this.followPrev.copy(anchor);
      } else {
        this.setFollow(null);
      }
    }
    // camera tween (re-anchored to the live follow target so rotating/
    // orbiting bodies are tracked smoothly mid-flight)
    if (this.camTween) {
      const tw = this.camTween;
      if (this.follow && tw.off) {
        const anchor = this.followAnchor(new THREE.Vector3(), 0);
        if (anchor) {
          tw.toTg.copy(anchor);
          tw.toPos.copy(anchor).add(tw.off);
        }
      }
      tw.t += dtReal / tw.dur;
      const k = tw.t >= 1 ? 1 : (tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTg, tw.toTg, k);
      if (tw.t >= 1) this.camTween = null;
    }
    // WASD
    this.updateKeys(dtReal);
    // quake shake
    if (this.shake > 0.01) {
      this.shake *= 0.94;
      this.camera.position.x += (Math.random() - 0.5) * this.shake * WORLD_SCALE;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * WORLD_SCALE;
    }

    // dynamic depth range for seamless surface→system zoom
    const distT = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = clamp(distT / 500, 0.05, 40);
    this.camera.far = Math.max(30000, distT * 8);
    this.camera.updateProjectionMatrix();
    this.controls.update();

    // adaptive quality
    this.qTimer += dtReal;
    if (this.qTimer > 5) {
      this.qTimer = 0;
      if (this.fps < 24 && this.quality < 2) {
        this.quality++;
        this.applyQuality();
      } else if (this.fps > 55 && this.quality > 0) {
        this.quality--;
        this.applyQuality();
      }
    }

    this.ui.update(dtReal, this.fps);
    this.renderer.render(this.scene, this.camera);
  }

  applyQuality() {
    const pr = [Math.min(devicePixelRatio, 2), 1.25, 1][this.quality];
    this.renderer.setPixelRatio(pr);
    this.planetView.clouds2.visible = this.quality < 2;
  }

  updateKeys(dt) {
    const k = this.keys;
    if (!k.size) return;
    // orbit around the tracked body (camera always faces it): WASD/arrows slew,
    // Q/E zoom. Never pans away from the lock.
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const fast = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 3 : 1;
    const rot = dt * 0.55 * fast;
    if (k.has('KeyA') || k.has('ArrowLeft')) sph.theta -= rot;
    if (k.has('KeyD') || k.has('ArrowRight')) sph.theta += rot;
    if (k.has('KeyW') || k.has('ArrowUp')) sph.phi = clamp(sph.phi - rot * 0.7, 0.03, Math.PI - 0.03);
    if (k.has('KeyS') || k.has('ArrowDown')) sph.phi = clamp(sph.phi + rot * 0.7, 0.03, Math.PI - 0.03);
    const zr = dt * 1.6 * fast;
    if (k.has('KeyE') || k.has('Equal')) sph.radius = clamp(sph.radius * (1 - zr), this.controls.minDistance, this.controls.maxDistance);
    if (k.has('KeyQ') || k.has('Minus')) sph.radius = clamp(sph.radius * (1 + zr), this.controls.minDistance, this.controls.maxDistance);
    this.camTween = null;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
  }
}

window.addEventListener('error', (e) => {
  const step = document.querySelector('#load-step');
  if (step && !document.querySelector('#loading').classList.contains('done')) {
    step.textContent = 'Error: ' + (e.message || 'failed to start');
    step.style.color = '#ff8080';
  }
});

const game = new Game();
game.init();
