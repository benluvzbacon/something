// ---------------------------------------------------------------------------
// ui.js — HUD: top bar, speed controls, god-power toolbar, inspector tabs,
// nations, world stats, event log, annals, minimap, labels, toasts.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { TAU, clamp } from './noise.js';
import { ERAS, SPACE_STAGES, fmtPop, B, BIOME_INFO, PLANET_R, WORLD_SCALE, ROTATION_SECONDS } from './world.js';

export const GOD_POWERS = [
  { id: 'inspect', icon: '🔍', name: 'Inspect', hint: 'Click anything to inspect it' },
  { id: 'forest', icon: '🌲', name: 'Grow Forest', hint: 'Click land to grow lush forests' },
  { id: 'mountain', icon: '⛰️', name: 'Raise Land', hint: 'Click to raise mountains / new land' },
  { id: 'valley', icon: '🕳️', name: 'Lower Land', hint: 'Click to sink land beneath the sea' },
  { id: 'lake', icon: '💧', name: 'Create Lake', hint: 'Click land to form a lake' },
  { id: 'life', icon: '🦌', name: 'Spawn Wildlife', hint: 'Click to breathe life into the wilds' },
  { id: 'rain', icon: '🌧️', name: 'Blessed Rain', hint: 'Click to summon gentle nourishing rain' },
  { id: 'storm', icon: '⛈️', name: 'Great Storm', hint: 'Click to hurl a thunderstorm' },
  { id: 'fire', icon: '🔥', name: 'Wildfire', hint: 'Click to ignite raging wildfires' },
  { id: 'quake', icon: '🌊', name: 'Earthquake', hint: 'Click to shake the earth (tsunamis at sea)' },
  { id: 'volcano', icon: '🌋', name: 'Volcano', hint: 'Click to erupt a volcano' },
  { id: 'meteor', icon: '☄️', name: 'Meteor Strike', hint: 'Click to call down a meteor' },
  { id: 'bless', icon: '✨', name: 'Bless Nation', hint: 'Click a city to bless its nation' },
  { id: 'smite', icon: '💀', name: 'Smite', hint: 'Click to annihilate whatever stands there' },
];

const KIND_COLOR = {
  info: '#9fb3c8', civ: '#7dd3fc', era: '#ffb454', war: '#ff6b6b',
  disaster: '#ff9f43', space: '#c792ff', astro: '#a3bffa', god: '#ffe27a',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.tab = 'inspect';
    this.annalsFilter = 'all';
    this.showLabels = true;
    this.showTerr3D = true;
    this.trackLaunches = true;
    this.labelPool = [];
    this.accSlow = 0;
    this.accMed = 0;
    this.build();
    this.buildMinimapBase();
  }

  el(sel) { return document.querySelector(sel); }

  build() {
    const ui = this.el('#ui');
    ui.innerHTML = `
      <div class="topbar glass">
        <div class="brand"><span class="brand-mark">◉</span><div><div class="brand-name">TERRASIM</div><div class="brand-seed">seed ${this.game.seed}</div></div></div>
        <div class="timebox">
          <div class="phase" id="phase"><span id="phase-icon">☀️</span><span id="phase-name">Morning</span></div>
          <div class="yearbox"><span id="year">Year 1</span><span id="day" class="dim">Day 1</span></div>
          <div class="erabox"><span class="dim">Leading era</span><span id="era">Stone Age</span></div>
          <div class="astrobox"><span id="moon-phase" title="Lunar phase">🌙 New Moon</span><span id="eclipse-warn" class="eclipse hidden">ECLIPSE</span></div>
        </div>
        <div class="speedbox">
          <button id="btn-pause" class="btn icon" title="Pause / resume [Space]">⏸</button>
          <input id="speed" type="range" min="0" max="10" step="1" value="6" title="Simulation speed" />
          <span id="speed-label" class="speed-label">10×</span>
        </div>
        <div class="statbox">
          <div class="stat"><span class="dim">👥</span><span id="st-pop">0</span></div>
          <div class="stat"><span class="dim">🏳️</span><span id="st-civ">0</span></div>
          <div class="stat"><span class="dim">🌙</span><span id="st-moon">0</span></div>
          <div class="stat"><span class="dim">🛰</span><span id="st-sat">0</span></div>
          <div class="stat fps"><span id="st-fps">60</span><span class="dim">fps</span></div>
        </div>
        <div class="menubtns">
          <button id="btn-track" class="btn toggle on" title="Auto-follow rocket launches">🚀</button>
          <button id="btn-orbits" class="btn toggle on" title="Show orbit paths">🪐</button>
          <button id="btn-labels" class="btn toggle on" title="Show city labels">🏷️</button>
          <button id="btn-new" class="btn" title="Generate a brand-new planet">🌍 New</button>
          <button id="btn-help" class="btn" title="Help & controls">?</button>
        </div>
      </div>

      <div class="daypill glass" id="daypill">☀️ Day</div>
      <div class="eventbanner hidden" id="eventbanner"></div>

      <div class="godbar glass" id="godbar"></div>

      <div class="cambar glass" id="cambar">
        <button data-cam="surface" title="Descend to the surface">🏘️ Surface</button>
        <button data-cam="nation" title="View the leading nation">🏳️ Nation</button>
        <button data-cam="planet" title="Planetary view">🌍 Planet</button>
        <button data-cam="moon" title="Visit the Moon">🌙 Moon</button>
        <button data-cam="system" title="Solar system view">☀️ System</button>
      </div>

      <div class="rightpanel glass">
        <div class="tabs">
          <button data-tab="inspect" class="on">Inspect</button>
          <button data-tab="nations">Nations</button>
          <button data-tab="world">World</button>
          <button data-tab="log">Log</button>
          <button data-tab="annals">Annals</button>
        </div>
        <div class="tabbody" id="tabbody"></div>
      </div>

      <div class="mapwrap glass">
        <canvas id="minimap" width="288" height="144"></canvas>
        <div class="maphint">click map to travel</div>
      </div>

      <div class="ticker" id="ticker"></div>
      <div class="toast" id="toast"></div>

      <div class="helpmodal hidden" id="helpmodal">
        <div class="help-card glass">
          <h2>How to play</h2>
          <div class="help-grid">
            <div><b>🖱️ Left-drag / Right-drag</b> orbit · <b>Wheel</b> zoom — the camera always faces the planet</div>
            <div><b>W A S D</b> orbit · <b>Q / E</b> zoom out / in · <b>Shift</b> fast</div>
            <div><b>Click</b> a city, nation or wilds to inspect · <b>Esc</b> deselect</div>
            <div><b>Space</b> pause · <b>1–9,0,-</b> speed presets</div>
            <div><b>God powers</b> (left bar): pick one, then click the planet</div>
            <div><b>Camera</b> (bottom bar): jump from streets to solar system</div>
          </div>
          <p class="dim">A full day lasts 20 minutes at 1×. Crank the speed to watch
          tribes become kingdoms, kingdoms become republics — and republics reach the Moon.</p>
          <button class="btn primary" id="btn-close-help">Begin observing</button>
        </div>
      </div>`;
    // god bar
    const gb = this.el('#godbar');
    gb.innerHTML = GOD_POWERS.map((p) =>
      `<button class="godbtn${p.id === 'inspect' ? ' on' : ''}" data-god="${p.id}" title="${p.name} — ${p.hint}">${p.icon}<span>${p.name}</span></button>`
    ).join('');
    gb.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.game.setGodPower(b.dataset.god);
      gb.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    }));

    // wiring
    this.el('#speed').addEventListener('input', (e) => this.game.setWarpIndex(parseInt(e.target.value, 10)));
    this.el('#btn-pause').addEventListener('click', () => this.game.togglePause());
    this.el('#cambar').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.game.gotoPreset(b.dataset.cam)));
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      this.renderTab(true);
    }));
    this.el('#btn-new').addEventListener('click', () => {
      if (confirm('Generate a brand-new planet? (current history will be lost)')) {
        const s = (Math.random() * 0xffffffff) >>> 0;
        location.search = `?seed=${s}`;
      }
    });
    this.el('#btn-help').addEventListener('click', () => this.el('#helpmodal').classList.remove('hidden'));
    this.el('#btn-close-help').addEventListener('click', () => this.el('#helpmodal').classList.add('hidden'));
    this.el('#btn-orbits').addEventListener('click', (e) => {
      const v = !this.game.planetView.showOrbits;
      this.game.planetView.setOrbitLinesVisible(v);
      e.currentTarget.classList.toggle('on', v);
    });
    this.el('#btn-labels').addEventListener('click', (e) => {
      this.showLabels = !this.showLabels;
      e.currentTarget.classList.toggle('on', this.showLabels);
    });
    this.el('#btn-track').addEventListener('click', (e) => {
      this.trackLaunches = !this.trackLaunches;
      e.currentTarget.classList.toggle('on', this.trackLaunches);
    });
    this.el('#minimap').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const lon = (u - 0.5) * TAU, lat = (0.5 - v) * Math.PI;
      this.game.focusLatLon(lat, lon);
    });
    this.mapBase = null;
    this.renderTab(true);
  }

  toast(msg, ms = 3400) {
    const t = this.el('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  // -- minimap ----------------------------------------------------------------------
  buildMinimapBase() {
    const W = 288, H = 144;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    const img = ctx.createImageData(W, H);
    const s = {}, col = [0, 0, 0], d = {};
    const planet = this.world.planet;
    for (let py = 0; py < H; py++) {
      const lat = (0.5 - (py + 0.5) / H) * Math.PI;
      for (let px = 0; px < W; px++) {
        const lon = ((px + 0.5) / W - 0.5) * TAU;
        planet.dirFromLatLon(lat, lon, d);
        planet.sample(d.x, d.y, d.z, s);
        planet.colorAt(d.x, d.y, d.z, s, col);
        const i = (py * W + px) * 4;
        img.data[i] = clamp(col[0], 0, 1) * 255;
        img.data[i + 1] = clamp(col[1], 0, 1) * 255;
        img.data[i + 2] = clamp(col[2], 0, 1) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.mapBase = off;
    this.drawMinimap();
  }

  drawMinimap() {
    if (!this.mapBase) return;
    const cv = this.el('#minimap');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.drawImage(this.mapBase, 0, 0);
    const xy = (lat, lon) => [(lon / TAU + 0.5) * W, (0.5 - lat / Math.PI) * H];
    // territory
    for (const cell of this.world.cells) {
      if (cell.owner === -1 || cell.ocean) continue;
      const civ = this.world.civs[cell.owner];
      if (!civ || !civ.alive) continue;
      const [x, y] = xy(cell.lat, cell.lon);
      ctx.fillStyle = civ.colorCss;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x - 1, y - 1, 2.4, 2.4);
    }
    ctx.globalAlpha = 1;
    // storms
    for (const st of this.world.storms) {
      const cell = this.world.cells[st.cell];
      const [x, y] = xy(cell.lat, cell.lon);
      ctx.strokeStyle = '#9fd8ff';
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, TAU); ctx.stroke();
    }
    // cities
    for (const city of this.world.cities) {
      const cell = this.world.cells[city.cell];
      const [x, y] = xy(cell.lat, cell.lon);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // selection
    const sel = this.game.selection;
    if (sel && sel.kind !== 'none' && sel.cell != null) {
      const cell = this.world.cells[sel.cell];
      if (cell) {
        const [x, y] = xy(cell.lat, cell.lon);
        ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
      }
    }
  }

  // -- tabs ---------------------------------------------------------------------------
  renderTab(force) {
    const body = this.el('#tabbody');
    if (this.tab === 'inspect') body.innerHTML = this.inspectHTML();
    else if (this.tab === 'nations') body.innerHTML = this.nationsHTML();
    else if (this.tab === 'world') body.innerHTML = this.worldHTML();
    else if (this.tab === 'log') body.innerHTML = this.logHTML();
    else if (this.tab === 'annals') body.innerHTML = this.annalsHTML();
    body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleAction(b.dataset.act, b.dataset.arg, b.dataset.arg2);
    }));
    body.querySelectorAll('[data-selciv]').forEach((b) => b.addEventListener('click', () => {
      this.game.selectCiv(parseInt(b.dataset.selciv, 10));
      this.switchTab('inspect');
    }));
    body.querySelectorAll('[data-selcity]').forEach((b) => b.addEventListener('click', () => {
      this.game.selectCity(parseInt(b.dataset.selcity, 10));
      this.switchTab('inspect');
    }));
    const filt = body.querySelector('#annals-filter');
    if (filt) filt.addEventListener('change', () => { this.annalsFilter = filt.value; this.renderTab(true); });
  }

  switchTab(t) {
    this.tab = t;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
    this.renderTab(true);
  }

  handleAction(act, arg, arg2) {
    const g = this.game;
    if (act === 'goto-city') g.gotoCity(parseInt(arg, 10));
    else if (act === 'follow-city') g.followCity(parseInt(arg, 10));
    else if (act === 'follow-civ') g.followCiv(parseInt(arg, 10));
    else if (act === 'goto-civ') g.gotoCiv(parseInt(arg, 10));
    else if (act === 'bless') { g.world.godBless(parseInt(arg, 10)); this.renderTab(true); }
    else if (act === 'locate') g.locateCell(parseInt(arg, 10));
    else if (act === 'goto-moon') g.gotoPreset('moon');
    else if (act === 'follow-moon') g.setFollow({ kind: 'moon' });
    else if (act === 'follow-sun') g.setFollow({ kind: 'sun' });
    else if (act === 'follow-person') g.followPersonIn(parseInt(arg, 10), parseInt(arg2, 10));
    else if (act === 'unfollow') g.setFollow(null);
  }

  bar(frac, color) {
    return `<div class="bar"><div style="width:${clamp(frac * 100, 0, 100).toFixed(1)}%;background:${color}"></div></div>`;
  }

  inspectHTML() {
    const sel = this.game.selection;
    if (!sel || sel.kind === 'none') {
      const lead = this.world.leaderCiv();
      return `<div class="empty">Click a <b>city</b>, <b>nation banner</b>, or the <b>wilds</b> to inspect.<br/><br/>
      ${lead ? `Right now, <b style="color:${lead.colorCss}">${this.world.fullCivName(lead)}</b> is the largest power on the planet.` : ''}
      <br/><br/><span class="dim">Tip: zoom close to a city to see its people going about their lives.</span></div>`;
    }
    if (sel.kind === 'city') return this.cityHTML(this.world.cityById(sel.city));
    if (sel.kind === 'civ') return this.civHTML(this.world.civs[sel.civ]);
    if (sel.kind === 'cell') return this.cellHTML(sel.cell);
    if (sel.kind === 'person') return this.personHTML(sel.person);
    if (sel.kind === 'moon') return this.moonHTML();
    if (sel.kind === 'sun') return this.sunHTML();
    return '';
  }

  cityHTML(city) {
    if (!city) return '<div class="empty">City no longer exists.</div>';
    const civ = this.world.civs[city.civ];
    const cell = this.world.cells[city.cell];
    const era = ERAS[civ ? civ.era : 0];
    const g = this.game;
    const residents = g.sampleResidents(city, 3);
    return `
      <h3>🏘️ ${city.name} ${civ && city.id === civ.capital ? '<span class="chip">capital</span>' : ''}</h3>
      <div class="row"><span class="dim">Nation</span><button class="link" data-selciv="${city.civ}" style="color:${civ.colorCss}">${civ ? this.world.fullCivName(civ) : '—'}</button></div>
      <div class="row"><span class="dim">Population</span><b>${fmtPop(city.pop)}</b></div>
      <div class="row"><span class="dim">Founded</span><span>Year ${city.founded}</span></div>
      <div class="row"><span class="dim">Era look</span><span style="color:${era.color}">⬤ ${era.name}</span></div>
      <div class="row"><span class="dim">Features</span><span>${city.port ? '⚓ port ' : ''}${city.launchpad ? '🚀 launch complex' : ''}${!city.port && !city.launchpad ? '—' : ''}</span></div>
      <div class="row"><span class="dim">Damage</span></div>${this.bar(city.damage, '#ff6b6b')}
      <div class="row"><span class="dim">Pollution</span></div>${this.bar(city.smog, '#8a8f96')}
      <div class="btnrow"><button class="btn" data-act="goto-city" data-arg="${city.id}">Go to</button>
      <button class="btn" data-act="follow-city" data-arg="${city.id}">Follow</button></div>
      <h4>Residents</h4>
      ${residents.map((p, i) => `<div class="row person"><span>${p.name}, ${p.age} — ${p.role}</span><button class="btn xs" data-act="follow-person" data-arg="${city.id}" data-arg2="${i}">Follow</button></div>`).join('')}
      <h4>Land</h4>
      <div class="row"><span class="dim">Biome</span><span>${BIOME_INFO[cell.biome].name}</span></div>
      <div class="row"><span class="dim">Climate</span><span>${(cell.temp * 30 - 8).toFixed(0)}°C · rain ${(cell.precip * 100).toFixed(0)}%</span></div>`;
  }

  civHTML(civ) {
    if (!civ) return '<div class="empty">Nation no longer exists.</div>';
    const w = this.world;
    const era = ERAS[civ.era];
    const next = ERAS[civ.era + 1];
    const pop = w.civPop(civ);
    const urban = civ.cities.reduce((s, id) => s + (w.cityById(id)?.pop || 0), 0);
    const cap = w.capitalOf(civ);
    const rels = Object.entries(civ.relations)
      .filter(([id, v]) => w.civs[id]?.alive)
      .sort((a, b) => a[1] - b[1]);
    const wars = civ.wars.map((x) => w.civs[x.foe]).filter(Boolean);
    const space = civ.space.stage >= 0 ? SPACE_STAGES[civ.space.stage].name : '—';
    const spaceNext = civ.space.stage < SPACE_STAGES.length - 1 ? SPACE_STAGES[civ.space.stage + 1] : null;
    return `
      <h3><span style="color:${civ.colorCss}">⬤</span> ${w.fullCivName(civ)} ${civ.alive ? '' : '<span class="chip danger">fallen</span>'}</h3>
      <div class="row"><span class="dim">Era</span><span style="color:${era.color}">⬤ <b>${era.name}</b></span></div>
      ${next ? `<div class="row"><span class="dim">Next: ${next.name}</span><span>${Math.floor(civ.tech)} / ${next.techAt}</span></div>${this.bar((civ.tech - era.techAt) / (next.techAt - era.techAt), era.color)}` : '<div class="row"><span class="dim">Peak of history</span><span>👑</span></div>'}
      <div class="grid2">
        <div><div class="dim">Population</div><b>${fmtPop(pop)}</b></div>
        <div><div class="dim">Cities</div><b>${civ.cities.length}</b></div>
        <div><div class="dim">Territory</div><b>${civ.territory.length} lands</b></div>
        <div><div class="dim">Trade routes</div><b>${civ.tradeRoutes}</b></div>
        <div><div class="dim">Urban / Rural</div><span>${fmtPop(urban)} / ${fmtPop(civ.rural)}</span></div>
        <div><div class="dim">Lunar pop.</div><b>${fmtPop(civ.lunarPop)}</b></div>
      </div>
      <div class="row"><span class="dim">Government</span><span>${civ.gov}</span></div>
      <div class="row"><span class="dim">Faith</span><span>${civ.religion}</span></div>
      <div class="row"><span class="dim">Culture</span><span>famed for ${civ.culture}; eats ${civ.food}</span></div>
      <div class="row"><span class="dim">Tongue</span><span>${civ.language}</span></div>
      <div class="row"><span class="dim">Character</span><span>⚔️${(civ.personality.aggr * 100) | 0} 🔬${(civ.personality.cur * 100) | 0} 🧭${(civ.personality.exp * 100) | 0}</span></div>
      ${wars.length ? `<h4 class="danger">⚔️ At war with ${wars.map((x) => x.name).join(', ')}</h4>` : ''}
      ${civ.allies.length ? `<div class="row"><span class="dim">Allies</span><span>${civ.allies.map((id) => w.civs[id]?.name).filter(Boolean).join(', ')}</span></div>` : ''}
      <div class="row"><span class="dim">Relations</span></div>
      <div class="rellist">${rels.slice(0, 6).map(([id, v]) => {
        const o = w.civs[id];
        return `<div class="row"><button class="link" data-selciv="${id}" style="color:${o.colorCss}">${o.name}</button><span>${v > 40 ? '💚 ally' : v > 0 ? '🙂 warm' : v > -40 ? '😐 cold' : '💢 hostile'} (${Math.round(v)})</span></div>`;
      }).join('') || '<span class="dim">none</span>'}</div>
      <h4>🚀 Space program</h4>
      <div class="row"><span class="dim">Stage</span><span>${space}</span></div>
      ${spaceNext ? `<div class="row"><span class="dim">Next</span><span>${spaceNext.name} (${Math.floor(civ.space.progress)}/${spaceNext.need})</span></div>${this.bar(civ.space.progress / spaceNext.need, '#c792ff')}` : ''}
      <div class="row"><span class="dim">Satellites</span><span>🛰 ${civ.space.satellites}</span></div>
      <h4>Cities</h4>
      ${civ.cities.map((id) => { const c = w.cityById(id); return c ? `<button class="link citylink" data-selcity="${id}">${c.id === civ.capital ? '👑' : '🏘️'} ${c.name} <span class="dim">${fmtPop(c.pop)}</span></button>` : ''; }).join('') || '<span class="dim">nomads, no cities</span>'}
      <div class="btnrow"><button class="btn" data-act="goto-civ" data-arg="${civ.id}">Go to capital</button>
      <button class="btn" data-act="follow-civ" data-arg="${civ.id}">Follow</button>
      <button class="btn" data-act="bless" data-arg="${civ.id}">✨ Bless</button></div>
      <h4>Chronicle of ${civ.name}</h4>
      <div class="hist">${civ.history.slice(-8).reverse().map((h) => `<div>📜 ${h}</div>`).join('') || '<span class="dim">too young for tales</span>'}</div>`;
  }

  cellHTML(idx) {
    const cell = this.world.cells[idx];
    if (!cell) return '';
    const owner = cell.owner !== -1 ? this.world.civs[cell.owner] : null;
    const herds = this.world.herds.filter((h) => h.cell === idx && h.n > 5);
    const res = Object.entries(cell.res).filter(([k, v]) => v > 0.25).map(([k, v]) => `${k} ${(v * 100) | 0}%`);
    return `
      <h3>🌍 ${BIOME_INFO[cell.biome].name}</h3>
      <div class="row"><span class="dim">Climate</span><span>${(cell.temp * 30 - 8).toFixed(0)}°C · rain ${(cell.precip * 100).toFixed(0)}%</span></div>
      <div class="row"><span class="dim">Elevation</span><span>${cell.ocean ? 'below sea level' : cell.elev > 0.5 ? 'highlands' : cell.elev > 0.2 ? 'hills' : 'lowlands'}</span></div>
      <div class="row"><span class="dim">Water</span><span>${cell.river ? '🌊 river valley' : cell.coast ? '🌊 coast' : cell.ocean ? '🌊 open water' : Math.round(cell.water * 100) + '%'}</span></div>
      <div class="row"><span class="dim">Fertility</span></div>${this.bar(cell.fertility / 1.4, '#6fd3a7')}
      <div class="row"><span class="dim">Forest</span></div>${this.bar(cell.forest, '#2e8b57')}
      <div class="row"><span class="dim">Ruled by</span>${owner ? `<button class="link" data-selciv="${owner.id}" style="color:${owner.colorCss}">${this.world.fullCivName(owner)}</button>` : '<span>unclaimed wilds</span>'}</div>
      ${cell.city != null ? `<div class="row"><span class="dim">City</span><button class="link" data-selcity="${cell.city}">${this.world.cityById(cell.city)?.name}</button></div>` : ''}
      <div class="row"><span class="dim">Resources</span><span>${res.join(' · ') || '—'}</span></div>
      ${herds.length ? `<h4>Wildlife</h4>${herds.map((h) => `<div class="row"><span>🦌 ${h.kind}</span><span>${fmtPop(h.n)}</span></div>`).join('')}` : ''}
      <div class="btnrow"><button class="btn" data-act="locate" data-arg="${idx}">Go to</button></div>`;
  }

  personHTML(p) {
    if (!p) return '';
    const city = this.world.cityById(p.city);
    const civ = city ? this.world.civs[city.civ] : null;
    return `
      <h3>🧑 ${p.name}</h3>
      <div class="row"><span class="dim">Age</span><span>${p.age}</span></div>
      <div class="row"><span class="dim">Role</span><span>${p.role}</span></div>
      <div class="row"><span class="dim">Home</span>${city ? `<button class="link" data-selcity="${city.id}">${city.name}</button>` : '—'}</div>
      <div class="row"><span class="dim">Nation</span>${civ ? `<button class="link" data-selciv="${civ.id}" style="color:${civ.colorCss}">${civ.name}</button>` : '—'}</div>
      <div class="btnrow"><button class="btn" data-act="follow-person" data-arg="${p.city}" data-arg2="${p.idx}">Follow ${p.name.split(' ')[0]}</button>
      <button class="btn" data-act="unfollow">Unfollow</button></div>
      <p class="dim">Zoom close to any city to watch its people wander the streets.</p>`;
  }

  moonHTML() {
    const m = this.world.moon;
    return `<h3>🌙 The Moon</h3>
      <div class="row"><span class="dim">Phase</span><span>${this.game.planetView.moonPhaseName()}</span></div>
      <div class="row"><span class="dim">Settlers</span><b>${fmtPop(m.pop)}</b></div>
      <div class="row"><span class="dim">Bases</span><span>${m.bases.length ? m.bases.map((b) => { const c = this.world.civs[b.civ]; return `${c ? c.name : '?'} (${['', 'outpost', 'base', 'colony'][b.size] || 'site'})`; }).join(' · ') : 'none yet — reach the Space Age'}</span></div>
      <div class="btnrow"><button class="btn" data-act="goto-moon">Visit</button><button class="btn" data-act="follow-moon">Follow Moon</button></div>`;
  }

  sunHTML() {
    return `<h3>☀️ The Sun</h3><p>The system's star. It does not move — the planet turns beneath it, giving 10-minute days and 10-minute nights.</p>
    <div class="btnrow"><button class="btn" data-act="follow-sun">Follow Sun</button></div>`;
  }

  nationsHTML() {
    const w = this.world;
    const list = [...w.civs].filter((c) => c.alive).sort((a, b) => w.civPop(b) - w.civPop(a));
    const fallen = w.civs.filter((c) => !c.alive).length;
    return `<div class="dim" style="margin-bottom:6px">${list.length} living nations${fallen ? ` · ${fallen} fallen` : ''}</div>` +
      list.map((c) => `
      <div class="civcard" data-selciv="${c.id}">
        <div class="civhead"><span style="color:${c.colorCss}">⬤</span><b>${w.fullCivName(c)}</b></div>
        <div class="civsub"><span style="color:${ERAS[c.era].color}">${ERAS[c.era].name}</span> · 👥 ${fmtPop(w.civPop(c))} · 🏘️ ${c.cities.length}${c.wars.length ? ' · <span class="danger">⚔️ WAR</span>' : ''}${c.space.stage >= 3 ? ' · 🛰️' : ''}${c.lunarPop > 0 ? ' · 🌙' : ''}</div>
      </div>`).join('');
  }

  worldHTML() {
    const w = this.world;
    const herds = {};
    for (const h of w.herds) herds[h.kind] = (herds[h.kind] || 0) + h.n;
    const biomeCount = {};
    for (const c of w.cells) biomeCount[c.biome] = (biomeCount[c.biome] || 0) + 1;
    const land = w.cells.filter((c) => !c.ocean).length;
    return `
      <h4>🌍 Planet</h4>
      <div class="row"><span class="dim">Land coverage</span><span>${(land / w.cells.length * 100).toFixed(1)}%</span></div>
      <div class="row"><span class="dim">Day length</span><span>10 min day · 10 min night</span></div>
      <div class="row"><span class="dim">Active storms</span><span>${w.storms.map((s) => s.type).join(', ') || 'clear skies'}</span></div>
      <h4>🦌 Ecosystems</h4>
      ${Object.entries(herds).map(([k, n]) => `<div class="row"><span>${k}</span><span>${fmtPop(n)}</span></div>`).join('')}
      <h4>🚀 Space</h4>
      <div class="row"><span class="dim">Satellites</span><span>🛰 ${w.stats.satellites}</span></div>
      <div class="row"><span class="dim">Launches</span><span>🚀 ${w.stats.launches}</span></div>
      <div class="row"><span class="dim">Lunar settlers</span><span>🌙 ${fmtPop(w.moon.pop)}</span></div>
      <h4>📊 History so far</h4>
      <div class="row"><span class="dim">Wars fought</span><span>${w.stats.wars}</span></div>
      <div class="row"><span class="dim">Disasters</span><span>${w.stats.disasters}</span></div>
      <div class="row"><span class="dim">Events recorded</span><span>${w.history.length}</span></div>`;
  }

  logHTML() {
    const items = [...this.world.ticker].reverse().slice(0, 40);
    return items.map((e) => `
      <div class="logline" ${e.cell >= 0 ? `data-act="locate" data-arg="${e.cell}"` : ''}>
        <span class="logdot" style="background:${KIND_COLOR[e.kind] || '#fff'}"></span>
        <span>${e.text}</span>
      </div>`).join('') || '<div class="empty">Nothing yet.</div>';
  }

  annalsHTML() {
    const major = this.world.history.filter((e) =>
      this.annalsFilter === 'all' ? ['era', 'space', 'war', 'disaster', 'civ'].includes(e.kind) : e.kind === this.annalsFilter
    );
    return `<select id="annals-filter" class="select">
        <option value="all">All milestones</option>
        <option value="era" ${this.annalsFilter === 'era' ? 'selected' : ''}>Eras</option>
        <option value="space" ${this.annalsFilter === 'space' ? 'selected' : ''}>Space</option>
        <option value="war" ${this.annalsFilter === 'war' ? 'selected' : ''}>Wars</option>
        <option value="disaster" ${this.annalsFilter === 'disaster' ? 'selected' : ''}>Disasters</option>
      </select>
      <div class="annals">${[...major].reverse().map((e) => `
        <div class="annal"><span class="annal-year">${e.year}</span><span class="logdot" style="background:${KIND_COLOR[e.kind]}"></span><span>${e.text.replace(/^Year \d+ — /, '')}</span></div>`
      ).join('')}</div>`;
  }

  // -- labels ----------------------------------------------------------------------------
  updateLabels() {
    const layer = document.querySelector('#labels');
    const g = this.game;
    const show = this.showLabels && g.camDistToPlanet() < 1400 * WORLD_SCALE;
    // pick capitals + big cities
    let cities = [];
    if (show) {
      cities = [...this.world.cities]
        .sort((a, b) => b.pop - a.pop)
        .slice(0, 14);
    }
    while (this.labelPool.length < cities.length) {
      const d = document.createElement('div');
      d.className = 'clabel';
      d.addEventListener('click', () => {
        const id = parseInt(d.dataset.city, 10);
        if (id) { g.selectCity(id); this.switchTab('inspect'); }
      });
      layer.appendChild(d);
      this.labelPool.push(d);
    }
    const pp = g.planetView.planetWorldPos(new THREE.Vector3());
    const camDir = g.camera.position.clone().sub(pp).normalize();
    const place = (d, wp) => {
      const dirW = wp.clone().sub(pp).normalize();
      if (dirW.dot(camDir) < 0.12) { d.style.display = 'none'; return false; }
      const sp = wp.clone().project(g.camera);
      if (sp.z > 1) { d.style.display = 'none'; return false; }
      const x = (sp.x * 0.5 + 0.5) * innerWidth;
      const y = (-sp.y * 0.5 + 0.5) * innerHeight;
      d.style.display = 'block';
      d.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px) translate(-50%,-140%)`;
      return true;
    };
    for (let i = 0; i < this.labelPool.length; i++) {
      const d = this.labelPool[i];
      if (i >= cities.length) { d.style.display = 'none'; continue; }
      const city = cities[i];
      const wp = g.worldView.cityWorldPos(city, new THREE.Vector3());
      if (!place(d, wp)) continue;
      d.dataset.city = city.id;
      const civ = this.world.civs[city.civ];
      const isCap = civ && city.id === civ.capital;
      d.innerHTML = `<div><span class="lx">⚔️</span><span class="lname" style="color:${civ ? civ.colorCss : '#fff'}">${isCap ? '👑' : ''}${city.name}</span></div><div class="lsub">${fmtPop(city.pop)} · ${ERAS[civ ? civ.era : 0].name}</div>`;
    }
    // battle callouts ("Zisa ⚔️ 68 fighting")
    if (!this.blabelPool) this.blabelPool = [];
    while (this.blabelPool.length < 8) {
      const d = document.createElement('div');
      d.className = 'blabel';
      d.style.display = 'none';
      layer.appendChild(d);
      this.blabelPool.push(d);
    }
    g.worldView.spin.updateWorldMatrix(true, false);
    for (let i = 0; i < this.blabelPool.length; i++) {
      const d = this.blabelPool[i];
      const b = show ? this.world.battles[i] : null;
      if (!b) { d.style.display = 'none'; continue; }
      const wp = new THREE.Vector3(b.dir.x, b.dir.y, b.dir.z).multiplyScalar(PLANET_R + 4 * WORLD_SCALE);
      wp.applyMatrix4(g.worldView.spin.matrixWorld);
      if (!place(d, wp)) continue;
      d.textContent = `${b.a} ⚔️ ${b.n} fighting`;
    }
  }

  // -- per-frame ----------------------------------------------------------------------------
  update(dtReal, fps) {
    const g = this.game, w = this.world;
    // fast: top bar numbers
    this.el('#year').textContent = `Year ${Math.floor(w.year).toLocaleString()}`;
    this.el('#day').textContent = `Day ${Math.floor(w.year / 25) + 1}`;
    const me = w.maxEra();
    const eraEl = this.el('#era');
    eraEl.textContent = ERAS[me].name;
    eraEl.style.color = ERAS[me].color;
    const ph = g.planetView.dayPhase();
    const pn = g.planetView.constructor.phaseName(ph);
    this.el('#phase-name').textContent = pn;
    this.el('#phase-icon').textContent = /Night|Midnight|Twilight|Nightfall/.test(pn) ? '🌙' : /Sunset|Sunrise/.test(pn) ? '🌅' : '☀️';
    this.el('#moon-phase').textContent = `🌙 ${g.planetView.moonPhaseName()}`;
    this.el('#eclipse-warn').classList.toggle('hidden', !g.planetView.eclipse);
    if (g.planetView.eclipse) this.el('#eclipse-warn').textContent = g.planetView.eclipse === 'solar' ? '☀️ SOLAR ECLIPSE' : '🌙 LUNAR ECLIPSE';
    // day/night pill with countdown ("☀ Day · sunset in 1:51")
    const fmtT = (sec) => {
      sec = Math.max(0, Math.round(sec));
      if (sec >= 3600) return `${Math.floor(sec / 3600)}h${String(Math.floor(sec % 3600 / 60)).padStart(2, '0')}`;
      return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    };
    let pill;
    if (g.warp === 0) pill = `${ph < 0.53 ? '☀️ Day' : '🌙 Night'} · paused`;
    else {
      const per = ROTATION_SECONDS / g.warp;
      if (ph < 0.44) pill = `☀️ Day · sunset in ${fmtT((0.44 - ph) * per)}`;
      else if (ph < 0.53) pill = `🌅 Sunset · nightfall in ${fmtT((0.53 - ph) * per)}`;
      else if (ph < 0.97) pill = `🌙 Night · sunrise in ${fmtT((1 - ph) * per)}`;
      else pill = `🌅 Sunrise · daybreak in ${fmtT(((1 - ph) + 0.06) * per)}`;
    }
    const pillEl = this.el('#daypill');
    if (pillEl.textContent !== pill) pillEl.textContent = pill;
    this.el('#st-pop').textContent = fmtPop(w.worldPop());
    this.el('#st-civ').textContent = w.civs.filter((c) => c.alive).length;
    this.el('#st-moon').textContent = fmtPop(w.moon.pop);
    this.el('#st-sat').textContent = w.stats.satellites;
    this.el('#st-fps').textContent = Math.round(fps);
    // speed UI sync
    const lbl = g.warp === 0 ? '⏸ PAUSED' : `${g.warp}×`;
    if (this.el('#speed-label').textContent !== lbl) this.el('#speed-label').textContent = lbl;
    this.el('#btn-pause').textContent = g.warp === 0 ? '▶' : '⏸';
    if (parseInt(this.el('#speed').value, 10) !== g.warpIndex) this.el('#speed').value = g.warpIndex;

    this.updateLabels();

    // medium: ticker
    this.accMed += dtReal;
    if (this.accMed > 0.8) {
      this.accMed = 0;
      this.renderTicker();
      this.drawMinimap();
      // headline banner for major events (wars, eras, space, disasters)
      const majors = this.world.ticker.filter((e) => ['war', 'era', 'space', 'disaster'].includes(e.kind));
      const newest = majors[majors.length - 1];
      if (newest && newest.id !== this.bannerId) {
        this.bannerId = newest.id;
        const b = this.el('#eventbanner');
        const icon = { war: '⚔️', era: '🌟', space: '🚀', disaster: '🌋' }[newest.kind] || '📯';
        b.innerHTML = `<span class="blogdot" style="background:${KIND_COLOR[newest.kind] || '#fff'}"></span><span>${icon}</span><span>${newest.text}</span>`;
        b.classList.remove('hidden');
        clearTimeout(this._bannerT);
        this._bannerT = setTimeout(() => b.classList.add('hidden'), 7000);
      }
    }
    // slow: active tab refresh
    this.accSlow += dtReal;
    if (this.accSlow > 2.0) {
      this.accSlow = 0;
      this.renderTab(false);
    }
  }

  renderTicker() {
    const t = this.el('#ticker');
    const items = [...this.world.ticker].reverse().slice(0, 5);
    t.innerHTML = items.map((e) =>
      `<div class="tick" ${e.cell >= 0 ? `data-cell="${e.cell}"` : ''}><span class="logdot" style="background:${KIND_COLOR[e.kind] || '#fff'}"></span><span>${e.text}</span></div>`
    ).join('');
    t.querySelectorAll('[data-cell]').forEach((d) => d.addEventListener('click', () => this.game.locateCell(parseInt(d.dataset.cell, 10))));
  }
}
