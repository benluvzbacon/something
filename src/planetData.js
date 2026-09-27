// ---------------------------------------------------------------------------
// planetData.js — procedural planet model: continents, mountains, climate,
// biomes. Pure math (no three.js) so the simulation + smoke test can run
// headless in Node.
// ---------------------------------------------------------------------------
import { RNG, Simplex, fbm, ridged, clamp, lerp, smoothstep, TAU } from './noise.js';

export const PLANET_R = 300;
// World-size multiplier vs. the original 100-unit planet. All surface-attached
// model sizes (buildings, creatures, effects…) scale by this.
export const WORLD_SCALE = PLANET_R / 100;

// Biome ids
export const B = {
  DEEP: 0, OCEAN: 1, SHALLOW: 2, LAKE: 3, BEACH: 4, ICE: 5,
  TUNDRA: 6, MOUNTAIN: 7, SNOW: 8, DESERT: 9, SAVANNA: 10,
  GRASS: 11, FOREST: 12, JUNGLE: 13, ROCK: 14,
};

export const BIOME_INFO = [
  /* 0 DEEP    */ { name: 'Deep Ocean',  color: [0.023, 0.10, 0.25],  ocean: true },
  /* 1 OCEAN   */ { name: 'Ocean',       color: [0.05, 0.20, 0.42],   ocean: true },
  /* 2 SHALLOW */ { name: 'Shallow Sea', color: [0.30, 0.55, 0.60],   ocean: true },
  /* 3 LAKE    */ { name: 'Lake',        color: [0.10, 0.28, 0.38],   ocean: true, fresh: true },
  /* 4 BEACH   */ { name: 'Beach',       color: [0.85, 0.75, 0.55] },
  /* 5 ICE     */ { name: 'Polar Ice',   color: [0.87, 0.92, 0.96] },
  /* 6 TUNDRA  */ { name: 'Tundra',      color: [0.52, 0.55, 0.46] },
  /* 7 MOUNTAIN*/ { name: 'Mountains',   color: [0.40, 0.36, 0.33] },
  /* 8 SNOW    */ { name: 'Snow Peak',    color: [0.90, 0.93, 0.96] },
  /* 9 DESERT  */ { name: 'Desert',      color: [0.84, 0.66, 0.40] },
  /* 10 SAVANNA*/ { name: 'Savanna',     color: [0.62, 0.60, 0.36] },
  /* 11 GRASS  */ { name: 'Grassland',   color: [0.33, 0.56, 0.26] },
  /* 12 FOREST */ { name: 'Forest',      color: [0.14, 0.40, 0.18] },
  /* 13 JUNGLE */ { name: 'Jungle',      color: [0.06, 0.33, 0.14] },
  /* 14 ROCK   */ { name: 'Highlands',   color: [0.48, 0.43, 0.38] },
];

export function isOceanBiome(b) { return b <= B.LAKE; }
export function isLandBiome(b) { return b > B.LAKE; }

export class PlanetData {
  constructor(seed) {
    this.seed = seed >>> 0;
    const R = (s) => new RNG((this.seed ^ s) >>> 0);
    this.sCont = new Simplex(R(0x11a3));   // continents (low freq structure)
    this.sClus = new Simplex(R(0x22b7));   // super-continent clustering
    this.sMtnM = new Simplex(R(0x33c1));   // mountain-range mask
    this.sMtn = new Simplex(R(0x44d9));    // ridged mountains
    this.sDet = new Simplex(R(0x55e2));    // fine detail
    this.sTmp = new Simplex(R(0x66f4));    // temperature variation
    this.sPre = new Simplex(R(0x770b));    // precipitation
    this.sVar = new Simplex(R(0x881d));    // color variation
    const ro = new RNG((this.seed ^ 0x99aa) >>> 0);
    this.ox = ro.range(-90, 90); this.oy = ro.range(-90, 90); this.oz = ro.range(-90, 90);
    // God-power terrain bumps: {x,y,z (unit dir), radiusRad, amount}
    this.bumps = [];
    // Paint overlays (forest growth, scorch, deforestation): {x,y,z,radiusRad,r,g,b,strength}
    this.paints = [];
  }

  dirFromLatLon(lat, lon, out) {
    const c = Math.cos(lat);
    out = out || {};
    out.x = c * Math.sin(lon);
    out.y = Math.sin(lat);
    out.z = c * Math.cos(lon);
    return out;
  }

  latLonFromDir(d) {
    return { lat: Math.asin(clamp(d.y, -1, 1)), lon: Math.atan2(d.x, d.z) };
  }

  addBump(dir, radiusRad, amount) {
    this.bumps.push({ x: dir.x, y: dir.y, z: dir.z, r: radiusRad, a: amount });
    if (this.bumps.length > 60) this.bumps.shift();
  }

  addPaint(dir, radiusRad, r, g, b, strength) {
    this.paints.push({ x: dir.x, y: dir.y, z: dir.z, r: radiusRad, cr: r, cg: g, cb: b, s: strength });
    if (this.paints.length > 240) this.paints.shift();
  }

  bumpAt(x, y, z) {
    let s = 0;
    for (let i = 0; i < this.bumps.length; i++) {
      const b = this.bumps[i];
      const dot = clamp(x * b.x + y * b.y + z * b.z, -1, 1);
      const ang = Math.acos(dot);
      if (ang < b.r) {
        const f = 1 + Math.cos((ang / b.r) * Math.PI);
        s += b.a * 0.5 * f;
      }
    }
    return s;
  }

  // Core field sampling. d must be normalized. Returns `out`.
  sample(x, y, z, out) {
    out = out || {};
    const lat = Math.asin(clamp(y, -1, 1));
    const p = Math.abs(lat) / (Math.PI / 2); // 0 equator → 1 pole

    // --- Elevation: clustered continents + ridged ranges + detail ---------
    const X = x + this.ox, Y = y + this.oy, Z = z + this.oz;
    const cluster = fbm(this.sClus, X * 0.7, Y * 0.7, Z * 0.7, 3);
    let e = fbm(this.sCont, X * 1.55, Y * 1.55, Z * 1.55, 5) * 1.02
      + cluster * 0.34 - 0.055;
    // Mountain ranges where mask is high and land is rising
    const mMask = smoothstep(0.02, 0.42, fbm(this.sMtnM, X * 2.1, Y * 2.1, Z * 2.1, 3)) * smoothstep(-0.10, 0.28, e);
    const r = ridged(this.sMtn, X * 4.6, Y * 4.6, Z * 4.6, 4);
    e += mMask * r * r * 1.05;
    e += fbm(this.sDet, X * 9.0, Y * 9.0, Z * 9.0, 2) * 0.045;
    if (this.bumps.length) e += this.bumpAt(x, y, z);

    // --- Temperature ------------------------------------------------------
    let t = Math.pow(Math.max(0, Math.cos(lat)), 1.18)
      - Math.max(0, e) * 0.24
      + fbm(this.sTmp, X * 2.6, Y * 2.6, Z * 2.6, 3) * 0.075;
    t = clamp(t, 0, 1);

    // --- Precipitation (latitude bands + noise + ocean proximity) ----------
    let pr = 0.40
      + 0.36 * Math.exp(-Math.pow(p / 0.17, 2))        // equatorial wet belt
      - 0.24 * Math.exp(-Math.pow((p - 0.34) / 0.13, 2)) // subtropical dry belt
      + 0.20 * Math.exp(-Math.pow((p - 0.62) / 0.17, 2)); // temperate wet
    pr += fbm(this.sPre, X * 3.1, Y * 3.1, Z * 3.1, 4) * 0.40;
    if (e < 0.05) pr += 0.07;                            // maritime moisture
    pr -= mMask * r * 0.10;                               // rain shadow
    pr = clamp(pr, 0, 1);

    // --- Biome ------------------------------------------------------------
    let bi;
    if (e < 0) {
      if (t < 0.10) bi = B.ICE;                            // sea ice
      else if (e < -0.42) bi = B.DEEP;
      else if (e < -0.10) bi = B.OCEAN;
      else bi = B.SHALLOW;
    } else {
      // Lakes: low flat wet land
      if (e < 0.055 && pr > 0.62 && t > 0.12) bi = B.LAKE;
      else if (t < 0.09) bi = B.ICE;                       // ice caps
      else if (e < 0.030 && t > 0.16) bi = B.BEACH;
      else if (e > 0.72) bi = t < 0.34 ? B.SNOW : (pr < 0.3 ? B.ROCK : B.MOUNTAIN);
      else if (e > 0.52 && mMask > 0.35) bi = t < 0.3 ? B.SNOW : B.MOUNTAIN;
      else if (t < 0.20) bi = B.TUNDRA;
      else if (t > 0.52 && pr < 0.27) bi = B.DESERT;
      else if (t > 0.60 && pr > 0.56) bi = B.JUNGLE;
      else if (pr > 0.46) bi = B.FOREST;
      else if (pr > 0.30) bi = (t > 0.5 ? B.SAVANNA : B.GRASS);
      else bi = (t > 0.45 ? B.SAVANNA : B.GRASS);
      if (bi === B.GRASS && e > 0.45 && pr < 0.34) bi = B.ROCK;
    }

    out.elevation = e;
    out.temperature = t;
    out.precip = pr;
    out.biome = bi;
    out.polar = p;
    out.lat = lat;
    out.ocean = e < 0;
    return out;
  }

  // Seasonal temperature offset: orbitAngle 0..TAU, tilt response by hemisphere
  seasonalTemp(baseT, lat, orbitAngle) {
    return clamp(baseT + Math.sin(lat) * Math.sin(orbitAngle) * 0.09, 0, 1);
  }

  heightRadius(e) {
    const S = WORLD_SCALE;
    if (e <= 0) return PLANET_R + Math.max(e, -1.2) * 4.0 * S - 0.30 * S;
    return PLANET_R + e * 8.0 * S + 0.14 * S;
  }

  // Base surface color (linear 0..1) with natural variation + god-power paints
  colorAt(x, y, z, s, out) {
    out = out || [0, 0, 0];
    const info = BIOME_INFO[s.biome];
    const v = fbm(this.sVar, (x + this.ox) * 14.0, (y + this.oy) * 14.0, (z + this.oz) * 14.0, 2) * 0.5 + 0.5;
    const m = 0.90 + v * 0.20;
    let r = info.color[0] * m, g = info.color[1] * m, b = info.color[2] * m;
    // Slope rock blending on steep high land
    if (s.elevation > 0.42 && s.biome !== B.SNOW && s.biome !== B.ICE) {
      const k = smoothstep(0.42, 0.68, s.elevation) * 0.55;
      r = lerp(r, 0.44, k); g = lerp(g, 0.40, k); b = lerp(b, 0.36, k);
    }
    // vivid stylized grade (reference look): boost saturation
    const avg = (r + g + b) / 3;
    r = clamp(avg + (r - avg) * 1.28, 0, 1);
    g = clamp(avg + (g - avg) * 1.28, 0, 1);
    b = clamp(avg + (b - avg) * 1.28, 0, 1);
    // Paint overlays
    for (let i = 0; i < this.paints.length; i++) {
      const pt = this.paints[i];
      const dot = clamp(x * pt.x + y * pt.y + z * pt.z, -1, 1);
      const ang = Math.acos(dot);
      if (ang < pt.r) {
        const f = (1 + Math.cos((ang / pt.r) * Math.PI)) * 0.5 * pt.s;
        r = lerp(r, pt.cr, clamp(f, 0, 1));
        g = lerp(g, pt.cg, clamp(f, 0, 1));
        b = lerp(b, pt.cb, clamp(f, 0, 1));
      }
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }
}
