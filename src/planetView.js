// ---------------------------------------------------------------------------
// planetView.js — Three.js rendering of the star, planet, ocean, atmosphere,
// clouds, moon, orbits, eclipses, comets. Owns the day/night rotation and
// orbital mechanics (visual time).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RNG, TAU, clamp } from './noise.js';
import { PLANET_R, WORLD_SCALE, ROTATION_SECONDS } from './world.js';

const PS = WORLD_SCALE;

export const MOON_R = 70;
export const MOON_DIST = 900;
export const MOON_SCALE = MOON_R / 22;
export const MOON_PERIOD = 300;          // seconds per lunar orbit at 1x
export const ORBIT_DIST = 16000;         // planet→sun distance
export const ORBIT_PERIOD = ROTATION_SECONDS * 8; // one "year-orbit" per 8 days
export const SUN_R = 1200;               // the star dwarfs the planet, as it should

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PlanetView {
  constructor(scene, planet, seed) {
    this.scene = scene;
    this.planet = planet;
    this.rng = new RNG(seed >>> 0);
    this.spinAngle = 0;
    this.cloudAngle = 0;
    this.cloudAngle2 = 2.1;
    this.moonAngle = 1.2;
    this.orbitAngle = 0;
    this.eclipse = null;       // 'solar' | 'lunar' | null
    this.eclipseMix = 0;
    this.showOrbits = true;
    this.sunDim = 1;
    this.time = 0;

    this.buildLights();
    this.buildStars();
    this.buildSun();
    this.buildSystem();
    this.buildTerrain();
    this.buildOcean();
    this.buildClouds();
    this.buildAtmosphere();
    this.buildMoon();
    this.buildOrbitLines();
    this.buildComet();
  }

  // -- lights ---------------------------------------------------------------
  buildLights() {
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -140 * PS; sc.right = 140 * PS; sc.top = 140 * PS; sc.bottom = -140 * PS;
    sc.near = 1; sc.far = 8000;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 1.5;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    // faint moonlight so the night side is readable + cool
    this.moonLight = new THREE.DirectionalLight(0x8fb4ff, 0.10);
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);
    this.hemi = new THREE.HemisphereLight(0xbcd3ff, 0x3a2f26, 0.35);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0x0a1428, 0.0011 / PS);
  }

  buildStars() {
    const N = 4200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const r = new RNG(1234567);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1));
      if (v.lengthSq() < 1e-4) v.set(0.3, 0.4, 0.5);
      v.normalize().multiplyScalar(60000);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = r.next();
      const c = t < 0.7 ? [1, 1, 1] : t < 0.85 ? [0.7, 0.85, 1] : [1, 0.88, 0.72];
      const b = r.range(0.35, 1);
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, opacity: 0.9 });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildSun() {
    this.sunGroup = new THREE.Group();
    // fiery granulation texture so the disc isn't flat
    const sunTex = canvasTexture(512, 512, (ctx, w, h) => {
      const r = new RNG(4242);
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, '#ffe9a8'); base.addColorStop(0.5, '#ffd27a'); base.addColorStop(1, '#ffb454');
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1500; i++) {
        const x = r.range(0, w), y = r.range(0, h), rad = r.range(3, 16);
        const hot = r.chance(0.4);
        const g = ctx.createRadialGradient(x, y, 0.5, x, y, rad);
        g.addColorStop(0, hot ? 'rgba(255,250,225,0.8)' : 'rgba(255,120,40,0.55)');
        g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
      }
      for (let i = 0; i < 9; i++) { // sunspots
        const x = r.range(0, w), y = r.range(h * 0.25, h * 0.75), rad = r.range(7, 18);
        ctx.fillStyle = 'rgba(160,70,20,0.7)';
        ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(90,35,10,0.8)';
        ctx.beginPath(); ctx.arc(x, y, rad * 0.55, 0, TAU); ctx.fill();
      }
    });
    const mat = new THREE.MeshBasicMaterial({ map: sunTex, fog: false });
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 48, 48), mat);
    this.sunGroup.add(this.sunMesh);
    // glow sprite
    const glowTex = canvasTexture(256, 256, (ctx) => {
      const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,246,220,1)');
      g.addColorStop(0.25, 'rgba(255,220,150,0.85)');
      g.addColorStop(0.6, 'rgba(255,170,80,0.25)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    });
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.sunGlow.scale.set(SUN_R * 6, SUN_R * 6, 1);
    this.sunGroup.add(this.sunGlow);
    // horizontal lens-flare streak
    const flareTex = canvasTexture(256, 64, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,200,130,0)');
      g.addColorStop(0.5, 'rgba(255,225,170,0.85)');
      g.addColorStop(1, 'rgba(255,200,130,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    this.sunFlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.7 }));
    this.sunFlare.scale.set(SUN_R * 6, SUN_R * 1.1, 1);
    this.sunGroup.add(this.sunFlare);
    this.scene.add(this.sunGroup);
  }

  buildSystem() {
    // Sun stays fixed at origin. Planet orbits it; moon orbits the planet.
    this.orbitGroup = new THREE.Group();   // rotates = planet year-orbit
    this.scene.add(this.orbitGroup);
    this.pivot = new THREE.Group();        // planet center
    this.pivot.position.set(ORBIT_DIST, 0, 0);
    this.orbitGroup.add(this.pivot);
    this.spin = new THREE.Group();         // rotating surface frame
    this.spin.rotation.z = 0.21;           // axial tilt → seasons
    this.pivot.add(this.spin);
    this.moonOrbit = new THREE.Group();    // moon revolution (in pivot frame)
    this.moonOrbit.rotation.x = 0.09;
    this.pivot.add(this.moonOrbit);
  }

  buildTerrain() {
    const W = 288, H = 288;
    const geo = new THREE.SphereGeometry(PLANET_R, W, H);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const s = {};
    const col = [0, 0, 0];
    this.basePositions = new Float32Array(pos.count * 3);
    this.baseDirs = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      this.baseDirs.set([v.x, v.y, v.z], i * 3);
      this.planet.sample(v.x, v.y, v.z, s);
      const rad = this.planet.heightRadius(s.elevation);
      this.basePositions.set([v.x * rad, v.y * rad, v.z * rad], i * 3);
      pos.setXYZ(i, v.x * rad, v.y * rad, v.z * rad);
      this.planet.colorAt(v.x, v.y, v.z, s, col);
      colors.set(col, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.spin.add(this.terrainMesh);
    this.terrainDirty = false;
    this.terrainRecolorTimer = 0;
  }

  // Re-apply bumps/paints to terrain geometry (throttled by caller).
  refreshTerrain() {
    const geo = this.terrainMesh.geometry;
    const pos = geo.attributes.position;
    const colAttr = geo.attributes.color;
    const s = {};
    const col = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = this.baseDirs[i * 3], y = this.baseDirs[i * 3 + 1], z = this.baseDirs[i * 3 + 2];
      this.planet.sample(x, y, z, s);
      const rad = this.planet.heightRadius(s.elevation);
      pos.setXYZ(i, x * rad, y * rad, z * rad);
      this.planet.colorAt(x, y, z, s, col);
      colAttr.setXYZ(i, col[0], col[1], col[2]);
    }
    pos.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }

  buildOcean() {
    const geo = new THREE.SphereGeometry(PLANET_R + 0.10 * PS, 160, 160);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uCamPos: { value: new THREE.Vector3() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.oceanUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vN; varying vec3 vW; varying vec3 vL;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position,1.0);
          vW = w.xyz; vL = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uCamPos;
        varying vec3 vN; varying vec3 vW; varying vec3 vL;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(uCamPos - vW);
          // animated wave normal perturbation
          float w1 = sin(vL.x*90.0 + uTime*1.4) * sin(vL.y*80.0 - uTime*1.1) * sin(vL.z*95.0 + uTime*0.9);
          float w2 = sin(vL.x*160.0 - uTime*2.2) * sin(vL.z*140.0 + uTime*1.7);
          N = normalize(N + vec3(w1*0.045 + w2*0.02));
          float fres = pow(1.0 - max(dot(N,V),0.0), 2.2);
          vec3 deep = vec3(0.02,0.22,0.62);
          vec3 shal = vec3(0.16,0.52,0.82);
          vec3 col = mix(deep, shal, fres*0.85 + 0.08);
          // sun specular glint
          vec3 R = reflect(-normalize(uSunDir), N);
          float spec = pow(max(dot(R,V),0.0), 240.0) * 2.4 + pow(max(dot(R,V),0.0), 36.0)*0.35;
          float day = clamp(dot(normalize(vN), normalize(uSunDir))*1.4+0.25, 0.0, 1.0);
          col = col*(0.12+0.88*day) + vec3(1.0,0.95,0.85)*spec*day;
          // polar ice blend handled by terrain; add subtle foam sparkle
          float alpha = mix(0.82, 0.97, fres);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.oceanMesh = new THREE.Mesh(geo, mat);
    this.oceanMesh.renderOrder = 2;
    this.spin.add(this.oceanMesh);
  }

  makeCloudTexture(seed, coverage) {
    const r = new RNG(seed);
    return canvasTexture(1024, 512, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // latitude bands (more clouds at equator + storm tracks)
      for (let i = 0; i < 900; i++) {
        const y = r.next();
        const band = Math.exp(-Math.pow((y - 0.5) / 0.16, 2)) * 0.7
          + Math.exp(-Math.pow((y - 0.28) / 0.1, 2)) * 0.5
          + Math.exp(-Math.pow((y - 0.72) / 0.1, 2)) * 0.5;
        if (r.next() > band * coverage + 0.08) continue;
        const x = r.next() * w, yy = y * h;
        const rad = r.range(8, 42);
        const g = ctx.createRadialGradient(x, yy, 1, x, yy, rad);
        const a = r.range(0.10, 0.5);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, yy, rad, 0, TAU); ctx.fill();
        // wrap horizontally for seamlessness
        if (x < rad) { ctx.beginPath(); ctx.arc(x + w, yy, rad, 0, TAU); ctx.fill(); }
        if (x > w - rad) { ctx.beginPath(); ctx.arc(x - w, yy, rad, 0, TAU); ctx.fill(); }
      }
    });
  }

  buildClouds() {
    const g1 = new THREE.SphereGeometry(PLANET_R * 1.022, 96, 96);
    const m1 = new THREE.MeshLambertMaterial({ map: this.makeCloudTexture(777, 1.0), transparent: true, opacity: 0.85, depthWrite: false });
    this.clouds1 = new THREE.Mesh(g1, m1);
    this.clouds1.renderOrder = 3;
    this.pivot.add(this.clouds1);
    const g2 = new THREE.SphereGeometry(PLANET_R * 1.035, 64, 64);
    const m2 = new THREE.MeshLambertMaterial({ map: this.makeCloudTexture(4242, 0.7), transparent: true, opacity: 0.5, depthWrite: false });
    this.clouds2 = new THREE.Mesh(g2, m2);
    this.clouds2.renderOrder = 4;
    this.pivot.add(this.clouds2);
  }

  buildAtmosphere() {
    const geo = new THREE.SphereGeometry(PLANET_R * 1.06, 64, 64);
    this.atmoUniforms = { uSunDir: { value: new THREE.Vector3(1, 0, 0) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(clamp(1.0 + dot(normalize(vN), V), 0.0, 1.0), 3.2);
          float day = clamp(dot(normalize(-vN), normalize(uSunDir))*1.6+0.2, 0.0, 1.0);
          // sunset tint near terminator
          float term = 1.0 - abs(dot(normalize(-vN), normalize(uSunDir)));
          float band = pow(term, 6.0);
          vec3 col = mix(vec3(0.25,0.5,1.0), vec3(1.0,0.45,0.2), band*0.9);
          gl_FragColor = vec4(col * rim * (0.15 + 0.85*day), rim * (0.25+0.75*day));
        }`,
    });
    this.atmo = new THREE.Mesh(geo, mat);
    this.atmo.renderOrder = 5;
    this.pivot.add(this.atmo);
    // inner haze shell (front side, very subtle)
    const haze = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_R * 1.012, 64, 64),
      new THREE.ShaderMaterial({
        uniforms: this.atmoUniforms,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uSunDir; varying vec3 vN;
          void main(){ float d = clamp(dot(normalize(vN), normalize(uSunDir)),0.0,1.0);
          gl_FragColor = vec4(vec3(0.35,0.55,0.9)*d*0.10, 0.10*d); }`,
      })
    );
    haze.renderOrder = 1;
    this.pivot.add(haze);
  }

  buildMoon() {
    const tex = canvasTexture(1024, 512, (ctx, w, h) => {
      const r = new RNG(9001);
      ctx.fillStyle = '#9a9a9c'; ctx.fillRect(0, 0, w, h);
      // maria (dark patches)
      for (let i = 0; i < 18; i++) {
        const x = r.range(0, w), y = r.range(h * 0.2, h * 0.8), rad = r.range(20, 70);
        const g = ctx.createRadialGradient(x, y, 2, x, y, rad);
        g.addColorStop(0, 'rgba(70,70,74,0.55)'); g.addColorStop(1, 'rgba(70,70,74,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
      }
      // craters
      const raySpots = [];
      for (let i = 0; i < 950; i++) {
        const x = r.range(0, w), y = r.range(0, h), rad = r.range(1, 14) * (r.next() < 0.08 ? 2.4 : 1);
        if (rad > 22 && raySpots.length < 7) raySpots.push([x, y, rad]);
        ctx.fillStyle = 'rgba(60,60,64,0.5)';
        ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(210,210,215,0.45)';
        ctx.beginPath(); ctx.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(120,120,126,0.6)';
        ctx.beginPath(); ctx.arc(x, y, rad * 0.55, 0, TAU); ctx.fill();
      }
      // bright ray systems around the biggest impacts
      for (const [rx, ry] of raySpots) {
        const nRays = 9 + ((r.next() * 5) | 0);
        for (let k = 0; k < nRays; k++) {
          const a = (k / nRays) * TAU + r.range(-0.15, 0.15);
          const len = r.range(60, 200);
          const g2 = ctx.createLinearGradient(rx, ry, rx + Math.cos(a) * len, ry + Math.sin(a) * len);
          g2.addColorStop(0, 'rgba(235,235,240,0.5)');
          g2.addColorStop(1, 'rgba(235,235,240,0)');
          ctx.strokeStyle = g2;
          ctx.lineWidth = r.range(2, 5);
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx + Math.cos(a) * len, ry + Math.sin(a) * len);
          ctx.stroke();
        }
      }
      // speckle
      for (let i = 0; i < 6000; i++) {
        ctx.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(r.range(0, w), r.range(0, h), 1.5, 1.5);
      }
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.4, roughness: 1, metalness: 0 });
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 72, 72), mat);
    this.moonMesh.castShadow = true;
    this.moonMesh.receiveShadow = true;
    this.moonHolder = new THREE.Group();
    this.moonHolder.add(this.moonMesh);
    this.moonMesh.position.set(MOON_DIST, 0, 0);
    this.moonOrbit.add(this.moonHolder);
    // moon glow (subtle)
    const glowTex = canvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
      g.addColorStop(0, 'rgba(200,215,255,0.5)'); g.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    });
    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.moonGlow.scale.set(MOON_R * 3.4, MOON_R * 3.4, 1);
    this.moonMesh.add(this.moonGlow);
  }

  buildOrbitLines() {
    const mk = (radius, color, opacity) => {
      const pts = [];
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * TAU;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, fog: false, depthWrite: false }));
      l.frustumCulled = false;
      return l;
    };
    this.moonOrbitLine = mk(MOON_DIST, 0x8fb4ff, 0.35);
    this.moonOrbit.add(this.moonOrbitLine);
    this.planetOrbitLine = mk(ORBIT_DIST, 0xffd27f, 0.22);
    this.scene.add(this.planetOrbitLine);
  }

  setOrbitLinesVisible(v) {
    this.showOrbits = v;
    this.moonOrbitLine.visible = v;
    this.planetOrbitLine.visible = v;
  }

  buildComet() {
    // eccentric visitor; mostly far away, occasionally swings by
    this.cometGroup = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(5 * PS, 12, 12), new THREE.MeshBasicMaterial({ color: 0xeaf6ff, fog: false }));
    this.cometGroup.add(head);
    const tailTex = canvasTexture(128, 128, (ctx) => {
      const g = ctx.createLinearGradient(0, 64, 128, 64);
      g.addColorStop(0, 'rgba(180,220,255,0.9)'); g.addColorStop(1, 'rgba(180,220,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 40, 128, 48);
    });
    this.cometTail = new THREE.Sprite(new THREE.SpriteMaterial({ map: tailTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.cometTail.scale.set(360 * PS, 64 * PS, 1);
    this.cometTail.position.set(-180 * PS, 0, 0);
    this.cometGroup.add(this.cometTail);
    this.cometGroup.visible = false;
    this.scene.add(this.cometGroup);
    this.cometT = -1; // inactive
  }

  fireComet() { this.cometT = 0; }

  planetWorldPos(out) { return this.pivot.getWorldPosition(out || new THREE.Vector3()); }
  moonWorldPos(out) { return this.moonMesh.getWorldPosition(out || new THREE.Vector3()); }

  update(dtReal, warp, world, camera) {
    const dt = dtReal * warp;
    this.time += dtReal;
    // rotations (planet spins even at high warp; clamp visual rate so it stays smooth)
    const spinRate = (TAU / ROTATION_SECONDS);
    this.spinAngle = (this.spinAngle + spinRate * dt) % TAU;
    this.spin.rotation.y = this.spinAngle;
    this.cloudAngle = (this.cloudAngle + spinRate * 1.18 * dt) % TAU;
    this.clouds1.rotation.y = this.cloudAngle;
    this.cloudAngle2 = (this.cloudAngle2 + spinRate * 0.86 * dt) % TAU;
    this.clouds2.rotation.y = this.cloudAngle2;
    this.moonAngle = (this.moonAngle + (TAU / MOON_PERIOD) * dt) % TAU;
    this.moonHolder.rotation.y = this.moonAngle;
    this.orbitAngle = (this.orbitAngle + (TAU / ORBIT_PERIOD) * dt) % TAU;
    this.orbitGroup.rotation.y = this.orbitAngle;

    // tidal lock: same lunar face toward planet
    const pp = this.planetWorldPos(PlanetView._v1);
    this.moonMesh.lookAt(pp);

    // sunlight follows planet
    const sunPos = PlanetView._v2.set(0, 0, 0);
    const toSun = PlanetView._v3.copy(sunPos).sub(pp).normalize();
    this.sunLight.position.copy(pp).addScaledVector(toSun, 3000);
    this.sunLight.target.position.copy(pp);
    // moonlight: dim blue from moon direction
    const mp = this.moonWorldPos(PlanetView._v4);
    const toMoon = PlanetView._v5.copy(mp).sub(pp).normalize();
    this.moonLight.position.copy(pp).addScaledVector(toMoon, 1500);
    this.moonLight.target.position.copy(pp);
    const nightSide = clamp(-toSun.y * 0 + 0.5, 0, 1);
    this.moonLight.intensity = 0.10 + 0.06 * nightSide;

    // eclipse detection (angular alignment)
    const moonDir = PlanetView._v6.copy(mp).sub(pp).normalize();
    const sunDir = PlanetView._v7.copy(sunPos).sub(pp).normalize();
    const align = moonDir.dot(sunDir); // ~1 → moon sunward; ~-1 → antisunward
    let newEclipse = null;
    if (align > 0.99955) newEclipse = 'solar';
    else if (align < -0.99955) newEclipse = 'lunar';
    if (newEclipse !== this.eclipse) {
      this.eclipse = newEclipse;
      if (newEclipse && world) world.onEclipse(newEclipse);
    }
    const targetDim = this.eclipse === 'solar' ? 0.12 : 1;
    this.sunDim += (targetDim - this.sunDim) * Math.min(1, dtReal * 1.5);
    this.sunLight.intensity = 3.2 * this.sunDim;
    // blood moon during lunar eclipse
    const targetRed = this.eclipse === 'lunar' ? 1 : 0;
    this.eclipseMix += (targetRed - this.eclipseMix) * Math.min(1, dtReal * 1.5);
    this.moonMesh.material.color.setRGB(1, 1 - 0.55 * this.eclipseMix, 1 - 0.62 * this.eclipseMix);

    // shader uniforms
    this.oceanUniforms.uTime.value = this.time;
    this.oceanUniforms.uSunDir.value.copy(sunDir);
    this.oceanUniforms.uCamPos.value.copy(camera.position);
    this.atmoUniforms.uSunDir.value.copy(sunDir);

    // shadows only matter near the surface
    const camDist = camera.position.distanceTo(pp);
    this.sunLight.castShadow = camDist < 900 * PS;

    // fog color follows day/night at camera focus
    const focusDir = PlanetView._v8.copy(camera.position).sub(pp).normalize();
    const elev = focusDir.dot(sunDir);
    const dayMix = clamp(elev * 2.2 + 0.45, 0, 1);
    this.scene.fog.color.setRGB(0.04 + 0.35 * dayMix, 0.06 + 0.42 * dayMix, 0.12 + 0.50 * dayMix);
    this.scene.fog.density = 0.0011 / PS;

    // living sun: breathing glow, drifting flare, slow surface turn
    const puls = 1 + 0.025 * Math.sin(this.time * 2.1) + 0.018 * Math.sin(this.time * 3.7);
    this.sunGlow.scale.set(SUN_R * 6 * puls, SUN_R * 6 * puls, 1);
    this.sunFlare.material.rotation += dtReal * 0.05;
    this.sunMesh.rotation.y += dtReal * 0.012;

    // comet flyby
    if (this.cometT >= 0) {
      this.cometT += dtReal * Math.min(warp, 10);
      const T = 90; // seconds
      if (this.cometT > T) { this.cometT = -1; this.cometGroup.visible = false; }
      else {
        this.cometGroup.visible = true;
        const k = this.cometT / T; // 0→1
        const a = Math.PI * (0.15 + k * 0.9);
        const rad = ORBIT_DIST * (1.15 - 0.5 * Math.sin(k * Math.PI));
        this.cometGroup.position.set(Math.cos(a + this.orbitAngle) * rad, 260 * PS * Math.sin(k * Math.PI), Math.sin(a + this.orbitAngle) * rad);
        // tail points away from sun
        this.cometTail.material.opacity = Math.sin(k * Math.PI);
      }
    }

    // deferred terrain refresh (god powers)
    if (this.terrainDirty) {
      this.terrainRecolorTimer -= dtReal;
      if (this.terrainRecolorTimer <= 0) {
        this.terrainDirty = false;
        this.refreshTerrain();
      }
    }
    return { sunDir, planetPos: pp, moonPos: mp, camDist };
  }

  markTerrainDirty() { this.terrainDirty = true; this.terrainRecolorTimer = 0.25; }

  // global day-cycle phase 0..1 + label (prime meridian reference)
  dayPhase() {
    // spinAngle 0 chosen so phase 0.25 ≈ noon at lon 0 facing sun start; purely cyclic
    const t = ((this.spinAngle / TAU) % 1 + 1) % 1;
    return t;
  }

  static phaseName(t) {
    if (t < 0.06 || t >= 0.97) return 'Sunrise';
    if (t < 0.20) return 'Morning';
    if (t < 0.30) return 'Noon';
    if (t < 0.44) return 'Afternoon';
    if (t < 0.53) return 'Sunset';
    if (t < 0.60) return 'Twilight';
    if (t < 0.72) return 'Nightfall';
    if (t < 0.88) return 'Midnight';
    return 'Late Night';
  }

  moonPhaseName() {
    // angle of moon relative to sun as seen from planet
    const pp = this.planetWorldPos(PlanetView._v1);
    const mp = this.moonWorldPos(PlanetView._v4);
    const md = PlanetView._v6.copy(mp).sub(pp).normalize();
    const sd = PlanetView._v7.set(0, 0, 0).sub(pp).normalize();
    const align = md.dot(sd);
    // waxing/waning via cross product y
    const cross = md.clone().cross(sd).y;
    const waxing = cross < 0;
    if (align > 0.92) return 'New Moon';
    if (align > 0.38) return waxing ? 'Waxing Crescent' : 'Waning Crescent';
    if (align > -0.38) return waxing ? 'First Quarter' : 'Last Quarter';
    if (align > -0.92) return waxing ? 'Waxing Gibbous' : 'Waning Gibbous';
    return 'Full Moon';
  }
}
PlanetView._v1 = new THREE.Vector3();
PlanetView._v2 = new THREE.Vector3();
PlanetView._v3 = new THREE.Vector3();
PlanetView._v4 = new THREE.Vector3();
PlanetView._v5 = new THREE.Vector3();
PlanetView._v6 = new THREE.Vector3();
PlanetView._v7 = new THREE.Vector3();
PlanetView._v8 = new THREE.Vector3();
