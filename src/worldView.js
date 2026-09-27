// ---------------------------------------------------------------------------
// worldView.js — renders the living world: detailed instanced cities that
// evolve by era, forests, boats, territory, night lights, wildlife, citizens,
// weather sprites, rockets, satellites, lunar bases, disaster/god-power FX.
// All model sizes scale with WORLD_SCALE so the bigger planet stays in
// proportion.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, TAU, clamp } from './noise.js';
import { PLANET_R, WORLD_SCALE, B } from './world.js';
import { MOON_R, MOON_SCALE } from './planetView.js';

const S = WORLD_SCALE;   // planet surface scale (1.6)
const MS = MOON_SCALE;   // moon scale (~1.55)

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _s = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _tmpQ = new THREE.Quaternion();

// Orient an object's +Y along `dir` with a yaw spin around `dir`.
function orientUp(dir, yaw, target) {
  target.setFromUnitVectors(Y_AXIS, _up.set(dir.x, dir.y, dir.z));
  _tmpQ.setFromAxisAngle(_up, yaw);
  target.premultiply(_tmpQ);
  return target;
}

function tangentBasis(d, out1, out2) {
  _up.set(d.x, d.y, d.z);
  const ref = Math.abs(_up.y) > 0.93 ? _v3.set(1, 0, 0) : _v3.set(0, 1, 0);
  out1.crossVectors(_up, ref).normalize();
  out2.crossVectors(_up, out1).normalize();
  return _up;
}

// geometry helpers ---------------------------------------------------------------
function part(geo, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (rz) geo.rotateZ(rz);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function spiralTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.translate(128, 128);
  for (let arm = 0; arm < 4; arm++) {
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const a = t * 5.1 + arm * (TAU / 4);
      const rad = 26 + t * 96;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      const r = 24 * (1 - t * 0.55);
      const dens = 0.28 + 0.5 * (1 - t);
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${dens.toFixed(2)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }
  // bright eyewall ring + clear eye
  const wall = ctx.createRadialGradient(0, 0, 10, 0, 0, 27);
  wall.addColorStop(0, 'rgba(255,255,255,0)');
  wall.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  wall.addColorStop(0.85, 'rgba(255,255,255,0.55)');
  wall.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wall;
  ctx.beginPath(); ctx.arc(0, 0, 27, 0, TAU); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Facade texture with lit windows (map + emissive pair so towers glow at night)
function facadeTextures() {
  const W = 128, H = 160;
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
  const m = mc.getContext('2d'), e = ec.getContext('2d');
  const r = new RNG(777);
  const base = m.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#4a5462'); base.addColorStop(1, '#2b323d');
  m.fillStyle = base; m.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const cols = 6, rows = 10;
  for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < rows; cy++) {
    const x = 8 + cx * ((W - 16) / cols), y = 8 + cy * ((H - 16) / rows);
    const w = (W - 16) / cols - 5, h = (H - 16) / rows - 5;
    const lit = r.next() < 0.55;
    if (lit) {
      const warm = r.range(0.75, 1);
      m.fillStyle = `rgb(${255 * warm | 0},${205 * warm | 0},${130 * warm | 0})`;
      m.fillRect(x, y, w, h);
      e.fillStyle = `rgb(${255 * warm | 0},${190 * warm | 0},${110 * warm | 0})`;
      e.fillRect(x, y, w, h);
    } else {
      m.fillStyle = r.chance(0.5) ? '#141a24' : '#1d2836';
      m.fillRect(x, y, w, h);
    }
  }
  const map = new THREE.CanvasTexture(mc); map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(ec); emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

export class WorldView {
  constructor(scene, planetView, world) {
    this.scene = scene;
    this.pv = planetView;
    this.world = world;
    this.spin = planetView.spin;
    this.pivot = planetView.pivot;
    this.rng = new RNG(31337);
    this.lastCityBuild = -10;
    this.lastTerrBuild = -10;
    this.lastStormSync = 0;
    this.lastHerdSync = 0;
    this.time = 0;
    this.followPerson = null;
    this.citizenCity = null;
    this.boats = [];
    this.beaconMat = null;

    this.buildCities();
    this.buildTerritory();
    this.buildLights();
    this.buildRings();
    this.buildRoutes();
    this.lastRouteSync = -10;
    this.buildAnimals();
    this.buildCitizens();
    this.buildRockets();
    this.buildSatellites();
    this.buildMoonBase();
    this.buildEffects();
    this.buildStormSprites();
    this.buildSelection();
  }

  surfH(cellElev) {
    return this.world.planet.heightRadius(cellElev) - PLANET_R;
  }

  localPos(dir, h, out) {
    return (out || new THREE.Vector3()).set(dir.x, dir.y, dir.z).multiplyScalar(PLANET_R + h);
  }

  // -- cities (detailed instanced buildings by era) ---------------------------------
  buildCities() {
    this.cityGroup = new THREE.Group();
    this.spin.add(this.cityGroup);
    const std = (extra = {}) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, ...extra });
    const mk = (geo, mat, cap) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.cityGroup.add(m);
      return m;
    };
    // hut: mud-brick base + thatch roof + hide door
    const hutGeo = mergeGeometries([
      paint(part(new THREE.CylinderGeometry(0.38 * S, 0.45 * S, 0.5 * S, 10), 0, 0.25 * S, 0), 0xd8c4a8),
      paint(part(new THREE.ConeGeometry(0.64 * S, 0.78 * S, 10), 0, 0.86 * S, 0), 0x8a6b4a),
      paint(part(new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 0.3 * S, 6), 0, 0.2 * S, 0.40 * S), 0x241f18),
      paint(part(new THREE.BoxGeometry(0.2 * S, 0.3 * S, 0.08 * S), 0, 0.15 * S, 0.40 * S), 0x241f18),
    ]);
    // house: plaster body + overhang tile roof + chimney + door + windows
    const houseGeo = mergeGeometries([
      paint(part(new THREE.BoxGeometry(0.72 * S, 0.5 * S, 0.72 * S), 0, 0.25 * S, 0), 0xf2ede2),
      paint(part(new THREE.ConeGeometry(0.66 * S, 0.48 * S, 4), 0, 0.74 * S, 0, Math.PI / 4), 0x9a5a40),
      paint(part(new THREE.BoxGeometry(0.13 * S, 0.4 * S, 0.13 * S), 0.2 * S, 0.85 * S, -0.12 * S), 0x7a4a38),
      paint(part(new THREE.BoxGeometry(0.16 * S, 0.28 * S, 0.05 * S), -0.12 * S, 0.16 * S, 0.365 * S), 0x2a3542),
      paint(part(new THREE.BoxGeometry(0.13 * S, 0.12 * S, 0.05 * S), 0.16 * S, 0.33 * S, 0.365 * S), 0x1c2836),
      paint(part(new THREE.BoxGeometry(0.13 * S, 0.12 * S, 0.05 * S), -0.16 * S, 0.36 * S, -0.365 * S, Math.PI), 0x1c2836),
    ]);
    // city block + cornice, window facade
    const blockGeo = mergeGeometries([
      part(new THREE.BoxGeometry(1.1 * S, 1.0 * S, 1.1 * S), 0, 0.5 * S, 0),
      part(new THREE.BoxGeometry(1.22 * S, 0.12 * S, 1.22 * S), 0, 1.02 * S, 0),
    ]);
    // tower shaft + crown + antenna (antenna uses a plain dark material group)
    const towerWin = mergeGeometries([
      part(new THREE.BoxGeometry(0.85 * S, 2.6 * S, 0.85 * S), 0, 1.3 * S, 0),
      part(new THREE.BoxGeometry(1.0 * S, 0.18 * S, 1.0 * S), 0, 2.66 * S, 0),
    ]);
    const towerAnt = part(new THREE.CylinderGeometry(0.035 * S, 0.05 * S, 0.9 * S, 6), 0, 3.15 * S, 0);
    const towerGeo = mergeGeometries([towerWin, towerAnt], true);
    // dome habitat + door + skylight cap
    const domeGeo = mergeGeometries([
      paint(part(new THREE.SphereGeometry(0.9 * S, 16, 12, 0, TAU, 0, Math.PI / 2), 0, 0, 0), 0xdfe8f2),
      paint(part(new THREE.BoxGeometry(0.4 * S, 0.5 * S, 0.25 * S), 0, 0.25 * S, 0.82 * S), 0x33414f),
      paint(part(new THREE.SphereGeometry(0.22 * S, 10, 8), 0, 0.92 * S, 0), 0xffc37a),
      paint(part(new THREE.CylinderGeometry(0.95 * S, 1.0 * S, 0.12 * S, 16), 0, 0.06 * S, 0), 0x8b95a1),
    ]);
    // launch complex: pad + gantry + arm + fuel sphere + tank + beacon
    const padGeo = mergeGeometries([
      paint(part(new THREE.CylinderGeometry(1.6 * S, 1.8 * S, 0.3 * S, 16), 0, 0.15 * S, 0), 0x9aa2ab),
      paint(part(new THREE.BoxGeometry(0.28 * S, 2.6 * S, 0.28 * S), 1.25 * S, 1.45 * S, 0), 0xb03a2e),
      paint(part(new THREE.BoxGeometry(0.9 * S, 0.16 * S, 0.16 * S), 0.9 * S, 2.5 * S, 0), 0xd8d8d8),
      paint(part(new THREE.SphereGeometry(0.12 * S, 8, 6), 1.25 * S, 2.85 * S, 0), 0xff2a2a),
      paint(part(new THREE.SphereGeometry(0.55 * S, 12, 10), -1.15 * S, 0.7 * S, 0.7 * S), 0xe0e4e8),
      paint(part(new THREE.CylinderGeometry(0.3 * S, 0.3 * S, 0.8 * S, 10), -1.15 * S, 0.4 * S, -0.8 * S), 0xc3ccd4),
    ]);
    // defensive wall segment + merlons
    const wallGeo = mergeGeometries([
      paint(part(new THREE.BoxGeometry(1.6 * S, 0.7 * S, 0.35 * S), 0, 0.35 * S, 0), 0x9a938a),
      paint(part(new THREE.BoxGeometry(1.62 * S, 0.1 * S, 0.38 * S), 0, 0.72 * S, 0), 0xb3aca2),
      paint(part(new THREE.BoxGeometry(0.28 * S, 0.24 * S, 0.35 * S), -0.55 * S, 0.86 * S, 0), 0xa8a19a),
      paint(part(new THREE.BoxGeometry(0.28 * S, 0.24 * S, 0.35 * S), 0, 0.86 * S, 0), 0xa8a19a),
      paint(part(new THREE.BoxGeometry(0.28 * S, 0.24 * S, 0.35 * S), 0.55 * S, 0.86 * S, 0), 0xa8a19a),
    ]);
    // trees: trunk + two-tier canopy (two meshes sharing matrices)
    const trunkGeo = part(new THREE.CylinderGeometry(0.09 * S, 0.14 * S, 0.7 * S, 6), 0, 0.35 * S, 0);
    const canopyGeo = mergeGeometries([
      part(new THREE.ConeGeometry(0.72 * S, 0.9 * S, 8), 0, 0.75 * S, 0),
      part(new THREE.ConeGeometry(0.6 * S, 1.1 * S, 7), 0, 1.25 * S, 0),
      part(new THREE.ConeGeometry(0.42 * S, 0.8 * S, 7), 0, 1.85 * S, 0),
    ]);
    // boat: hull + bow + cabin + mast + yard + canvas sail
    const boatGeo = mergeGeometries([
      paint(part(new THREE.BoxGeometry(0.55 * S, 0.4 * S, 1.5 * S), 0, 0.2 * S, 0), 0x6b4a2f),
      paint(part(new THREE.ConeGeometry(0.32 * S, 0.55 * S, 4), 0, 0.2 * S, 0.95 * S, 0, Math.PI / 2), 0x6b4a2f),
      paint(part(new THREE.BoxGeometry(0.4 * S, 0.35 * S, 0.4 * S), 0, 0.55 * S, -0.35 * S), 0xe8e0d0),
      paint(part(new THREE.CylinderGeometry(0.035 * S, 0.045 * S, 1.2 * S, 5), 0, 1.1 * S, 0.15 * S), 0x4a3728),
      paint(part(new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.9 * S, 5), 0, 1.6 * S, -0.05 * S, 0, 0, Math.PI / 2), 0x4a3728),
      paint(part(new THREE.BoxGeometry(0.05 * S, 0.85 * S, 0.75 * S), 0, 1.12 * S, -0.05 * S), 0xf3ecd8),
    ]);

    this.imHut = mk(hutGeo, std({ vertexColors: true }), 3500);
    this.imHouse = mk(houseGeo, std({ roughness: 0.8, vertexColors: true }), 9000);
    const { map: winMap, emissive: winEm } = facadeTextures();
    this.imBlock = mk(blockGeo, std({ map: winMap, emissiveMap: winEm, emissive: 0xffc37a, emissiveIntensity: 0.9 }), 7000);
    this.imTower = mk(towerGeo, [
      std({ map: winMap, emissiveMap: winEm, emissive: 0xffc37a, emissiveIntensity: 1.0 }),
      std({ color: 0x2a2f36, roughness: 0.5, metalness: 0.6 }),
    ], 5000);
    this.imDome = mk(domeGeo, std({ roughness: 0.35, metalness: 0.35, vertexColors: true }), 500);
    this.imPad = mk(padGeo, std({ roughness: 0.6, vertexColors: true }), 48);
    this.imWall = mk(wallGeo, std({ roughness: 0.9, vertexColors: true }), 2500);
    this.imTrunk = mk(trunkGeo, std({ color: 0x5a4030, roughness: 1 }), 6000);
    this.imCanopy = mk(canopyGeo, std({ roughness: 0.95 }), 6000);
    this.imBoat = mk(boatGeo, std({ roughness: 0.7, vertexColors: true }), 160);
  }

  styleForEra(era) {
    // mix weights [hut, house, block, tower, wall]
    if (era === 0) return [1, 0, 0, 0, 0];
    if (era === 1) return [0.5, 0.5, 0, 0, 0];
    if (era === 2) return [0.2, 0.7, 0.1, 0, 0.15];
    if (era === 3) return [0, 0.55, 0.45, 0, 0.3];
    if (era === 4) return [0, 0.6, 0.4, 0, 0.5];
    if (era === 5) return [0, 0.5, 0.5, 0.05, 0.2];
    if (era === 6) return [0, 0.35, 0.55, 0.1, 0];
    if (era === 7) return [0, 0.25, 0.45, 0.3, 0];
    if (era === 8) return [0, 0.15, 0.4, 0.45, 0];
    if (era === 9) return [0, 0.1, 0.3, 0.6, 0];
    return [0, 0.05, 0.25, 0.7, 0];
  }

  rebuildCities() {
    const counters = [0, 0, 0, 0, 0, 0, 0]; // hut house block tower dome pad wall
    const ims = [this.imHut, this.imHouse, this.imBlock, this.imTower, this.imDome, this.imPad, this.imWall];
    const caps = ims.map((m) => m.instanceMatrix.count);
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), p = new THREE.Vector3();
    const lightPts = [];
    const civOf = (id) => this.world.civs[id];
    const cities = [...this.world.cities].sort((a, b) => b.pop - a.pop);

    const put = (meshIdx, x, y, z, dir, yaw, sx, sy, sz, color) => {
      if (counters[meshIdx] >= caps[meshIdx]) return false;
      orientUp(dir, yaw, _q);
      _m.compose(p.set(x, y, z), _q, _s.set(sx, sy, sz));
      ims[meshIdx].setMatrixAt(counters[meshIdx], _m);
      if (color) ims[meshIdx].setColorAt(counters[meshIdx], color);
      counters[meshIdx]++;
      return true;
    };
    const tmpC = new THREE.Color();
    this.boats = [];

    for (const city of cities) {
      const civ = civOf(city.civ);
      if (!civ) continue;
      const cell = this.world.cells[city.cell];
      const era = civ.era;
      const dmg = city.damage;
      const h0 = this.surfH(cell.elev);
      const d = city.dir;
      tangentBasis(d, t1, t2);
      const crng = new RNG(city.seed);
      let n = Math.floor(clamp(3 + Math.log10(Math.max(10, city.pop)) * 4.2 - era * 0.4, 3, 90));
      if (dmg > 0.4) n = Math.floor(n * (1 - dmg * 0.5));
      const spread = (1.1 + Math.sqrt(n) * 0.42 + era * 0.12) * S;
      const mix = this.styleForEra(era);
      const basePos = this.localPos(d, h0, new THREE.Vector3());
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + crng.next() * 0.8;
        const rr = spread * Math.sqrt((i + 0.5) / n) + crng.range(0, 0.3 * S);
        const px = basePos.x + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * rr;
        const py = basePos.y + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * rr;
        const pz = basePos.z + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * rr;
        _v1.set(px, py, pz).normalize();
        const hh = h0 + 0.05 * S;
        const bx = _v1.x * (PLANET_R + hh), by = _v1.y * (PLANET_R + hh), bz = _v1.z * (PLANET_R + hh);
        const roll = crng.next();
        const yaw = crng.range(0, TAU);
        let done = false;
        const sc = 0.8 + crng.next() * 0.5 + Math.min(1.2, Math.log10(Math.max(10, city.pop)) * 0.14);
        if (roll < mix[0]) {
          tmpC.setHSL(0.08, 0.32, 0.55 + crng.next() * 0.25);
          done = put(0, bx, by, bz, _v1, yaw, sc, sc, sc, tmpC);
        } else if (roll < mix[0] + mix[1]) {
          tmpC.setHSL(era >= 6 ? 0.6 : 0.09, era >= 6 ? 0.08 : 0.22, 0.68 + crng.next() * 0.3);
          done = put(1, bx, by, bz, _v1, yaw, sc, sc * (0.85 + crng.next() * 0.4), sc, tmpC);
        } else if (roll < mix[0] + mix[1] + mix[2]) {
          tmpC.setHSL(0.08 + crng.next() * 0.04, 0.12, 0.55 + crng.next() * 0.3);
          done = put(2, bx, by, bz, _v1, yaw, sc, sc * (0.9 + crng.next() * 0.8), sc, tmpC);
        } else {
          tmpC.setHSL(0.58, 0.18, 0.6 + crng.next() * 0.3);
          done = put(3, bx, by, bz, _v1, yaw, sc, sc * (0.8 + crng.next() * 1.1), sc, tmpC);
        }
        if (done && era >= 3 && crng.chance(0.5)) {
          lightPts.push(bx, by, bz);
        }
        if (mix[4] > 0 && i < 10 && crng.chance(mix[4] * 0.5)) {
          const wa = (i / 10) * TAU;
          const wr = spread * 1.15;
          const wx = basePos.x + (t1.x * Math.cos(wa) + t2.x * Math.sin(wa)) * wr;
          const wy = basePos.y + (t1.y * Math.cos(wa) + t2.y * Math.sin(wa)) * wr;
          const wz = basePos.z + (t1.z * Math.cos(wa) + t2.z * Math.sin(wa)) * wr;
          _v2.set(wx, wy, wz).normalize();
          put(6, _v2.x * (PLANET_R + h0 + 0.1 * S), _v2.y * (PLANET_R + h0 + 0.1 * S), _v2.z * (PLANET_R + h0 + 0.1 * S), _v2, wa, 1, 1, 1, null);
        }
      }
      if (era >= 8) {
        const nd = Math.min(4, 1 + Math.floor(city.pop / 500000));
        for (let i = 0; i < nd; i++) {
          const a = crng.range(0, TAU), rr = spread * 1.3 + i * 1.2 * S;
          _v1.set(
            basePos.x + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * rr,
            basePos.y + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * rr,
            basePos.z + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * rr
          ).normalize();
          put(4, _v1.x * (PLANET_R + h0 + 0.05 * S), _v1.y * (PLANET_R + h0 + 0.05 * S), _v1.z * (PLANET_R + h0 + 0.05 * S), _v1, 0, 1.4, 1.1, 1.4, null);
        }
      }
      if (city.launchpad) {
        const a = 1.1;
        _v1.set(
          basePos.x + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * (spread * 1.6 + 2 * S),
          basePos.y + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * (spread * 1.6 + 2 * S),
          basePos.z + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * (spread * 1.6 + 2 * S)
        ).normalize();
        put(5, _v1.x * (PLANET_R + h0 + 0.1 * S), _v1.y * (PLANET_R + h0 + 0.1 * S), _v1.z * (PLANET_R + h0 + 0.1 * S), _v1, 0, 1, 1, 1, null);
      }
      // fishing boats for port cities
      if (city.port && this.boats.length < 150) {
        const water = cell.neighbor.map((i) => this.world.cells[i]).find((c) => c.ocean);
        if (water) {
          const w = water.dir;
          const dot = d.x * w.x + d.y * w.y + d.z * w.z;
          let tx = w.x - d.x * dot, ty = w.y - d.y * dot, tz = w.z - d.z * dot;
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl; ty /= tl; tz /= tl;
          for (let i = 0; i < 2 && this.boats.length < 150; i++) {
            this.boats.push({ city: city.id, tx, ty, tz, dist: spread + (2 + i * 2.4) * S, ph: crng.range(0, TAU), sc: 0.9 + crng.next() * 0.5, h0 });
          }
        }
      }
      city._spread = spread;
    }
    for (let i = 0; i < ims.length; i++) {
      ims[i].count = counters[i];
      ims[i].instanceMatrix.needsUpdate = true;
      if (ims[i].instanceColor) ims[i].instanceColor.needsUpdate = true;
    }
    this.rebuildForests();
    this.rebuildLights(lightPts);
    this.rebuildRings(cities);
    this.syncSmogDamage(cities);
  }

  // -- forests ------------------------------------------------------------------------
  rebuildForests() {
    const trng = new RNG(4242); // deterministic so groves don't jump between rebuilds
    let tn = 0;
    const cap = 6000;
    const c = new THREE.Color();
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    for (const cell of this.world.cells) {
      if (tn >= cap) break;
      if (cell.ocean || cell.city != null || cell.forest < 0.3) continue;
      const density = cell.forest * (cell.biome === B.JUNGLE ? 3 : cell.biome === B.FOREST ? 2.2 : 1);
      if (trng.next() > density * 0.8) continue;
      const d = cell.dir;
      tangentBasis(d, t1, t2);
      const h = this.surfH(cell.elev);
      const nTree = 1 + Math.floor(trng.next() * density * 2);
      for (let i = 0; i < nTree && tn < cap; i++) {
        const ox = trng.range(-4, 4) * S, oz = trng.range(-4, 4) * S;
        _v1.set(d.x, d.y, d.z).multiplyScalar(PLANET_R + h).addScaledVector(t1, ox).addScaledVector(t2, oz).normalize();
        const sc = 0.8 + trng.next() * 0.7;
        orientUp(_v1, trng.range(0, TAU), _q);
        _m.compose(_v2.copy(_v1).multiplyScalar(PLANET_R + h), _q, _s.set(sc, sc * (0.9 + trng.next() * 0.3), sc));
        this.imTrunk.setMatrixAt(tn, _m);
        this.imCanopy.setMatrixAt(tn, _m);
        this.imTrunk.setColorAt(tn, c.setHSL(0.07, 0.4, 0.2 + trng.next() * 0.1));
        const jungle = cell.biome === B.JUNGLE;
        this.imCanopy.setColorAt(tn, c.setHSL(jungle ? 0.33 : 0.29 + trng.next() * 0.06, jungle ? 0.6 : 0.5, jungle ? 0.22 : 0.28 + trng.next() * 0.12));
        tn++;
      }
    }
    this.imTrunk.count = tn;
    this.imCanopy.count = tn;
    this.imTrunk.instanceMatrix.needsUpdate = true;
    this.imCanopy.instanceMatrix.needsUpdate = true;
    if (this.imTrunk.instanceColor) this.imTrunk.instanceColor.needsUpdate = true;
    if (this.imCanopy.instanceColor) this.imCanopy.instanceColor.needsUpdate = true;
  }

  updateBoats(camDist) {
    if (camDist > 900 * S || this.boats.length === 0) { this.imBoat.count = 0; return; }
    const c = new THREE.Color();
    let n = 0;
    for (const b of this.boats) {
      const city = this.world.cityById(b.city);
      if (!city || n >= 160) continue;
      const d = city.dir;
      const bob = Math.sin(this.time * 1.6 + b.ph) * 0.18 * S;
      _v1.set(d.x, d.y, d.z).multiplyScalar(PLANET_R + b.h0)
        .add(_v2.set(b.tx * b.dist, b.ty * b.dist, b.tz * b.dist));
      // float slightly above sea level
      const h = Math.max(b.h0, 0.25 * S) + bob + 0.2 * S;
      _v1.normalize();
      const yaw = Math.atan2(b.tx, b.tz) + Math.sin(this.time * 0.8 + b.ph) * 0.25;
      orientUp(_v1, yaw, _q);
      _m.compose(_v2.copy(_v1).multiplyScalar(PLANET_R + h), _q, _s.set(b.sc, b.sc, b.sc));
      this.imBoat.setMatrixAt(n, _m);
      this.imBoat.setColorAt(n, c.setHSL(0.08 + (n % 5) * 0.02, 0.22, 0.78 + (n % 3) * 0.07));
      n++;
    }
    this.imBoat.count = n;
    this.imBoat.instanceMatrix.needsUpdate = true;
    if (this.imBoat.instanceColor) this.imBoat.instanceColor.needsUpdate = true;
  }

  // -- night lights ---------------------------------------------------------------
  buildLights() {
    this.lightUniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uCenter: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uPix: { value: 130 * S },
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.lightUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform vec3 uSunDir; uniform vec3 uCenter; uniform float uTime; uniform float uPix;
        varying float vA;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vec3 wd = normalize(wp.xyz - uCenter);
          float night = smoothstep(0.22, -0.18, dot(wd, normalize(uSunDir)));
          float tw = 0.75 + 0.25*sin(uTime*3.0 + position.x*12.0 + position.y*17.0);
          vA = night * tw;
          vec4 mv = viewMatrix * wp;
          gl_PointSize = clamp(uPix / -mv.z, 1.0, 7.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float m = smoothstep(0.5, 0.08, length(c));
          gl_FragColor = vec4(vec3(1.0,0.78,0.45)*1.6, m * vA);
        }`,
    });
    this.nightLights = new THREE.Points(geo, mat);
    this.nightLights.frustumCulled = false;
    this.nightLights.renderOrder = 6;
    this.spin.add(this.nightLights);
  }

  rebuildLights(pts) {
    const arr = pts.length ? new Float32Array(pts) : new Float32Array(3);
    this.nightLights.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.nightLights.geometry.attributes.position.needsUpdate = true;
  }

  // -- territory blobs (reference look: filled nations + dark borders) ---------------
  // A data texture in the terrain's UV space tints owned land with civ colors.
  // Rebuilt in milliseconds on territory change; injected into the terrain
  // shader so blobs hug the surface, rotate with the planet, and shade at night.
  buildTerritory() {
    this.terrW = 512; this.terrH = 256;
    const W = this.terrW, H = this.terrH;
    this.terrData = new Uint8Array(W * H * 4);
    // texel -> nearest cell (stamp discs once; inverted nearest search)
    this.terrCell = new Int32Array(W * H).fill(-1);
    const dist = new Float32Array(W * H).fill(1e9);
    for (const cell of this.world.cells) {
      const theta = Math.acos(clamp(cell.dir.y, -1, 1));
      let phi = Math.atan2(cell.dir.z, -cell.dir.x);
      if (phi < 0) phi += TAU;
      const cu = (phi / TAU) * W;
      const cv = (1 - theta / Math.PI) * H;
      const rad = 9;
      for (let dy = -rad; dy <= rad; dy++) {
        const py = Math.round(cv + dy);
        if (py < 0 || py >= H) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const dd = Math.sqrt(dx * dx + dy * dy);
          if (dd > rad) continue;
          let px = Math.round(cu + dx) % W;
          if (px < 0) px += W;
          const ti = py * W + px;
          if (dd < dist[ti]) { dist[ti] = dd; this.terrCell[ti] = cell.idx; }
        }
      }
    }
    this.terrTex = new THREE.DataTexture(this.terrData, W, H, THREE.RGBAFormat);
    this.terrTex.colorSpace = THREE.SRGBColorSpace;
    this.terrTex.magFilter = THREE.LinearFilter;
    this.terrTex.minFilter = THREE.LinearFilter;
    this.terrTex.needsUpdate = true;
    // inject blob sampling into the terrain material
    const terrTex = this.terrTex;
    this.pv.terrainMesh.material.onBeforeCompile = (sh) => {
      sh.uniforms.uTerr = { value: terrTex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTerrUv;\nvarying vec3 vTerrW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrUv = uv;\nvTerrW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uTerr;\nvarying vec2 vTerrUv;\nvarying vec3 vTerrW;')
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 terr = texture2D(uTerr, vTerrUv);
          if (terr.a > 0.02) {
            float border = (terr.a > 0.25 && terr.a < 0.92) ? 1.0 : 0.0;
            vec3 tint = mix(terr.rgb, vec3(0.04,0.02,0.06), border * 0.8);
            diffuseColor.rgb = mix(diffuseColor.rgb, tint, border > 0.5 ? 0.9 : 0.78);
          }
          // fine surface grain + large-scale mottling (stops flat CG look)
          vec3 cellp = floor(vTerrW * 1.2);
          float gr = fract(sin(dot(cellp, vec3(12.9898,78.233,37.719))) * 43758.5453);
          diffuseColor.rgb *= 0.93 + gr * 0.11;
          vec3 cellp2 = floor(vTerrW * 0.15);
          float m2 = fract(sin(dot(cellp2, vec3(4.123,55.11,21.7))) * 24634.63);
          diffuseColor.rgb *= 0.96 + m2 * 0.08;
        }`);
    };
    this.pv.terrainMesh.material.needsUpdate = true;
    this.rebuildTerritory();
  }

  rebuildTerritory() {
    const W = this.terrW, H = this.terrH, D = this.terrData;
    const c = new THREE.Color();
    const owner = this._terrOwner || (this._terrOwner = new Int16Array(W * H));
    // pass 1: owner colors (unowned texels stay white so filtered edges glow)
    for (let i = 0; i < W * H; i++) {
      const ci = this.terrCell[i];
      let o = -1;
      if (ci >= 0) {
        const cell = this.world.cells[ci];
        if (!cell.ocean && cell.owner !== -1 && this.world.civs[cell.owner]?.alive) o = cell.owner;
      }
      owner[i] = o;
      if (o >= 0) {
        c.setHex(this.world.civs[o].color);
        D[i * 4] = c.r * 255; D[i * 4 + 1] = c.g * 255; D[i * 4 + 2] = c.b * 255;
      } else {
        D[i * 4] = 255; D[i * 4 + 1] = 255; D[i * 4 + 2] = 255;
      }
      D[i * 4 + 3] = 0;
    }
    // pass 2: interior vs. border ring (border = owned texel near foreign land)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = owner[i];
        if (o < 0) continue;
        let foreign = false;
        for (let dy = -2; dy <= 2 && !foreign; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -2; dx <= 2; dx++) {
            let xx = x + dx;
            if (xx < 0) xx += W; else if (xx >= W) xx -= W;
            if (owner[yy * W + xx] !== o) { foreign = true; break; }
          }
        }
        D[i * 4 + 3] = foreign ? 140 : 255;
      }
    }
    this.terrTex.needsUpdate = true;
  }

  // -- city rings ---------------------------------------------------------------------
  buildRings() {
    const geo = new THREE.RingGeometry(1.1, 1.45, 40); // scaled by world-unit spread
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    this.rings = new THREE.InstancedMesh(geo, mat, 220);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.renderOrder = 5;
    this.spin.add(this.rings);
  }

  rebuildRings(cities) {
    const c = new THREE.Color();
    let n = 0;
    for (const city of cities) {
      if (n >= 220) break;
      const civ = this.world.civs[city.civ];
      if (!civ) continue;
      const cell = this.world.cells[city.cell];
      const h = this.surfH(cell.elev) + 0.35 * S;
      const spread = city._spread || 2 * S;
      _q.setFromUnitVectors(Z_AXIS, _v1.set(city.dir.x, city.dir.y, city.dir.z));
      _m.compose(
        _v2.set(city.dir.x, city.dir.y, city.dir.z).multiplyScalar(PLANET_R + h),
        _q, _s.set(spread, spread, spread)
      );
      this.rings.setMatrixAt(n, _m);
      this.rings.setColorAt(n, c.setHex(civ.color));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  // -- smog & damage columns ------------------------------------------------------------
  buildStormSprites() {
    this.stormTex = spiralTexture();
    this.smokeTex = glowTexture('rgba(120,120,125,0.55)', 'rgba(120,120,125,0)');
    this.stormSprites = [];
    this.smogSprites = [];
    this.dmgSprites = [];
  }

  syncSmogDamage(cities) {
    for (const s of [...this.smogSprites, ...this.dmgSprites]) { this.spin.remove(s); s.material.dispose(); }
    this.smogSprites = []; this.dmgSprites = [];
    let smogN = 0, dmgN = 0;
    for (const city of cities) {
      const civ = this.world.civs[city.civ];
      if (!civ) continue;
      const cell = this.world.cells[city.cell];
      const h = this.surfH(cell.elev);
      if (city.smog > 0.35 && smogN < 40) {
        const m = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: 0.5 * city.smog, depthWrite: false });
        const sp = new THREE.Sprite(m);
        sp.position.copy(this.localPos(city.dir, h + 3.2 * S));
        const sc = (city._spread || 2 * S) * 2.2;
        sp.scale.set(sc, sc * 0.7, 1);
        this.spin.add(sp);
        this.smogSprites.push(sp);
        smogN++;
      }
      if (city.damage > 0.25 && dmgN < 24) {
        const m = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x554444, transparent: true, opacity: 0.7, depthWrite: false });
        const sp = new THREE.Sprite(m);
        sp.position.copy(this.localPos(city.dir, h + 2.2 * S));
        sp.scale.set(4 * S, 6 * S, 1);
        this.spin.add(sp);
        this.dmgSprites.push(sp);
        dmgN++;
      }
    }
  }

  syncStorms() {
    const want = this.world.storms;
    while (this.stormSprites.length < want.length) {
      const m = new THREE.SpriteMaterial({ map: this.stormTex, transparent: true, opacity: 0.8, depthWrite: false });
      const sp = new THREE.Sprite(m);
      this.spin.add(sp);
      this.stormSprites.push(sp);
    }
    while (this.stormSprites.length > want.length) {
      const sp = this.stormSprites.pop();
      this.spin.remove(sp);
      sp.material.dispose();
    }
    for (let i = 0; i < want.length; i++) {
      const st = want[i], sp = this.stormSprites[i];
      sp.position.copy(this.localPos(st.dir, 3.4 * S));
      const sc = (9 + st.intensity * 9) * S;
      sp.scale.set(sc, sc, 1);
      const tint = st.type === 'hurricane' ? 0xdfe9ff : st.type === 'thunderstorm' ? 0xb9aee8 : st.type === 'snowstorm' ? 0xffffff : 0xaac4d8;
      sp.material.color.setHex(tint);
      sp.material.rotation += 0.01 * st.intensity;
      sp.material.opacity = st.type === 'rain' ? 0.45 : 0.8;
    }
  }

  // -- wildlife -------------------------------------------------------------------------
  buildAnimals() {
    // critter: rounded body + head + ears + legs + tail
    const critterGeo = mergeGeometries([
      paint(part(new THREE.SphereGeometry(0.32 * S, 10, 8), 0, 0.35 * S, 0), 0xffffff),
      paint(part(new THREE.SphereGeometry(0.16 * S, 8, 6), 0, 0.58 * S, 0.42 * S), 0xf2f2f2),
      paint(part(new THREE.ConeGeometry(0.05 * S, 0.16 * S, 5), 0.09 * S, 0.72 * S, 0.40 * S), 0xd8d8d8),
      paint(part(new THREE.ConeGeometry(0.05 * S, 0.16 * S, 5), -0.09 * S, 0.72 * S, 0.40 * S), 0xd8d8d8),
      paint(part(new THREE.CylinderGeometry(0.05 * S, 0.04 * S, 0.32 * S, 6), 0.14 * S, 0.12 * S, 0.15 * S), 0xc8c8c8),
      paint(part(new THREE.CylinderGeometry(0.05 * S, 0.04 * S, 0.32 * S, 6), -0.14 * S, 0.12 * S, 0.15 * S), 0xc8c8c8),
      paint(part(new THREE.CylinderGeometry(0.06 * S, 0.045 * S, 0.34 * S, 6), 0.14 * S, 0.12 * S, -0.16 * S), 0xc8c8c8),
      paint(part(new THREE.CylinderGeometry(0.06 * S, 0.045 * S, 0.34 * S, 6), -0.14 * S, 0.12 * S, -0.16 * S), 0xc8c8c8),
      paint(part(new THREE.ConeGeometry(0.05 * S, 0.28 * S, 6), 0, 0.42 * S, -0.36 * S, 0, -Math.PI / 2.4), 0xe2e2e2),
    ]);
    critterGeo.scale(1, 0.85, 1.35);
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.imFauna = new THREE.InstancedMesh(critterGeo, m, 700);
    this.imFauna.frustumCulled = false;
    this.imFauna.count = 0;
    this.spin.add(this.imFauna);
    // bird: dart body + dihedral wings + fanned tail + pale belly
    const birdGeo = mergeGeometries([
      paint(part(new THREE.ConeGeometry(0.14 * S, 0.6 * S, 6), 0, 0, 0.1 * S, 0, Math.PI / 2), 0xdde4ea),
      paint(part(new THREE.BoxGeometry(0.5 * S, 0.045 * S, 0.26 * S), 0.3 * S, 0.1 * S, -0.05 * S, 0, 0, 0.4), 0xc9d2d9),
      paint(part(new THREE.BoxGeometry(0.5 * S, 0.045 * S, 0.26 * S), -0.3 * S, 0.1 * S, -0.05 * S, 0, 0, -0.4), 0xc9d2d9),
      paint(part(new THREE.SphereGeometry(0.11 * S, 8, 6), 0, -0.05 * S, 0.1 * S), 0xffffff),
      paint(part(new THREE.BoxGeometry(0.24 * S, 0.04 * S, 0.28 * S), 0, 0.02 * S, -0.42 * S), 0xb9c2c9),
    ]);
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    this.imBirds = new THREE.InstancedMesh(birdGeo, bm, 220);
    this.imBirds.frustumCulled = false;
    this.imBirds.count = 0;
    this.spin.add(this.imBirds);
    this.fauna = [];
  }

  syncFauna() {
    this.fauna = [];
    const r = this.rng;
    for (const h of this.world.herds) {
      if (h.marine || h.n < 30) continue;
      const n = h.kind === 'bird' ? 0 : Math.min(4, 1 + Math.floor(h.n / 300));
      for (let i = 0; i < n && this.fauna.length < 650; i++) {
        this.fauna.push({ h, ox: r.range(-3, 3) * S, oz: r.range(-3, 3) * S, ph: r.range(0, TAU), bird: false });
      }
      if (h.kind === 'bird') {
        for (let i = 0; i < 3 && this.fauna.length < 650; i++) {
          this.fauna.push({ h, ox: r.range(-6, 6) * S, oz: r.range(-6, 6) * S, ph: r.range(0, TAU), bird: true, alt: r.range(2, 7) * S });
        }
      }
    }
  }

  updateFauna(dt) {
    const t1 = _v1, t2 = _v2;
    const c = new THREE.Color();
    let n = 0, nb = 0;
    for (const f of this.fauna) {
      const cell = this.world.cells[f.h.cell];
      if (!cell || cell.ocean) continue;
      const d = cell.dir;
      tangentBasis(d, t1, t2);
      f.ph += dt * 0.7;
      const wx = f.ox + Math.sin(f.ph) * 1.2 * S, wz = f.oz + Math.cos(f.ph * 0.8) * 1.2 * S;
      const h = this.surfH(cell.elev) + (f.bird ? f.alt + Math.sin(f.ph * 2) * 0.5 * S : 0.3 * S);
      _v3.set(d.x, d.y, d.z).multiplyScalar(PLANET_R + h)
        .addScaledVector(t1, wx).addScaledVector(t2, wz).normalize();
      if (!f.bird && n < 700) {
        orientUp(_v3, f.ph, _q);
        _m.compose(_v3.clone().multiplyScalar(PLANET_R + h), _q, _s.set(1, 1, 1));
        this.imFauna.setMatrixAt(n, _m);
        const col = f.h.kind === 'wolf' || f.h.kind === 'bigcat' ? [0.45, 0.3, 0.2]
          : f.h.kind === 'mammoth' ? [0.5, 0.42, 0.35]
            : f.h.kind === 'lizard' ? [0.5, 0.55, 0.3]
              : f.h.kind === 'rabbit' ? [0.75, 0.72, 0.68] : [0.55, 0.42, 0.3];
        this.imFauna.setColorAt(n, c.setRGB(...col));
        n++;
      } else if (f.bird && nb < 220) {
        // birds fly nose-first along the flight tangent
        _q.setFromUnitVectors(Z_AXIS, t1);
        _m.compose(_v3.clone().multiplyScalar(PLANET_R + h), _q, _s.set(1, 1, 1));
        this.imBirds.setMatrixAt(nb, _m);
        nb++;
      }
    }
    this.imFauna.count = n;
    this.imBirds.count = nb;
    this.imFauna.instanceMatrix.needsUpdate = true;
    this.imBirds.instanceMatrix.needsUpdate = true;
    if (this.imFauna.instanceColor) this.imFauna.instanceColor.needsUpdate = true;
  }

  // -- citizens (close-up life) -------------------------------------------------------------
  buildCitizens() {
    const g = mergeGeometries([
      part(new THREE.CapsuleGeometry(0.09 * S, 0.22 * S, 3, 8), 0, 0.32 * S, 0),
      part(new THREE.SphereGeometry(0.105 * S, 8, 6), 0, 0.62 * S, 0),
    ]);
    const m = new THREE.MeshLambertMaterial({});
    this.imCit = new THREE.InstancedMesh(g, m, 40);
    this.imCit.frustumCulled = false;
    this.imCit.count = 0;
    this.spin.add(this.imCit);
    this.citizens = [];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35 * S, 0.5 * S, 24),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    this.personRing = ring;
    this.personRing.visible = false;
    this.spin.add(ring);
  }

  setCitizenCity(city) {
    this.citizenCity = city;
    this.citizens = [];
    if (!city) { this.imCit.count = 0; return; }
    const r = new RNG(city.seed + 77);
    for (let i = 0; i < 36; i++) {
      this.citizens.push({ a: r.range(0, TAU), rr: r.range(0.5, (city._spread || 2 * S) * 1.4), sp: r.range(0.1, 0.5) * (r.chance(0.5) ? 1 : -1), hue: r.next() });
    }
  }

  updateCitizens(dt) {
    if (!this.citizenCity) { this.imCit.count = 0; return; }
    const city = this.citizenCity;
    const cell = this.world.cells[city.cell];
    if (!cell) { this.imCit.count = 0; return; }
    const d = city.dir;
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    tangentBasis(d, t1, t2);
    const base = this.localPos(d, this.surfH(cell.elev), new THREE.Vector3());
    const c = new THREE.Color();
    let n = 0;
    for (const w of this.citizens) {
      w.a += w.sp * dt;
      const px = base.x + (t1.x * Math.cos(w.a) + t2.x * Math.sin(w.a)) * w.rr;
      const py = base.y + (t1.y * Math.cos(w.a) + t2.y * Math.sin(w.a)) * w.rr;
      const pz = base.z + (t1.z * Math.cos(w.a) + t2.z * Math.sin(w.a)) * w.rr;
      _v1.set(px, py, pz).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v1);
      _m.compose(_v1.clone().multiplyScalar(PLANET_R + this.surfH(cell.elev) + 0.25 * S), _q, _s.set(1, 1, 1));
      this.imCit.setMatrixAt(n, _m);
      this.imCit.setColorAt(n, c.setHSL(w.hue, 0.5, 0.45));
      n++;
    }
    this.imCit.count = n;
    this.imCit.instanceMatrix.needsUpdate = true;
    if (this.imCit.instanceColor) this.imCit.instanceColor.needsUpdate = true;
    if (this.followPerson && this.followPerson.city === city.id) {
      const fp = this.followPerson;
      fp.a += fp.sp * dt;
      const px = base.x + (t1.x * Math.cos(fp.a) + t2.x * Math.sin(fp.a)) * fp.rr;
      const py = base.y + (t1.y * Math.cos(fp.a) + t2.y * Math.sin(fp.a)) * fp.rr;
      const pz = base.z + (t1.z * Math.cos(fp.a) + t2.z * Math.sin(fp.a)) * fp.rr;
      _v1.set(px, py, pz).normalize();
      this.personRing.visible = true;
      this.personRing.position.copy(_v1).multiplyScalar(PLANET_R + this.surfH(cell.elev) + 0.3 * S);
      this.personRing.quaternion.setFromUnitVectors(Z_AXIS, _v1);
      const s = 1 + Math.sin(this.time * 4) * 0.15;
      this.personRing.scale.set(s, s, s);
      fp.dirLocal = fp.dirLocal || new THREE.Vector3();
      fp.dirLocal.copy(_v1);
    } else {
      this.personRing.visible = !!this.followPerson;
    }
  }

  // -- rockets ----------------------------------------------------------------------------------
  buildRockets() {
    this.rockets = [];
    const bodyG = new THREE.CylinderGeometry(0.45 * S, 0.5 * S, 2.4 * S, 12);
    const noseG = new THREE.ConeGeometry(0.45 * S, 1.0 * S, 12);
    const flameG = new THREE.ConeGeometry(0.4 * S, 1.8 * S, 8);
    const finG = new THREE.BoxGeometry(0.12 * S, 0.9 * S, 0.55 * S);
    const bellG = new THREE.CylinderGeometry(0.3 * S, 0.48 * S, 0.45 * S, 10);
    const portG = new THREE.SphereGeometry(0.16 * S, 10, 8);
    const bandTopG = new THREE.CylinderGeometry(0.47 * S, 0.475 * S, 0.2 * S, 12);
    const bandLowG = new THREE.CylinderGeometry(0.505 * S, 0.51 * S, 0.2 * S, 12);
    const glowDiscG = new THREE.CircleGeometry(0.34 * S, 12);
    this.flameTex = glowTexture('rgba(255,200,120,1)', 'rgba(255,120,40,0)');
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.45 });
      const accent = new THREE.MeshStandardMaterial({ color: 0xd43a2f, roughness: 0.5, metalness: 0.2 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.6, metalness: 0.5 });
      const body = new THREE.Mesh(bodyG, metal);
      body.position.y = 1.2 * S;
      const nose = new THREE.Mesh(noseG, accent);
      nose.position.y = 2.9 * S;
      const bell = new THREE.Mesh(bellG, dark);
      bell.position.y = -0.2 * S;
      const port = new THREE.Mesh(portG, new THREE.MeshStandardMaterial({ color: 0x0b1520, emissive: 0x7dd3fc, emissiveIntensity: 1.2, roughness: 0.2 }));
      port.position.set(0, 1.9 * S, 0.4 * S);
      const band1 = new THREE.Mesh(bandTopG, accent);
      band1.position.y = 2.3 * S;
      const band2 = new THREE.Mesh(bandLowG, dark);
      band2.position.y = 0.55 * S;
      const nozzleGlow = new THREE.Mesh(glowDiscG, new THREE.MeshBasicMaterial({ color: 0xffc36b, transparent: true, opacity: 0.95, fog: false }));
      nozzleGlow.position.y = -0.42 * S;
      nozzleGlow.rotation.x = Math.PI / 2;
      for (let f = 0; f < 3; f++) {
        const fin = new THREE.Mesh(finG, accent);
        const a = (f / 3) * TAU;
        fin.position.set(Math.cos(a) * 0.55 * S, 0.45 * S, Math.sin(a) * 0.55 * S);
        fin.rotation.y = -a;
        g.add(fin);
      }
      const flame = new THREE.Mesh(flameG, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, fog: false }));
      flame.position.y = -1.3 * S;
      flame.rotation.x = Math.PI;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      glow.scale.set(4 * S, 4 * S, 1);
      glow.position.y = -1.2 * S;
      g.add(body, nose, bell, port, band1, band2, nozzleGlow, flame, glow);
      g.visible = false;
      this.scene.add(g);
      this.rockets.push({ g, flame, glow, nozzleGlow, active: false, t: 0, dur: 55, from: new THREE.Vector3(), ctrl: new THREE.Vector3(), mission: '', civ: -1 });
    }
  }

  launchRocket(civId, cityId, mission) {
    const r = this.rockets.find((x) => !x.active);
    const city = this.world.cityById(cityId);
    if (!r || !city) return null;
    const cell = this.world.cells[city.cell];
    const start = this.localPos(city.dir, this.surfH(cell.elev) + 0.5 * S, new THREE.Vector3());
    this.spin.updateWorldMatrix(true, false);
    start.applyMatrix4(this.spin.matrixWorld);
    r.from.copy(start);
    const pp = this.pv.planetWorldPos(new THREE.Vector3());
    const up = start.clone().sub(pp).normalize();
    r.ctrl.copy(start).addScaledVector(up, 90 * S);
    r.t = 0;
    r.dur = mission === 'test' || mission === 'sat' ? 30 : 55;
    r.active = true;
    r.mission = mission;
    r.civ = civId;
    r.g.visible = true;
    this.spawnEffect('launchFlash', city.dir, 2.2);
    return r;
  }

  updateRockets(dtReal, warp) {
    const dt = dtReal * Math.min(warp, 30);
    const moonW = this.pv.moonWorldPos(new THREE.Vector3());
    const Y = new THREE.Vector3(0, 1, 0);
    for (const r of this.rockets) {
      if (!r.active) continue;
      r.t += dt / r.dur;
      const t = Math.min(1, r.t);
      const target = (r.mission === 'test' || r.mission === 'sat')
        ? _v1.copy(r.from).addScaledVector(_v2.copy(r.from).sub(this.pv.planetWorldPos(_v3)).normalize(), 55 * S)
        : _v1.copy(moonW);
      const a = r.from, b = r.ctrl, c = target;
      const p = r.g.position;
      const u = 1 - t;
      p.set(
        u * u * a.x + 2 * u * t * b.x + t * t * c.x,
        u * u * a.y + 2 * u * t * b.y + t * t * c.y,
        u * u * a.z + 2 * u * t * b.z + t * t * c.z
      );
      _v2.set(
        2 * u * (b.x - a.x) + 2 * t * (c.x - b.x),
        2 * u * (b.y - a.y) + 2 * t * (c.y - b.y),
        2 * u * (b.z - a.z) + 2 * t * (c.z - b.z)
      ).normalize();
      r.g.quaternion.setFromUnitVectors(Y, _v2);
      const burning = t < 0.55;
      r.flame.visible = burning;
      r.glow.visible = burning;
      r.nozzleGlow.visible = burning;
      if (burning) {
        const f = 0.8 + Math.random() * 0.5;
        r.flame.scale.set(f, f * (1 + Math.random() * 0.4), f);
      }
      if (t >= 1) {
        r.active = false;
        r.g.visible = false;
        if (r.mission === 'crewed' || r.mission === 'base' || r.mission === 'colony' || r.mission === 'supply' || r.mission === 'probe') {
          this.spawnEffectAtWorld('arrivalFlash', moonW, 6);
        }
      }
    }
  }

  // -- satellites (single merged mesh each: bus + panels + dish) ----------------------------------
  buildSatellites() {
    this.satGroup = new THREE.Group();
    this.pivot.add(this.satGroup);
    this.sats = [];
    this.satGeo = mergeGeometries([
      paint(part(new THREE.BoxGeometry(0.8 * S, 0.8 * S, 0.8 * S), 0, 0, 0), 0xc9a227),
      paint(part(new THREE.BoxGeometry(0.86 * S, 0.3 * S, 0.86 * S), 0, -0.55 * S, 0), 0x8a929a),
      paint(part(new THREE.CylinderGeometry(0.06 * S, 0.06 * S, 3.4 * S, 6), 0, 0, 0, 0, 0, Math.PI / 2), 0x8a929a),
      paint(part(new THREE.BoxGeometry(1.3 * S, 0.08 * S, 1.1 * S), 1.05 * S, 0, 0), 0x2244aa),
      paint(part(new THREE.BoxGeometry(1.3 * S, 0.08 * S, 1.1 * S), -1.05 * S, 0, 0), 0x2244aa),
      paint(part(new THREE.BoxGeometry(1.34 * S, 0.05 * S, 0.08 * S), 1.05 * S, 0, 0.55 * S), 0xd8dce2),
      paint(part(new THREE.BoxGeometry(1.34 * S, 0.05 * S, 0.08 * S), -1.05 * S, 0, 0.55 * S), 0xd8dce2),
      paint(part(new THREE.CylinderGeometry(0.06 * S, 0.06 * S, 0.9 * S, 6), 0, 0.8 * S, 0), 0x8a929a),
      paint(part(new THREE.SphereGeometry(0.36 * S, 10, 6, 0, TAU, 0, 0.7), 0, 1.25 * S, 0, 0, 0.6), 0xe8ecf0),
      paint(part(new THREE.SphereGeometry(0.12 * S, 8, 6), 0, 0.48 * S, 0), 0xff2a2a),
    ]);
    this.satMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.3, emissive: 0x0a1230, emissiveIntensity: 0.5 });
  }

  syncSatellites() {
    let total = 0;
    for (const c of this.world.civs) total += c.space.satellites;
    total = Math.min(40, total);
    if (this.sats.length >= total) return;
    while (this.sats.length < total) {
      const mesh = new THREE.Mesh(this.satGeo, this.satMat);
      const r = this.rng;
      const sat = { g: mesh, ang: r.range(0, TAU), rad: PLANET_R * r.range(1.35, 1.9), incl: r.range(-0.6, 0.6), speed: r.range(0.5, 1) * 0.12 };
      this.sats.push(sat);
      this.satGroup.add(mesh);
    }
  }

  updateSatellites(dtReal, warp) {
    const dt = dtReal * Math.min(warp, 8);
    for (const s of this.sats) {
      s.ang += dt * s.speed;
      s.g.position.set(Math.cos(s.ang) * s.rad, Math.sin(s.ang) * Math.sin(s.incl) * s.rad, Math.sin(s.ang) * s.rad * Math.cos(s.incl * 0.5));
      s.g.rotation.y += dt;
    }
  }

  // -- lunar base -----------------------------------------------------------------------------------
  buildMoonBase() {
    this.baseGroup = new THREE.Group();
    this.baseGroup.position.set(0, 4 * MS, MOON_R - 1 * MS);
    this.baseGroup.rotation.x = -0.18;
    this.pv.moonMesh.add(this.baseGroup);
    this.baseLevel = -1;
    const domeG = new THREE.SphereGeometry(1.6 * MS, 14, 10, 0, TAU, 0, Math.PI / 2);
    const domeM = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.3, metalness: 0.4, emissive: 0x88aaff, emissiveIntensity: 0.25 });
    this.domeG = domeG; this.domeM = domeM;
    this.beaconMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 2 });
  }

  syncMoonBase() {
    let level = 0;
    for (const b of this.world.moon.bases) level = Math.max(level, b.size);
    if (level === this.baseLevel) return;
    this.baseLevel = level;
    while (this.baseGroup.children.length) this.baseGroup.remove(this.baseGroup.children[0]);
    if (level <= 0) return;
    const r = new RNG(555);
    const n = level >= 3 ? 9 : level >= 2 ? 5 : 2;
    const spots = [];
    for (let i = 0; i < n; i++) {
      const d = new THREE.Mesh(this.domeG, this.domeM);
      const px = r.range(-8, 8) * MS, pz = r.range(-6, 6) * MS;
      d.position.set(px, 0, pz);
      d.scale.setScalar(r.range(0.7, 1.3));
      this.baseGroup.add(d);
      spots.push(d.position);
    }
    // connector tubes between neighboring domes
    const tubeM = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.5, metalness: 0.5 });
    for (let i = 1; i < spots.length; i++) {
      const a = spots[i - 1], b = spots[i];
      const len = a.distanceTo(b);
      if (len > 9 * MS) continue;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * MS, 0.35 * MS, len, 8), tubeM);
      tube.position.copy(a).lerp(b, 0.5);
      tube.position.y = 0.4 * MS;
      tube.quaternion.setFromUnitVectors(Y_AXIS, _v1.copy(b).sub(a).normalize());
      this.baseGroup.add(tube);
    }
    // solar panel farm
    const panM = new THREE.MeshStandardMaterial({ color: 0x1c3f9e, roughness: 0.35, metalness: 0.5, emissive: 0x0a1c50, emissiveIntensity: 0.5 });
    for (let i = 0; i < 4; i++) {
      const pan = new THREE.Mesh(new THREE.BoxGeometry(2.4 * MS, 0.12 * MS, 1.5 * MS), panM);
      pan.position.set((-6 + i * 3.4) * MS, 0.8 * MS, 8.5 * MS);
      pan.rotation.x = -0.5;
      this.baseGroup.add(pan);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * MS, 0.08 * MS, 0.9 * MS, 6), tubeM);
      leg.position.set((-6 + i * 3.4) * MS, 0.4 * MS, 8.5 * MS);
      this.baseGroup.add(leg);
    }
    // landing pad + comms tower with pulsing beacon
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3 * MS, 3.4 * MS, 0.4 * MS, 14), new THREE.MeshStandardMaterial({ color: 0x8a929a }));
    pad.position.set(9 * MS, 0.2 * MS, 4 * MS);
    this.baseGroup.add(pad);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * MS, 0.35 * MS, 7 * MS, 8), new THREE.MeshStandardMaterial({ color: 0xdde3ea }));
    tower.position.set(-8 * MS, 3.5 * MS, -4 * MS);
    this.baseGroup.add(tower);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45 * MS, 10, 8), this.beaconMat);
    beacon.position.set(-8 * MS, 7.2 * MS, -4 * MS);
    this.baseGroup.add(beacon);
    // floodlight poles with emissive globes
    const poleM = new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.6, metalness: 0.6 });
    const globeM = new THREE.MeshBasicMaterial({ color: 0xcfeaff, fog: false });
    const poleSpots = [[-4, 2], [3, -3], [6, 3], [-1, -6], [10, -2]];
    for (const [px, pz] of poleSpots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * MS, 0.12 * MS, 3 * MS, 6), poleM);
      pole.position.set(px * MS, 1.5 * MS, pz * MS);
      this.baseGroup.add(pole);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.32 * MS, 10, 8), globeM);
      globe.position.set(px * MS, 3.1 * MS, pz * MS);
      this.baseGroup.add(globe);
    }
    // parked rover: chassis + mast + dish
    const roverM = new THREE.MeshStandardMaterial({ color: 0xd8c26a, roughness: 0.55, metalness: 0.45 });
    const rover = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6 * MS, 0.5 * MS, 1.0 * MS), roverM);
    chassis.position.y = 0.7 * MS;
    rover.add(chassis);
    const wheelG = new THREE.CylinderGeometry(0.32 * MS, 0.32 * MS, 0.25 * MS, 10);
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.9 });
    for (const [wx, wz] of [[-0.6, 0.5], [0.6, 0.5], [-0.6, -0.5], [0.6, -0.5]]) {
      const w = new THREE.Mesh(wheelG, wheelM);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx * MS, 0.32 * MS, wz * MS);
      rover.add(w);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * MS, 0.05 * MS, 1.0 * MS, 6), poleM);
    mast.position.set(-0.5 * MS, 1.4 * MS, 0);
    rover.add(mast);
    const rdish = new THREE.Mesh(new THREE.SphereGeometry(0.4 * MS, 10, 6, 0, TAU, 0, 0.7), this.domeM);
    rdish.position.set(-0.5 * MS, 1.95 * MS, 0);
    rdish.rotation.x = 0.6;
    rover.add(rdish);
    rover.position.set(4 * MS, 0, 6 * MS);
    rover.rotation.y = 0.7;
    this.baseGroup.add(rover);
    // ground lights (soft round additive points)
    const lg = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 30; i++) pts.push(r.range(-10, 12) * MS, 0.3 * MS, r.range(-7, 7) * MS);
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const lm = new THREE.PointsMaterial({ color: 0x9fd8ff, size: 1.1 * MS, map: glowTexture('rgba(200,230,255,1)', 'rgba(120,180,255,0)'), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.baseGroup.add(new THREE.Points(lg, lm));
  }

  // -- route arcs (red war links, amber trade links between capitals) --------------------
  buildRoutes() {
    this.routeGroup = new THREE.Group();
    this.spin.add(this.routeGroup);
  }

  syncRoutes() {
    while (this.routeGroup.children.length) {
      const l = this.routeGroup.children.pop();
      l.geometry.dispose(); l.material.dispose();
    }
    const world = this.world;
    const lines = [];
    const seen = new Set();
    for (const civ of world.civs) {
      if (!civ.alive) continue;
      for (const w of civ.wars) {
        const foe = world.civs[w.foe];
        if (!foe || !foe.alive) continue;
        const key = civ.id < foe.id ? civ.id * 100 + foe.id : foe.id * 100 + civ.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = world.capitalOf(civ), b = world.capitalOf(foe);
        if (a && b) lines.push({ a: a.dir, b: b.dir, war: true });
      }
    }
    const alive = world.civs.filter((c) => c.alive);
    let tn = 0;
    for (let i = 0; i < alive.length && tn < 10; i++) {
      for (let j = i + 1; j < alive.length && tn < 10; j++) {
        const A = alive[i], B2 = alive[j];
        if ((A.relations[B2.id] ?? 0) > 35) {
          const a = world.capitalOf(A), b = world.capitalOf(B2);
          if (a && b) { lines.push({ a: a.dir, b: b.dir, war: false }); tn++; }
        }
      }
    }
    for (const L of lines.slice(0, 26)) {
      const a = this.localPos(L.a, 1.5 * S, new THREE.Vector3());
      const b = this.localPos(L.b, 1.5 * S, new THREE.Vector3());
      const dist = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(PLANET_R + 1.5 * S + dist * 0.22);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));
      const m = new THREE.LineBasicMaterial({
        color: L.war ? 0xff3a22 : 0xffa040, transparent: true,
        opacity: L.war ? 0.85 : 0.30, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false,
      });
      const line = new THREE.Line(g, m);
      line.frustumCulled = false;
      line.renderOrder = 6;
      line.userData.war = L.war;
      this.routeGroup.add(line);
    }
  }

  // -- particle effects -------------------------------------------------------------------------------
  buildEffects() {
    this.effects = [];
    this.flashTex = glowTexture('rgba(255,230,180,1)', 'rgba(255,140,60,0)');
    this.sparkTex = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.puffTex = glowTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
    for (let i = 0; i < 16; i++) {
      const N = 110;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.PointsMaterial({ size: 1.6 * S, map: this.sparkTex, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      this.spin.add(pts);
      this.effects.push({ pts, vel: new Float32Array(N * 3), life: 0, maxLife: 1, active: false, grav: 0, drag: 0, world: false });
    }
    this.worldFlashes = [];
  }

  spawnEffect(type, dirLocal, scale = 1) {
    const e = this.effects.find((x) => !x.active);
    if (!e) return null;
    const N = 110;
    const pos = e.pts.geometry.attributes.position.array;
    const h = 1.2 * S;
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    const up = new THREE.Vector3(dirLocal.x, dirLocal.y, dirLocal.z).normalize();
    tangentBasis(up, t1, t2);
    const cfg = {
      explosion: { c: 0xffa040, life: 2.2, spd: 9, up: 7, grav: 6, size: 2.2 },
      fire: { c: 0xff7722, life: 4, spd: 3, up: 5, grav: -1, size: 2.0 },
      smoke: { c: 0x555555, life: 5, spd: 2, up: 4, grav: -0.5, size: 2.6 },
      eruption: { c: 0xff5518, life: 6, spd: 6, up: 16, grav: 9, size: 2.4 },
      meteor: { c: 0xffcc88, life: 2.6, spd: 12, up: 4, grav: 8, size: 2.4 },
      splash: { c: 0x55aaff, life: 2.4, spd: 8, up: 8, grav: 9, size: 2.2 },
      battle: { c: 0xff8844, life: 3, spd: 6, up: 4, grav: 5, size: 1.8 },
      bless: { c: 0xffe27a, life: 4, spd: 2, up: 6, grav: -2, size: 1.8 },
      smite: { c: 0xfff2cc, life: 3, spd: 14, up: 6, grav: 6, size: 3.0 },
      launchFlash: { c: 0xffcc99, life: 1.6, spd: 7, up: 3, grav: 2, size: 2.2 },
      terraform: { c: 0xbb9977, life: 3, spd: 8, up: 5, grav: 7, size: 2.2 },
      godForest: { c: 0x66ff88, life: 3, spd: 3, up: 5, grav: -1, size: 1.8 },
      arrivalFlash: { c: 0x9fd8ff, life: 2, spd: 6, up: 2, grav: 0, size: 2.4 },
      shower: { c: 0xcfe4ff, life: 3, spd: 16, up: 0, grav: 0, size: 1.6 },
    }[type] || { c: 0xffffff, life: 2, spd: 6, up: 5, grav: 5, size: 2 };
    e.pts.material.color.setHex(cfg.c);
    e.pts.material.size = cfg.size * S * scale;
    e.pts.material.blending = (type === 'smoke') ? THREE.NormalBlending : THREE.AdditiveBlending;
    e.pts.material.map = (type === 'smoke' || type === 'terraform' || type === 'splash' || type === 'godForest') ? this.puffTex : this.sparkTex;
    e.pts.material.needsUpdate = false;
    e.life = cfg.life; e.maxLife = cfg.life;
    e.grav = cfg.grav * S; e.active = true;
    e.pts.visible = true;
    for (let i = 0; i < N; i++) {
      const jx = (Math.random() - 0.5) * 2 * scale * S, jz = (Math.random() - 0.5) * 2 * scale * S;
      _v1.copy(up).multiplyScalar(PLANET_R + h)
        .addScaledVector(t1, jx).addScaledVector(t2, jz);
      pos.set([_v1.x, _v1.y, _v1.z], i * 3);
      const vx = (Math.random() - 0.5) * cfg.spd * S * scale;
      const vy = Math.random() * cfg.up * S * scale;
      const vz = (Math.random() - 0.5) * cfg.spd * S * scale;
      _v2.copy(up).multiplyScalar(vy).addScaledVector(t1, vx).addScaledVector(t2, vz);
      e.vel.set([_v2.x, _v2.y, _v2.z], i * 3);
    }
    e.pts.geometry.attributes.position.needsUpdate = true;
    e.up = up;
    return e;
  }

  spawnEffectAtWorld(type, worldPos, scale) {
    this.spin.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(this.spin.matrixWorld).invert();
    const local = worldPos.clone().applyMatrix4(inv);
    const dir = local.clone().normalize();
    const e = this.spawnEffect(type === 'arrivalFlash' ? 'arrivalFlash' : 'explosion', dir, scale);
    if (e) {
      const pos = e.pts.geometry.attributes.position.array;
      for (let i = 0; i < 110; i++) {
        pos[i * 3] += (local.x - dir.x * (PLANET_R + 1.2 * S));
        pos[i * 3 + 1] += (local.y - dir.y * (PLANET_R + 1.2 * S));
        pos[i * 3 + 2] += (local.z - dir.z * (PLANET_R + 1.2 * S));
      }
      e.pts.geometry.attributes.position.needsUpdate = true;
    }
  }

  updateEffects(dtReal, warp) {
    const dt = dtReal * Math.min(warp, 8);
    for (const e of this.effects) {
      if (!e.active) continue;
      e.life -= dt;
      if (e.life <= 0) { e.active = false; e.pts.visible = false; continue; }
      const pos = e.pts.geometry.attributes.position.array;
      for (let i = 0; i < 110; i++) {
        _v1.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).normalize();
        e.vel[i * 3] -= _v1.x * e.grav * dt;
        e.vel[i * 3 + 1] -= _v1.y * e.grav * dt;
        e.vel[i * 3 + 2] -= _v1.z * e.grav * dt;
        pos[i * 3] += e.vel[i * 3] * dt;
        pos[i * 3 + 1] += e.vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += e.vel[i * 3 + 2] * dt;
      }
      e.pts.geometry.attributes.position.needsUpdate = true;
      e.pts.material.opacity = clamp(e.life / e.maxLife, 0, 1);
    }
  }

  // -- selection ring -----------------------------------------------------------------------------------
  buildSelection() {
    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 1.9, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    this.selRing.visible = false;
    this.selRing.renderOrder = 7;
    this.spin.add(this.selRing);
    this.selDir = null;
  }

  setSelection(dirLocal, scale = 2.5 * S, color = 0xffffff) { // scale in world units
    if (!dirLocal) { this.selRing.visible = false; this.selDir = null; return; }
    this.selDir = dirLocal.clone ? dirLocal.clone() : new THREE.Vector3(dirLocal.x, dirLocal.y, dirLocal.z);
    this.selRing.visible = true;
    this.selRing.material.color.setHex(color);
    this.selRing.userData.scale = scale;
  }

  // -- helpers --------------------------------------------------------------------------------------------
  cityWorldPos(city, out) {
    const cell = this.world.cells[city.cell];
    const h = cell ? this.surfH(cell.elev) + 1 * S : 1 * S;
    out = out || new THREE.Vector3();
    out.set(city.dir.x, city.dir.y, city.dir.z).multiplyScalar(PLANET_R + h);
    this.spin.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.spin.matrixWorld);
  }

  nearestCity(spinDir) {
    let best = null, bd = 1e9;
    for (const c of this.world.cities) {
      const d = (c.dir.x - spinDir.x) ** 2 + (c.dir.y - spinDir.y) ** 2 + (c.dir.z - spinDir.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return { city: best, dist: Math.sqrt(bd) };
  }

  // -- per-frame --------------------------------------------------------------------------------------------
  drainQueue() {
    const q = this.world.visualQueue;
    while (q.length) {
      const e = q.shift();
      if (e.t === 'launch') this.launchRocket(e.civ, e.city, e.mission);
      else if (e.t === 'satellites') this.syncSatellites();
      else if (e.t === 'disaster') {
        const map = { earthquake: 'explosion', volcano: 'eruption', meteor: 'meteor', smite: 'smite', tsunami: 'splash', flood: 'splash', wildfire: 'fire', storm: 'explosion', hurricane: 'splash', plague: 'smoke', drought: 'smoke' };
        this.spawnEffect(map[e.kind] || 'explosion', e.dir, e.kind === 'meteor' || e.kind === 'smite' ? 2.2 : 1.4);
        if (e.kind === 'volcano') this.spawnEffect('smoke', e.dir, 2.2);
        if (e.kind === 'meteor') this.pv.markTerrainDirty();
      }
      else if (e.t === 'battle') this.spawnEffect('battle', e.dir, 1.2);
      else if (e.t === 'bless') this.spawnEffect('bless', e.dir, 1.6);
      else if (e.t === 'godForest') this.spawnEffect('godForest', e.dir, 2);
      else if (e.t === 'terraform') { this.spawnEffect('terraform', e.dir, 1.8); this.pv.markTerrainDirty(); }
      else if (e.t === 'meteorShower') { for (let i = 0; i < 4; i++) this.spawnEffect('shower', { x: e.dir.x + (Math.random() - 0.5) * 0.4, y: e.dir.y + (Math.random() - 0.5) * 0.4, z: e.dir.z + (Math.random() - 0.5) * 0.4 }, 1.5); }
      else if (e.t === 'comet') this.pv.fireComet();
      else if (e.t === 'eraUp') { /* handled via dirty flags */ }
    }
  }

  update(dtReal, warp, camera, sunDir) {
    this.time += dtReal;
    this.drainQueue();

    if (this.world.viewsDirty.cities && this.time - this.lastCityBuild > 1.6) {
      this.world.viewsDirty.cities = false;
      this.lastCityBuild = this.time;
      this.rebuildCities();
    }
    if (this.world.viewsDirty.territory && this.time - this.lastTerrBuild > 1.0) {
      this.world.viewsDirty.territory = false;
      this.lastTerrBuild = this.time;
      this.rebuildTerritory();
    }
    if (this.time - this.lastStormSync > 0.5) { this.lastStormSync = this.time; this.syncStorms(); }
    if (this.time - this.lastHerdSync > 3.0) { this.lastHerdSync = this.time; this.syncFauna(); }
    if (this.time - this.lastRouteSync > 3.0) { this.lastRouteSync = this.time; this.syncRoutes(); }
    for (const l of this.routeGroup.children) {
      if (l.userData.war) l.material.opacity = 0.62 + 0.3 * Math.sin(this.time * 3.2);
    }
    this.syncMoonBase();
    this.syncSatellites();

    if (sunDir) {
      this.lightUniforms.uSunDir.value.copy(sunDir);
      this.pv.planetWorldPos(this.lightUniforms.uCenter.value);
      this.lightUniforms.uTime.value = this.time;
    }

    // lunar beacon pulse
    if (this.beaconMat) this.beaconMat.emissiveIntensity = 1.4 + Math.sin(this.time * 5) * 1.2;

    const pp = this.pv.planetWorldPos(_v1);
    const camDist = camera.position.distanceTo(pp) - PLANET_R;
    if (camDist < 26 * S) {
      this.spin.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4().copy(this.spin.matrixWorld).invert();
      const lp = new THREE.Vector3().copy(camera.position).applyMatrix4(inv).normalize();
      const { city, dist } = this.nearestCity(lp);
      if (city && dist < 0.12 && (!this.citizenCity || this.citizenCity.id !== city.id)) this.setCitizenCity(city);
      else if ((!city || dist >= 0.12) && this.citizenCity) this.setCitizenCity(null);
      this.updateCitizens(dtReal * Math.min(warp, 4));
      this.imFauna.visible = true;
    } else {
      if (this.citizenCity) this.setCitizenCity(null);
      this.imCit.count = 0;
    }
    if (camDist < 220 * S) { this.updateFauna(dtReal * Math.min(warp, 4)); this.imFauna.visible = true; this.imBirds.visible = true; }
    else { this.imFauna.visible = false; this.imBirds.visible = false; }
    const treesNear = camDist < 500 * S;
    this.imTrunk.visible = treesNear;
    this.imCanopy.visible = treesNear;
    this.updateBoats(camDist);

    this.rings.material.opacity = camDist > 1500 * S ? 0.25 : 0.85;

    this.updateRockets(dtReal, warp);
    this.updateSatellites(dtReal, warp);
    this.updateEffects(dtReal, warp);

    if (this.selRing.visible && this.selDir) {
      const s = (this.selRing.userData.scale || 2.5) * (1 + Math.sin(this.time * 3) * 0.08);
      this.selRing.position.copy(this.selDir).multiplyScalar(PLANET_R + 0.6 * S);
      this.selRing.quaternion.setFromUnitVectors(Z_AXIS, this.selDir);
      this.selRing.scale.set(s, s, s);
    }
  }
}
