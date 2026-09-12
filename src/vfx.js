/* ══════════════ 技能特效 ══════════════
   貼圖用 Canvas 現畫（加色混合下，radial gradient 跟真的粒子圖看不出差別，
   而且省下三百多 KB 和授權問題）。下面是一組可組合的原件，
   每個技能只是這些原件的配方。 */

const FXTEX = {};
function makeTex(draw, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size || 128;
  draw(c.getContext('2d'), c.width);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
function initFXTex() {
  // 柔光：中心亮、外圍散開
  FXTEX.glow = makeTex((g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,.75)');
    r.addColorStop(0.6, 'rgba(255,255,255,.18)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  });
  // 火花：核心很硬，邊緣很快掉下去
  FXTEX.spark = makeTex((g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,.9)');
    r.addColorStop(0.4, 'rgba(255,255,255,.25)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  }, 64);
  // 星芒：四道十字光刺
  FXTEX.star = makeTex((g, n) => {
    const h = n / 2;
    const r = g.createRadialGradient(h, h, 0, h, h, h * 0.32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.beginPath(); g.arc(h, h, h * 0.32, 0, 7); g.fill();
    g.translate(h, h);
    for (let i = 0; i < 4; i++) {
      const lg = g.createLinearGradient(0, 0, h, 0);
      lg.addColorStop(0, 'rgba(255,255,255,.95)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(0, -h * 0.055); g.lineTo(h, 0); g.lineTo(0, h * 0.055); g.fill();
      g.rotate(Math.PI / 2);
    }
  });
}

/* ── 粒子池 ── */
const parts = [];
let partPool = [];
function particle(tex, x, y, z, col, size, life, vx, vy, vz, grav) {
  let p = partPool.pop();
  if (!p) {
    p = new THREE.Sprite(new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false
    }));
    fxGroup.add(p);
  }
  p.material.map = FXTEX[tex] || FXTEX.glow;
  p.material.color.setHex(col);
  p.material.opacity = 1;
  p.visible = true;
  p.position.set(x, y, z);
  p.scale.setScalar(size);
  p.userData = { vx, vy, vz, grav: grav === undefined ? -5 : grav, t: 0, life, size };
  parts.push(p);
  return p;
}
function updateFX(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i], d = p.userData;
    d.t += dt;
    const k = d.t / d.life;
    if (k >= 1) {
      p.visible = false; partPool.push(p); parts.splice(i, 1); continue;
    }
    d.vy += d.grav * dt;
    p.position.x += d.vx * dt; p.position.y += d.vy * dt; p.position.z += d.vz * dt;
    p.material.opacity = 1 - k * k;
    p.scale.setScalar(d.size * (1 + k * 0.6));
  }
}

/* ── 原件 ── */
const wpos = (x, y, dy) => new THREE.Vector3(wx(x), ter(x, y).h + (dy || 0), wz(y));

// 往四面八方噴一團粒子
function burst(x, y, col, n, spd, size, life, tex, dy) {
  if (SET.fx === 'mid') n = Math.max(3, Math.round(n * 0.45));   // 精簡模式少噴一半粒子
  const p = wpos(x, y, dy === undefined ? 0.7 : dy);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, e = Math.random();
    particle(tex || 'spark', p.x, p.y, p.z, col,
      size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6),
      Math.cos(a) * spd * e, (0.4 + Math.random()) * spd * 0.7, Math.sin(a) * spd * e);
  }
}

// 地上擴散的環
function ringFX(x, y, col, r1, life, dy) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 40),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  m.rotation.x = -Math.PI / 2;
  const p = wpos(x, y, dy === undefined ? 0.09 : dy);
  m.position.copy(p);
  fxGroup.add(m);
  tween(life * 1000, k => {
    m.scale.setScalar(0.3 + k * r1);
    m.material.opacity = 0.95 * (1 - k);
  }).then(() => { fxGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
}

// 從天而降 / 往上竄的光柱
function column(x, y, col, life, rad) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rad || 0.7, rad || 0.7, 7, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  const p = wpos(x, y, 3.5);
  m.position.copy(p);
  fxGroup.add(m);
  tween((life || 0.6) * 1000, k => {
    m.material.opacity = 0.7 * (1 - k);
    m.scale.set(1 + k * 0.5, 1, 1 + k * 0.5);
  }).then(() => { fxGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
}

// 兩點之間的一道光束
function beam(ax, ay, bx, by, col, w, life) {
  const a = wpos(ax, ay, 0.8), b = wpos(bx, by, 0.8);
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(w || 0.09, w || 0.09, len, 8),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b); m.rotateX(Math.PI / 2);
  fxGroup.add(m);
  tween((life || 0.28) * 1000, k => { m.material.opacity = 0.95 * (1 - k); })
    .then(() => { fxGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
}

// 揮砍的弧線
function arcFX(u, col, big) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(big ? TILE * 0.75 : TILE * 0.5, 0.07, 6, 22, Math.PI * 1.1),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  m.position.set(wx(u.x), ter(u.x, u.y).h + 0.9, wz(u.y));
  m.rotation.set(-Math.PI / 2.4, u.dir * Math.PI / 4, 0);
  fxGroup.add(m);
  tween(280, k => {
    m.material.opacity = 1 - k;
    m.rotation.z = -1.4 + k * 2.8;
    m.scale.setScalar(0.8 + k * 0.5);
  }).then(() => { fxGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
}

// 套在單位身上的泡泡（護盾之類）
function bubble(u, col, life) {
  if (!u.view) return;
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(TILE * 0.42, 16, 12),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  );
  m.position.set(0, 0.9, 0);
  u.view.g.add(m);
  tween((life || 0.7) * 1000, k => {
    m.material.opacity = 0.45 * (1 - k);
    m.scale.setScalar(0.5 + k * 0.7);
  }).then(() => { u.view && u.view.g.remove(m); m.geometry.dispose(); m.material.dispose(); });
}

/* ── 每個技能的配方 ── */
const FX = {
  slash:  (u, t) => { arcFX(u, 0xfff0c0); if (t) burst(t.x, t.y, 0xffe08a, 10, 3.2, 0.5, 0.4); },
  whirl:  u => { arcFX(u, 0xffd0a0, true); ringFX(u.x, u.y, 0xffa060, TILE * 1.7, 0.45); },
  bash:   (u, t) => { if (t) { burst(t.x, t.y, 0xcfe4ff, 12, 3.4, 0.5, 0.35); ringFX(t.x, t.y, 0x9fc8ff, TILE, 0.35); } },
  shock:  u => { ringFX(u.x, u.y, TILE * 2.2, 0.5) || ringFX(u.x, u.y, 0xffe0a0, TILE * 2.2, 0.5);
                 burst(u.x, u.y, 0xffd080, 18, 4, 0.6, 0.5, 'glow', 0.2); },
  holy:   (u, t) => { const p = t || u; column(p.x, p.y, 0xfff2b0, 0.55); burst(p.x, p.y, 0xfff6cc, 16, 2.4, 0.6, 0.6, 'star'); },
  arrow:  (u, t) => { if (t) burst(t.x, t.y, 0xdccfb4, 8, 2.6, 0.35, 0.3); },
  arcane: (u, t) => { if (t) { burst(t.x, t.y, 0xa98cff, 14, 2.8, 0.5, 0.5, 'star'); ringFX(t.x, t.y, 0x8f6cff, TILE, 0.4); } },
  fire:   (u, t) => { const p = t || u; burst(p.x, p.y, 0xff8a2a, 26, 3.6, 0.85, 0.7, 'glow'); burst(p.x, p.y, 0xffe07a, 14, 2.4, 0.5, 0.5); ringFX(p.x, p.y, 0xff6a20, TILE * 1.8, 0.5); },
  ice:    (u, t) => { const p = t || u; burst(p.x, p.y, 0x8fe6ff, 20, 2.6, 0.6, 0.7, 'star'); ringFX(p.x, p.y, 0x6fd0ff, TILE * 1.5, 0.5); },
  bolt:   (u, t) => { if (t) { beam(u.x, u.y, t.x, t.y, 0xbfe4ff, 0.13, 0.22); burst(t.x, t.y, 0xdff2ff, 16, 3.6, 0.5, 0.4); } },
  water:  (u, t) => { const p = t || u; burst(p.x, p.y, 0x5fc9ff, 22, 3.0, 0.8, 0.7, 'glow'); ringFX(p.x, p.y, 0x3fa8ff, TILE * 2, 0.55); },
  meteor: (u, t) => { const p = t || u; column(p.x, p.y, 0xff7a3a, 0.5, 1.4); burst(p.x, p.y, 0xff9a3a, 34, 5, 1.1, 0.85, 'glow'); ringFX(p.x, p.y, 0xff5a20, TILE * 3, 0.7); },
  poison: (u, t) => { if (t) burst(t.x, t.y, 0x7fe05a, 16, 2.2, 0.55, 0.7, 'glow'); },
  rain:   (u, t) => { const p = t || u; for (let i = 0; i < 22; i++) { const a = Math.random() * 6.28, r = Math.random() * TILE * 1.3; const q = wpos(p.x, p.y, 4); particle('spark', q.x + Math.cos(a) * r, q.y, q.z + Math.sin(a) * r, 0xdccfb4, 0.35, 0.45, 0, -9, 0, -4); } ringFX(p.x, p.y, TILE * 2.4, 0.5) || ringFX(p.x, p.y, 0xdccfb4, TILE * 2.4, 0.5); },
  mark:   (u, t) => { if (t) { ringFX(t.x, t.y, 0xff4444, TILE * 1.3, 0.5); burst(t.x, t.y, 0xff6666, 14, 2.4, 0.5, 0.5, 'star'); } },
  trap:   (u, t) => { const p = t || u; ringFX(p.x, p.y, 0x9fe08a, TILE, 0.4); },
  heal:   (u, t) => { const p = t || u; column(p.x, p.y, 0x7cffb0, 0.6, 0.55); burst(p.x, p.y, 0xa8ffcf, 16, 1.8, 0.5, 0.8, 'star', 0.2); },
  aura:   u => { ringFX(u.x, u.y, 0x7cffb0, TILE * 4.5, 0.9); burst(u.x, u.y, 0xa8ffcf, 20, 2.2, 0.5, 0.9, 'star'); },
  ward:   (u, t) => { bubble(t || u, 0x8fd8ff, 0.8); },
  buff:   u => { column(u.x, u.y, 0xffd35c, 0.5, 0.5); burst(u.x, u.y, 0xffe89a, 14, 2, 0.5, 0.7, 'star', 0.2); },
  shout:  u => { ringFX(u.x, u.y, 0xffb45c, TILE * 4.5, 0.7); },
  domain: u => { ringFX(u.x, u.y, 0xfff0a0, TILE * 4.5, 0.9); column(u.x, u.y, 0xfff2b0, 0.9, 1.2); },
  raise:  (u, t) => { const p = t || u; column(p.x, p.y, 0xfff0c0, 1.0, 0.8); burst(p.x, p.y, 0xffffff, 26, 2.4, 0.7, 1.0, 'star', 0.2); },
  charge: (u, t) => { if (t) { burst(t.x, t.y, 0xffc08a, 18, 4, 0.6, 0.45); ringFX(t.x, t.y, 0xff9a5a, TILE * 1.4, 0.4); } },
  exec:   (u, t) => { if (t) { arcFX(u, 0xff5040, true); burst(t.x, t.y, 0xff3020, 26, 4.2, 0.8, 0.6, 'glow'); column(t.x, t.y, 0xff4030, 0.5, 0.6); } },
  cage:   (u, t) => { const p = t || u; ringFX(p.x, p.y, 0xa98cff, TILE * 2.4, 0.7); column(p.x, p.y, 0x8f6cff, 0.8, 1.1); },
  blink:  (u, t) => { const p = t || u; burst(p.x, p.y, 0xa98cff, 18, 3, 0.5, 0.5, 'star'); }
};

function playFX(name, u, t) {
  if (SET.fx === 'off') return;
  const f = FX[name];
  if (f) try { f(u, t); } catch (e) {}
}

// 命中時噴一小撮血 / 火花，跟技能無關的通用回饋
function hitFX(t, magic) {
  if (SET.fx === 'off') return;
  burst(t.x, t.y, magic ? 0xb08cff : 0xff8060, 8, 2.4, 0.38, 0.3);
}
