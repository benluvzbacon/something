// ---------------------------------------------------------------------------
// worldView.js — renders the living world: instanced cities that evolve by
// era, territory, night lights, wildlife, citizens, weather sprites, rockets,
// satellites, lunar bases, disaster/god-power effects.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RNG, TAU, clamp, lerp } from './noise.js';
import { PLANET_R, ERAS, B } from './world.js';
import { MOON_R } from './planetView.js';

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
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const a = t * 4.2 + arm * (TAU / 3);
      const rad = 12 + t * 105;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      const r = 26 * (1 - t * 0.6);
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

    this.buildCities();
    this.buildTerritory();
    this.buildLights();
    this.buildRings();
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

  // -- cities (instanced buildings by era) --------------------------------------
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
    this.imHut = mk(new THREE.ConeGeometry(0.42, 0.8, 6), std(), 3500);
    this.imHouse = mk(new THREE.BoxGeometry(0.7, 0.55, 0.7), std(), 9000);
    this.imBlock = mk(new THREE.BoxGeometry(1.1, 1.0, 1.1), std(), 7000);
    this.imTower = mk(new THREE.BoxGeometry(0.9, 2.8, 0.9), std({ emissive: 0xffca7a, emissiveIntensity: 0.55 }), 5000);
    this.imDome = mk(new THREE.SphereGeometry(0.9, 12, 8, 0, TAU, 0, Math.PI / 2), std({ color: 0xdfe8f2, roughness: 0.35, metalness: 0.35 }), 500);
    this.imPad = mk(new THREE.CylinderGeometry(1.6, 1.8, 0.3, 12), std({ color: 0x9aa2ab, roughness: 0.6 }), 48);
    this.imWall = mk(new THREE.BoxGeometry(1.6, 0.7, 0.35), std({ color: 0x8d8578 }), 2500);
  }

  styleForEra(era) {
    // returns mix weights [hut, house, block, tower, wall]
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
    // biggest cities first so caps favor them
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
      // building count scales with log pop
      let n = Math.floor(clamp(3 + Math.log10(Math.max(10, city.pop)) * 4.2 - era * 0.4, 3, 90));
      if (dmg > 0.4) n = Math.floor(n * (1 - dmg * 0.5));
      const spread = 1.1 + Math.sqrt(n) * 0.42 + era * 0.12;
      const mix = this.styleForEra(era);
      const basePos = this.localPos(d, h0, new THREE.Vector3());
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + crng.next() * 0.8;
        const rr = spread * Math.sqrt((i + 0.5) / n) + crng.range(0, 0.3);
        const px = basePos.x + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * rr;
        const py = basePos.y + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * rr;
        const pz = basePos.z + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * rr;
        // re-seat on sphere
        _v1.set(px, py, pz).normalize();
        const hh = h0 + 0.05;
        const bx = _v1.x * (PLANET_R + hh), by = _v1.y * (PLANET_R + hh), bz = _v1.z * (PLANET_R + hh);
        const roll = crng.next();
        const yaw = crng.range(0, TAU);
        let done = false;
        const sc = 0.8 + crng.next() * 0.5 + Math.min(1.2, Math.log10(Math.max(10, city.pop)) * 0.14);
        if (roll < mix[0]) {
          tmpC.setHSL(0.08, 0.35, 0.28 + crng.next() * 0.12);
          done = put(0, bx, by, bz, _v1, yaw, sc, sc, sc, tmpC);
        } else if (roll < mix[0] + mix[1]) {
          tmpC.setHSL(era >= 6 ? 0.6 : 0.09, era >= 6 ? 0.08 : 0.3, 0.35 + crng.next() * 0.25);
          done = put(1, bx, by, bz, _v1, yaw, sc, sc * (0.8 + crng.next() * 0.5), sc, tmpC);
        } else if (roll < mix[0] + mix[1] + mix[2]) {
          tmpC.setHSL(0.08 + crng.next() * 0.04, 0.15, 0.4 + crng.next() * 0.25);
          done = put(2, bx, by, bz, _v1, yaw, sc, sc * (0.9 + crng.next() * 0.8), sc, tmpC);
        } else {
          tmpC.setHSL(0.58, 0.25, 0.5 + crng.next() * 0.25);
          done = put(3, bx, by, bz, _v1, yaw, sc, sc * (0.8 + crng.next() * 1.1), sc, null);
        }
        if (done && era >= 3 && crng.chance(0.5)) {
          lightPts.push(bx, by, bz);
        }
        // medieval walls ring
        if (mix[4] > 0 && i < 10 && crng.chance(mix[4] * 0.5)) {
          const wa = (i / 10) * TAU;
          const wr = spread * 1.15;
          const wx = basePos.x + (t1.x * Math.cos(wa) + t2.x * Math.sin(wa)) * wr;
          const wy = basePos.y + (t1.y * Math.cos(wa) + t2.y * Math.sin(wa)) * wr;
          const wz = basePos.z + (t1.z * Math.cos(wa) + t2.z * Math.sin(wa)) * wr;
          _v2.set(wx, wy, wz).normalize();
          put(6, _v2.x * (PLANET_R + h0 + 0.1), _v2.y * (PLANET_R + h0 + 0.1), _v2.z * (PLANET_R + h0 + 0.1), _v2, wa, 1, 1, 1, null);
        }
      }
      // space-age domes
      if (era >= 8) {
        const nd = Math.min(4, 1 + Math.floor(city.pop / 500000));
        for (let i = 0; i < nd; i++) {
          const a = crng.range(0, TAU), rr = spread * 1.3 + i * 1.2;
          _v1.set(
            basePos.x + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * rr,
            basePos.y + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * rr,
            basePos.z + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * rr
          ).normalize();
          put(4, _v1.x * (PLANET_R + h0 + 0.05), _v1.y * (PLANET_R + h0 + 0.05), _v1.z * (PLANET_R + h0 + 0.05), _v1, 0, 1.4, 1.1, 1.4, null);
        }
      }
      // launch pad
      if (city.launchpad) {
        const a = 1.1;
        _v1.set(
          basePos.x + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * (spread * 1.6 + 2),
          basePos.y + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * (spread * 1.6 + 2),
          basePos.z + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * (spread * 1.6 + 2)
        ).normalize();
        put(5, _v1.x * (PLANET_R + h0 + 0.1), _v1.y * (PLANET_R + h0 + 0.1), _v1.z * (PLANET_R + h0 + 0.1), _v1, 0, 1, 1, 1, null);
      }
      city._spread = spread;
    }
    for (let i = 0; i < ims.length; i++) {
      ims[i].count = counters[i];
      ims[i].instanceMatrix.needsUpdate = true;
      if (ims[i].instanceColor) ims[i].instanceColor.needsUpdate = true;
    }
    // night lights
    this.rebuildLights(lightPts);
    this.rebuildRings(cities);
    this.syncSmogDamage(cities);
  }

  // -- night lights ---------------------------------------------------------------
  buildLights() {
    this.lightUniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uCenter: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.lightUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform vec3 uSunDir; uniform vec3 uCenter; uniform float uTime;
        varying float vA;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vec3 wd = normalize(wp.xyz - uCenter);
          float night = smoothstep(0.22, -0.18, dot(wd, normalize(uSunDir)));
          float tw = 0.75 + 0.25*sin(uTime*3.0 + position.x*12.0 + position.y*17.0);
          vA = night * tw;
          vec4 mv = viewMatrix * wp;
          gl_PointSize = clamp(130.0 / -mv.z, 1.0, 7.0);
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

  // -- territory dots ---------------------------------------------------------------
  buildTerritory() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3), 3));
    const mat = new THREE.PointsMaterial({ size: 1.5, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
    this.terrPts = new THREE.Points(geo, mat);
    this.terrPts.frustumCulled = false;
    this.terrPts.renderOrder = 5;
    this.spin.add(this.terrPts);
  }

  rebuildTerritory() {
    const pos = [], col = [];
    const c = new THREE.Color();
    for (const cell of this.world.cells) {
      if (cell.owner === -1 || cell.ocean) continue;
      const civ = this.world.civs[cell.owner];
      if (!civ || !civ.alive) continue;
      const h = this.surfH(cell.elev) + 0.7;
      pos.push(cell.dir.x * (PLANET_R + h), cell.dir.y * (PLANET_R + h), cell.dir.z * (PLANET_R + h));
      c.setHex(civ.color);
      col.push(c.r, c.g, c.b);
    }
    this.terrPts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.length ? pos : [0, 0, 0]), 3));
    this.terrPts.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col.length ? col : [0, 0, 0]), 3));
  }

  // -- city rings ---------------------------------------------------------------------
  buildRings() {
    const geo = new THREE.RingGeometry(1.1, 1.45, 40);
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
      const h = this.surfH(cell.elev) + 0.35;
      const spread = city._spread || 2;
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
    // smog over industrial cities, smoke over damaged cities
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
        sp.position.copy(this.localPos(city.dir, h + 3.2));
        const sc = (city._spread || 2) * 2.2;
        sp.scale.set(sc, sc * 0.7, 1);
        this.spin.add(sp);
        this.smogSprites.push(sp);
        smogN++;
      }
      if (city.damage > 0.25 && dmgN < 24) {
        const m = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x554444, transparent: true, opacity: 0.7, depthWrite: false });
        const sp = new THREE.Sprite(m);
        sp.position.copy(this.localPos(city.dir, h + 2.2));
        sp.scale.set(4, 6, 1);
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
      sp.position.copy(this.localPos(st.dir, 3.4));
      const sc = 9 + st.intensity * 9;
      sp.scale.set(sc, sc, 1);
      const tint = st.type === 'hurricane' ? 0xdfe9ff : st.type === 'thunderstorm' ? 0xb9aee8 : st.type === 'snowstorm' ? 0xffffff : 0xaac4d8;
      sp.material.color.setHex(tint);
      sp.material.rotation += 0.01 * st.intensity;
      sp.material.opacity = st.type === 'rain' ? 0.45 : 0.8;
    }
  }

  // -- wildlife -------------------------------------------------------------------------
  buildAnimals() {
    const g = new THREE.BoxGeometry(0.55, 0.35, 0.8);
    const m = new THREE.MeshLambertMaterial({});
    this.imFauna = new THREE.InstancedMesh(g, m, 700);
    this.imFauna.frustumCulled = false;
    this.imFauna.count = 0;
    this.spin.add(this.imFauna);
    const bg = new THREE.ConeGeometry(0.22, 0.7, 4);
    const bm = new THREE.MeshBasicMaterial({ color: 0xf2f4f6 });
    this.imBirds = new THREE.InstancedMesh(bg, bm, 220);
    this.imBirds.frustumCulled = false;
    this.imBirds.count = 0;
    this.spin.add(this.imBirds);
    this.fauna = []; // {herd, ox, oz, ph}
  }

  syncFauna() {
    this.fauna = [];
    const r = this.rng;
    for (const h of this.world.herds) {
      if (h.marine || h.n < 30) continue;
      const n = h.kind === 'bird' ? 0 : Math.min(4, 1 + Math.floor(h.n / 300));
      for (let i = 0; i < n && this.fauna.length < 650; i++) {
        this.fauna.push({ h, ox: r.range(-3, 3), oz: r.range(-3, 3), ph: r.range(0, TAU), bird: false });
      }
      if (h.kind === 'bird') {
        for (let i = 0; i < 3 && this.fauna.length < 650; i++) {
          this.fauna.push({ h, ox: r.range(-6, 6), oz: r.range(-6, 6), ph: r.range(0, TAU), bird: true, alt: r.range(2, 7) });
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
      const wx = f.ox + Math.sin(f.ph) * 1.2, wz = f.oz + Math.cos(f.ph * 0.8) * 1.2;
      const h = this.surfH(cell.elev) + (f.bird ? f.alt + Math.sin(f.ph * 2) * 0.5 : 0.3);
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
        // birds fly tangent to the surface
        _q.setFromUnitVectors(Y_AXIS, _v1);
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
    const g = new THREE.CapsuleGeometry(0.09, 0.22, 3, 6);
    const m = new THREE.MeshLambertMaterial({});
    this.imCit = new THREE.InstancedMesh(g, m, 40);
    this.imCit.frustumCulled = false;
    this.imCit.count = 0;
    this.spin.add(this.imCit);
    this.citizens = [];
    // followed person marker
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24),
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
      this.citizens.push({ a: r.range(0, TAU), rr: r.range(0.5, (city._spread || 2) * 1.4), sp: r.range(0.1, 0.5) * (r.chance(0.5) ? 1 : -1), hue: r.next() });
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
      _m.compose(_v1.clone().multiplyScalar(PLANET_R + this.surfH(cell.elev) + 0.25), _q, _s.set(1, 1, 1));
      this.imCit.setMatrixAt(n, _m);
      this.imCit.setColorAt(n, c.setHSL(w.hue, 0.5, 0.45));
      n++;
    }
    this.imCit.count = n;
    this.imCit.instanceMatrix.needsUpdate = true;
    if (this.imCit.instanceColor) this.imCit.instanceColor.needsUpdate = true;
    // followed person
    if (this.followPerson && this.followPerson.city === city.id) {
      const fp = this.followPerson;
      fp.a += fp.sp * dt;
      const px = base.x + (t1.x * Math.cos(fp.a) + t2.x * Math.sin(fp.a)) * fp.rr;
      const py = base.y + (t1.y * Math.cos(fp.a) + t2.y * Math.sin(fp.a)) * fp.rr;
      const pz = base.z + (t1.z * Math.cos(fp.a) + t2.z * Math.sin(fp.a)) * fp.rr;
      _v1.set(px, py, pz).normalize();
      this.personRing.visible = true;
      this.personRing.position.copy(_v1).multiplyScalar(PLANET_R + this.surfH(cell.elev) + 0.3);
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
    const bodyG = new THREE.CylinderGeometry(0.45, 0.5, 2.4, 10);
    const noseG = new THREE.ConeGeometry(0.45, 1.0, 10);
    const flameG = new THREE.ConeGeometry(0.4, 1.8, 8);
    this.flameTex = glowTexture('rgba(255,200,120,1)', 'rgba(255,120,40,0)');
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyG, new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4, metalness: 0.3 }));
      body.position.y = 1.2;
      const nose = new THREE.Mesh(noseG, new THREE.MeshStandardMaterial({ color: 0xd43a2f, roughness: 0.5 }));
      nose.position.y = 2.9;
      const flame = new THREE.Mesh(flameG, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, fog: false }));
      flame.position.y = -0.9;
      flame.rotation.x = Math.PI;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      glow.scale.set(4, 4, 1);
      glow.position.y = -0.8;
      g.add(body, nose, flame, glow);
      g.visible = false;
      this.scene.add(g);
      this.rockets.push({ g, flame, glow, active: false, t: 0, dur: 55, from: new THREE.Vector3(), ctrl: new THREE.Vector3(), mission: '', civ: -1 });
    }
  }

  launchRocket(civId, cityId, mission) {
    const r = this.rockets.find((x) => !x.active);
    const city = this.world.cityById(cityId);
    if (!r || !city) return null;
    const cell = this.world.cells[city.cell];
    const start = this.localPos(city.dir, this.surfH(cell.elev) + 0.5, new THREE.Vector3());
    this.spin.updateWorldMatrix(true, false);
    start.applyMatrix4(this.spin.matrixWorld);
    r.from.copy(start);
    // control point: high above launch site (world)
    const pp = this.pv.planetWorldPos(new THREE.Vector3());
    const up = start.clone().sub(pp).normalize();
    r.ctrl.copy(start).addScaledVector(up, 90);
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
    for (const r of this.rockets) {
      if (!r.active) continue;
      r.t += dt / r.dur;
      const t = Math.min(1, r.t);
      const target = (r.mission === 'test' || r.mission === 'sat')
        ? _v1.copy(r.from).addScaledVector(_v2.copy(r.from).sub(this.pv.planetWorldPos(_v3)).normalize(), 55)
        : _v1.copy(moonW);
      // quadratic bezier from → ctrl → target
      const a = r.from, b = r.ctrl, c = target;
      const p = r.g.position;
      const u = 1 - t;
      p.set(
        u * u * a.x + 2 * u * t * b.x + t * t * c.x,
        u * u * a.y + 2 * u * t * b.y + t * t * c.y,
        u * u * a.z + 2 * u * t * b.z + t * t * c.z
      );
      // orient along velocity
      _v2.set(
        2 * u * (b.x - a.x) + 2 * t * (c.x - b.x),
        2 * u * (b.y - a.y) + 2 * t * (c.y - b.y),
        2 * u * (b.z - a.z) + 2 * t * (c.z - b.z)
      ).normalize();
      r.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v2);
      const burning = t < 0.55;
      r.flame.visible = burning;
      r.glow.visible = burning;
      if (burning) {
        const f = 0.8 + Math.random() * 0.5;
        r.flame.scale.set(f, f * (1 + Math.random() * 0.4), f);
      }
      if (t >= 1) {
        r.active = false;
        r.g.visible = false;
        if (r.mission === 'crewed' || r.mission === 'base' || r.mission === 'colony' || r.mission === 'supply' || r.mission === 'probe') {
          // arrival flash at moon
          this.spawnEffectAtWorld('arrivalFlash', moonW, 6);
        }
      }
    }
  }

  // -- satellites ---------------------------------------------------------------------------------
  buildSatellites() {
    this.satGroup = new THREE.Group();
    this.pivot.add(this.satGroup);
    this.sats = [];
    const bodyG = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const panG = new THREE.BoxGeometry(2.6, 0.1, 1.0);
    this.satBodyG = bodyG; this.satPanG = panG;
  }

  syncSatellites() {
    let total = 0;
    for (const c of this.world.civs) total += c.space.satellites;
    total = Math.min(40, total);
    if (this.sats.length >= total) return;
    if (!this.satBodyM) {
      this.satBodyM = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, metalness: 0.7, roughness: 0.3 });
      this.satPanM = new THREE.MeshStandardMaterial({ color: 0x2244aa, metalness: 0.4, roughness: 0.4, emissive: 0x112255, emissiveIntensity: 0.6 });
    }
    const bodyM = this.satBodyM, panM = this.satPanM;
    while (this.sats.length < total) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.satBodyG, bodyM));
      const pan = new THREE.Mesh(this.satPanG, panM);
      g.add(pan);
      const r = this.rng;
      const sat = { g, ang: r.range(0, TAU), rad: PLANET_R * r.range(1.35, 1.9), incl: r.range(-0.6, 0.6), speed: r.range(0.5, 1) * 0.12 };
      this.sats.push(sat);
      this.satGroup.add(g);
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
    // placed on the planet-facing side of the moon (+Z faces planet via lookAt)
    this.baseGroup.position.set(0, 4, MOON_R - 1);
    this.baseGroup.rotation.x = -0.18;
    this.pv.moonMesh.add(this.baseGroup);
    this.baseLevel = -1;
    const domeG = new THREE.SphereGeometry(1.6, 14, 10, 0, TAU, 0, Math.PI / 2);
    const domeM = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.3, metalness: 0.4, emissive: 0x88aaff, emissiveIntensity: 0.25 });
    this.domeG = domeG; this.domeM = domeM;
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
    for (let i = 0; i < n; i++) {
      const d = new THREE.Mesh(this.domeG, this.domeM);
      d.position.set(r.range(-8, 8), 0, r.range(-6, 6));
      d.scale.setScalar(r.range(0.7, 1.3));
      this.baseGroup.add(d);
    }
    // landing pad + tower
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 0.4, 14), new THREE.MeshStandardMaterial({ color: 0x8a929a }));
    pad.position.set(9, 0.2, 4);
    this.baseGroup.add(pad);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 7, 8), new THREE.MeshStandardMaterial({ color: 0xdde3ea, emissive: 0xff5555, emissiveIntensity: 0.8 }));
    tower.position.set(-8, 3.5, -4);
    this.baseGroup.add(tower);
    // ground lights
    const lg = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 30; i++) pts.push(r.range(-10, 12), 0.3, r.range(-7, 7));
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const lm = new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.7, transparent: true, opacity: 0.9, fog: false });
    this.baseGroup.add(new THREE.Points(lg, lm));
  }

  // -- particle effects -------------------------------------------------------------------------------
  buildEffects() {
    this.effects = [];
    this.flashTex = glowTexture('rgba(255,230,180,1)', 'rgba(255,140,60,0)');
    for (let i = 0; i < 16; i++) {
      const N = 70;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.PointsMaterial({ size: 1.6, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      this.spin.add(pts);
      this.effects.push({ pts, vel: new Float32Array(N * 3), life: 0, maxLife: 1, active: false, grav: 0, drag: 0, world: false });
    }
    // world-space flashes (rocket arrivals)
    this.worldFlashes = [];
  }

  spawnEffect(type, dirLocal, scale = 1) {
    const e = this.effects.find((x) => !x.active);
    if (!e) return;
    const N = 70;
    const pos = e.pts.geometry.attributes.position.array;
    const h = 1.2;
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
    e.pts.material.size = cfg.size * scale;
    e.pts.material.blending = (type === 'smoke') ? THREE.NormalBlending : THREE.AdditiveBlending;
    e.life = cfg.life; e.maxLife = cfg.life;
    e.grav = cfg.grav; e.active = true;
    e.pts.visible = true;
    for (let i = 0; i < N; i++) {
      const jx = (Math.random() - 0.5) * 2 * scale, jz = (Math.random() - 0.5) * 2 * scale;
      _v1.copy(up).multiplyScalar(PLANET_R + h)
        .addScaledVector(t1, jx).addScaledVector(t2, jz);
      pos.set([_v1.x, _v1.y, _v1.z], i * 3);
      const vx = (Math.random() - 0.5) * cfg.spd * scale;
      const vy = Math.random() * cfg.up * scale;
      const vz = (Math.random() - 0.5) * cfg.spd * scale;
      _v2.copy(up).multiplyScalar(vy).addScaledVector(t1, vx).addScaledVector(t2, vz);
      e.vel.set([_v2.x, _v2.y, _v2.z], i * 3);
    }
    e.pts.geometry.attributes.position.needsUpdate = true;
    e.up = up;
    return e;
  }

  spawnEffectAtWorld(type, worldPos, scale) {
    // convert world → spin-local
    this.spin.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(this.spin.matrixWorld).invert();
    const local = worldPos.clone().applyMatrix4(inv);
    const dir = local.clone().normalize();
    // move particles to actual local point (far from surface, e.g. at moon)
    const e = this.spawnEffect(type === 'arrivalFlash' ? 'arrivalFlash' : 'explosion', dir, scale);
    if (e) {
      const pos = e.pts.geometry.attributes.position.array;
      for (let i = 0; i < 70; i++) {
        pos[i * 3] += (local.x - dir.x * (PLANET_R + 1.2));
        pos[i * 3 + 1] += (local.y - dir.y * (PLANET_R + 1.2));
        pos[i * 3 + 2] += (local.z - dir.z * (PLANET_R + 1.2));
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
      for (let i = 0; i < 70; i++) {
        // gravity toward planet center (approx radial)
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

  setSelection(dirLocal, scale = 2.5, color = 0xffffff) {
    if (!dirLocal) { this.selRing.visible = false; this.selDir = null; return; }
    this.selDir = dirLocal.clone ? dirLocal.clone() : new THREE.Vector3(dirLocal.x, dirLocal.y, dirLocal.z);
    this.selRing.visible = true;
    this.selRing.material.color.setHex(color);
    this.selRing.userData.scale = scale;
  }

  // -- helpers --------------------------------------------------------------------------------------------
  cityWorldPos(city, out) {
    const cell = this.world.cells[city.cell];
    const h = cell ? this.surfH(cell.elev) + 1 : 1;
    out = out || new THREE.Vector3();
    out.set(city.dir.x, city.dir.y, city.dir.z).multiplyScalar(PLANET_R + h);
    this.spin.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.spin.matrixWorld);
  }

  dirWorldToLocalSpin(worldDir, out) {
    // world direction from planet center → spin-local direction
    const pp = this.pv.planetWorldPos(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(this.spin.matrixWorld).invert();
    out = out || new THREE.Vector3();
    out.copy(worldDir).add(pp).applyMatrix4(inv).sub(new THREE.Vector3(0, 0, 0));
    // simpler: rotate-only inverse
    return out.normalize();
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

    // throttled rebuilds
    if (this.world.viewsDirty.cities && this.time - this.lastCityBuild > 1.6) {
      this.world.viewsDirty.cities = false;
      this.lastCityBuild = this.time;
      this.rebuildCities();
    }
    if (this.world.viewsDirty.territory && this.time - this.lastTerrBuild > 2.2) {
      this.world.viewsDirty.territory = false;
      this.lastTerrBuild = this.time;
      this.rebuildTerritory();
    }
    if (this.time - this.lastStormSync > 0.5) { this.lastStormSync = this.time; this.syncStorms(); }
    if (this.time - this.lastHerdSync > 3.0) { this.lastHerdSync = this.time; this.syncFauna(); }
    this.syncMoonBase();
    this.syncSatellites();

    // night light uniforms
    if (sunDir) {
      this.lightUniforms.uSunDir.value.copy(sunDir);
      this.pv.planetWorldPos(this.lightUniforms.uCenter.value);
      this.lightUniforms.uTime.value = this.time;
    }

    // citizen LOD: show wanderers near close-up city
    const pp = this.pv.planetWorldPos(_v1);
    const camDist = camera.position.distanceTo(pp) - PLANET_R;
    if (camDist < 26) {
      // find city near camera focus
      const focus = _v2.copy(camera.position).sub(pp).normalize();
      // world → spin local
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
    if (camDist < 220) { this.updateFauna(dtReal * Math.min(warp, 4)); this.imFauna.visible = true; this.imBirds.visible = true; }
    else { this.imFauna.visible = false; this.imBirds.visible = false; }

    // hide territory dots when very far (declutter) — fade by distance
    this.terrPts.material.opacity = camDist > 1200 ? 0.0 : camDist > 500 ? 0.3 : 0.55;
    this.terrPts.visible = this.terrPts.material.opacity > 0.01;
    this.rings.material.opacity = camDist > 1500 ? 0.25 : 0.85;

    this.updateRockets(dtReal, warp);
    this.updateSatellites(dtReal, warp);
    this.updateEffects(dtReal, warp);

    // selection pulse
    if (this.selRing.visible && this.selDir) {
      const s = (this.selRing.userData.scale || 2.5) * (1 + Math.sin(this.time * 3) * 0.08);
      this.selRing.position.copy(this.selDir).multiplyScalar(PLANET_R + 1.0);
      this.selRing.quaternion.setFromUnitVectors(Z_AXIS, this.selDir);
      this.selRing.scale.set(s, s, s);
    }
  }
}
