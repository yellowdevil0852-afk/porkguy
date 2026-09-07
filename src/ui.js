/* ══════════════ 介面 ══════════════ */

const $ = id => document.getElementById(id);

/* ── 頭上的名牌 ── */
function clearTags() {
  $('tags').innerHTML = '';
  respTags.length = 0;
  if (typeof G !== 'undefined' && G.units) G.units.forEach(u => { u.tag = null; });
}
function makeTag(u) {
  if (!u.alive) return;
  const d = document.createElement('div');
  d.className = 'tag s' + u.side;
  d.innerHTML = '<div class="nm"></div><div class="hb"><i></i><b></b></div>';
  $('tags').appendChild(d);
  u.tag = d;
  updTag(u);
}
function updTag(u) {
  if (!u.tag) return;
  u.tag.querySelector('.nm').textContent =
    nameOf(u) + ' Lv' + u.lv + (!isHero(u) && MON[u.kind].boss ? ' ★' : '');
  const r = Math.max(0, u.hp) / mhpOf(u);
  const i = u.tag.querySelector('i');
  i.style.width = (r * 100) + '%';
  i.className = r <= 0.3 ? 'low' : '';
  const sh = shieldOf(u);
  u.tag.querySelector('b').style.width = Math.min(100, sh / mhpOf(u) * 100) + '%';
  u.tag.classList.toggle('done', u.side === G.cur && u.moved && u.acted);
}
const projV = new THREE.Vector3();
function projectTags() {
  for (const u of G.units) {
    if (!u.tag) continue;
    if (!u.alive || !u.view) { u.tag.style.display = 'none'; continue; }
    if (SET.tagMode === 'off' && u !== hoverUnit && u !== sel) { u.tag.style.display = 'none'; continue; }
    if (SET.tagMode === 'hurt' && u.hp >= mhpOf(u) && u !== hoverUnit && u !== sel) {
      u.tag.style.display = 'none'; continue;
    }
    // 沒被驚醒又離玩家很遠的魔物不掛名牌，畫面才不會被標籤淹掉
    if (u.side === 2 && !u.awake && u !== hoverUnit &&
        !alive().some(h => h.side !== 2 && dist(h, u) <= AGGRO + 3)) {
      u.tag.style.display = 'none'; continue;
    }
    projV.set(u.view.g.position.x, u.view.g.position.y + 2.0, u.view.g.position.z).project(camera);
    if (projV.z > 1 || Math.abs(projV.x) > 1.2 || Math.abs(projV.y) > 1.2) { u.tag.style.display = 'none'; continue; }
    u.tag.style.display = '';
    u.tag.style.left = ((projV.x * 0.5 + 0.5) * uiW()) + 'px';
    u.tag.style.top = ((-projV.y * 0.5 + 0.5) * uiH()) + 'px';
  }
  drawRespawnTags();
  drawReticle();
}

/* ── 等著重生的單位（怪物或倒下的英雄）：地上圈裡顯示還有幾回合 ── */
const respTags = [];
function refreshRespawnTags() {
  const box = $('tags');
  const list = G.units.filter(u => !u.alive && u.down > 0);
  while (respTags.length > list.length) respTags.pop().remove();
  while (respTags.length < list.length) {
    const d = document.createElement('div');
    d.className = 'resp';
    box.appendChild(d);
    respTags.push(d);
  }
  list.forEach((u, i) => {
    respTags[i].textContent = u.down;
    respTags[i].className = 'resp' + (u.side !== 2 ? ' s' + u.side : '');
    respTags[i].dataset.uid = u.id;
  });
}
function drawRespawnTags() {
  if (!respTags.length) return;
  const list = G.units.filter(u => !u.alive && u.down > 0);
  list.forEach((u, i) => {
    const el = respTags[i];
    if (!el) return;
    const s = u.spawnAt || u.home;
    projV.set(wx(s[0]), ter(s[0], s[1]).h + 0.4, wz(s[1])).project(camera);
    if (projV.z > 1 || Math.abs(projV.x) > 1.1 || Math.abs(projV.y) > 1.1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.left = ((projV.x * 0.5 + 0.5) * uiW()) + 'px';
    el.style.top = ((-projV.y * 0.5 + 0.5) * uiH()) + 'px';
  });
}

// 施放技能時，滑鼠指到的目標上會出現一個準心：傷害技能紅色、增益技能綠色
// 技能怎麼選目標：自己身上／敵方單位／友方單位／空地或格子
const K_SELF = ['fan', 'cross', 'around', 'retreat', 'refreshSelf', 'aura', 'buffSelf', 'buffAround', 'domain', 'raise'];
const K_ENEMY = ['single', 'multi'];
const K_ALLY = ['heal', 'shield', 'buffAlly', 'refreshAlly'];
const K_EMPTY = ['teleport', 'trap', 'trapN'];
const HARM = ['single', 'multi', 'fan', 'cross', 'around', 'line', 'aoe', 'pick', 'wave', 'charge', 'delayed', 'trap', 'trapN'];
const skAoeR = s => (s.k === 'around' || s.k === 'fan' || s.k === 'cross' ? 1 : s.r || 0);
function drawReticle() {
  const el = $('reticle');
  const t = hoverUnit;
  if (!skillMode || !sel || !t || !t.alive || !t.view) { el.classList.add('hide'); return; }
  const s = SK[skillMode];
  const harm = HARM.includes(s.k);
  if (harm ? t.side === sel.side : t.side !== sel.side) { el.classList.add('hide'); return; }
  if (dist(sel, t) > skRng(sel, s)) { el.classList.add("hide"); return; }
  projV.set(t.view.g.position.x, t.view.g.position.y + 1.0, t.view.g.position.z).project(camera);
  if (projV.z > 1) { el.classList.add('hide'); return; }
  el.classList.remove('hide');
  el.classList.toggle('harm', harm);
  el.classList.toggle('good', !harm);
  el.style.left = ((projV.x * 0.5 + 0.5) * uiW()) + 'px';
  el.style.top = ((-projV.y * 0.5 + 0.5) * uiH()) + 'px';
}
function floatText(x, y, txt, cls) {
  if (!SET.dmgNum && (cls === 'dmg' || cls === 'crit')) return;
  projV.set(wx(x), ter(x, y).h + 2.4, wz(y)).project(camera);
  const d = document.createElement('div');
  d.className = 'float ' + (cls || '');
  d.textContent = txt;
  d.style.left = ((projV.x * 0.5 + 0.5) * uiW()) + 'px';
  d.style.top = ((-projV.y * 0.5 + 0.5) * uiH()) + 'px';
  $('tags').appendChild(d);
  setTimeout(() => d.remove(), 1150);
}

/* ── 格子高亮 ── */
const OV = { move: 0x2a6fd8, threat: 0xd83a26, target: 0xe01400, heal: 0x1fae6b, skill: 0x9d63f0, hover: 0xffffff };
let ovPool = [], ovUsed = 0;
function addOverlay(x, y, kind, op) {
  let m = ovPool[ovUsed];
  if (!m) {
    m = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    m.rotation.x = -Math.PI / 2;
    ovPool.push(m);
    overlayGroup.add(m);
  }
  m.visible = true;
  m.material.color.setHex(OV[kind]);
  m.material.opacity = op;
  m.userData.base = op;
  m.position.set(wx(x), ter(x, y).h + 0.045, wz(y));
  ovUsed++;
}
// 高亮格子的呼吸效果，在主迴圈裡呼叫
function pulseOverlays(t) {
  const k = 0.70 + 0.30 * Math.sin(t * 3.6);
  for (let i = 0; i < ovUsed; i++) {
    const m = ovPool[i];
    m.material.opacity = m.userData.base * k;
    m.scale.setScalar(0.94 + 0.06 * k);
  }
  if (selRing && sel && sel.alive && sel.view) {
    selRing.visible = true;
    selRing.position.set(wx(sel.x), ter(sel.x, sel.y).h + 0.07, wz(sel.y));
    selRing.rotation.z = t * 1.1;
    selRing.material.opacity = 0.55 + 0.35 * Math.sin(t * 3.2);
    selRing.scale.setScalar(1 + 0.05 * Math.sin(t * 3.2));
  } else if (selRing) selRing.visible = false;
}

// 選中單位腳下那圈會轉的金色光環
let selRing = null;
function initSelRing() {
  selRing = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.40, TILE * 0.50, 32, 1, 0, Math.PI * 1.55),
    new THREE.MeshBasicMaterial({ color: 0xffd35c, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false, fog: false })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  overlayGroup.add(selRing);
}

function clearOverlay() {
  for (let i = 0; i < ovUsed; i++) ovPool[i].visible = false;
  ovUsed = 0;
}

function drawRanges() {
  clearOverlay();
  if (!sel) return;
  if (skillMode) { drawSkillRange(); return; }
  if (!sel.moved && reach) {
    for (const [x, y] of reach.stops) addOverlay(x, y, 'move', 0.62);
  }
  if (!sel.acted) {
    for (const t of targetsOf(sel)) addOverlay(t.x, t.y, t.side === sel.side ? 'heal' : 'target', 0.78);
    if (!sel.moved && reach && SET.threat) {
      const rg = rngOf(sel);
      const seen = new Set(reach.stops.map(p => key(p[0], p[1])));
      const th = new Set();
      for (const [sx, sy] of reach.stops)
        for (let dx = -rg; dx <= rg; dx++) for (let dy = -rg; dy <= rg; dy++) {
          const a = Math.abs(dx) + Math.abs(dy);
          if (!a || a > rg) continue;
          const nx = sx + dx, ny = sy + dy;
          if (inBoard(nx, ny) && !seen.has(key(nx, ny))) th.add(key(nx, ny));
        }
      for (const k of th) addOverlay(k % W, (k - k % W) / W, 'threat', 0.28);
    }
  }
}

function drawSkillRange() {
  const s = SK[skillMode];
  const harm = HARM.includes(s.k);
  // 以自己為中心的技能，直接把影響範圍畫出來就好
  if (K_SELF.includes(s.k)) {
    addOverlay(sel.x, sel.y, 'skill', 0.75);
    const r = skAoeR(s);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (!dx && !dy) continue;                                  // 「周圍一格」＝正方形
      if (inBoard(sel.x + dx, sel.y + dy)) addOverlay(sel.x + dx, sel.y + dy, harm ? 'target' : 'heal', 0.5);
    }
    return;
  }
  const rg = skRng(sel, s);
  if (K_ALLY.includes(s.k)) addOverlay(sel.x, sel.y, 'heal', 0.5);   // 也可以指自己
  for (let dx = -rg; dx <= rg; dx++) for (let dy = -rg; dy <= rg; dy++) {
    const a = Math.abs(dx) + Math.abs(dy);
    if (!a || a > rg) continue;
    const x = sel.x + dx, y = sel.y + dy;
    if (!inBoard(x, y)) continue;
    if (K_EMPTY.includes(s.k) && (unitAt(x, y) || ter(x, y).cost > 90)) continue;
    if ((s.k === 'line' || s.k === 'wave' || s.k === 'charge') && dx && dy) continue;
    addOverlay(x, y, 'skill', 0.5);
  }
  // 範圍技能：滑鼠指到哪，就把那一塊正方形範圍先畫給玩家看
  const ar = skAoeR(s);
  if (ar && hover && dist(sel, { x: hover[0], y: hover[1] }) <= rg) {
    for (let dx = -ar; dx <= ar; dx++) for (let dy = -ar; dy <= ar; dy++) {
      const x = hover[0] + dx, y = hover[1] + dy;
      if (inBoard(x, y)) addOverlay(x, y, harm ? 'target' : 'heal', 0.55);
    }
  }
}

/* ── 面板 ── */

// 這一回合輪到誰：線上模式講「你 / 對手」，本機模式講藍軍紅軍
function turnLabel() {
  if (G.cur === 2) return '魔物回合';
  if (mode === 'online') return G.cur === myTeam ? '你的回合' : '對手回合';
  return SIDE_N[G.cur] + '回合';
}
const myTurnNow = () => G.cur < 2 && (mode !== 'online' || G.cur === myTeam);
// 魔物階段時 G.cur 是 2，名冊和背包還是要顯示剛剛那一方的東西
const playerSide = () => (G.cur < 2 ? G.cur : (G.lastSide || 0));

function refreshTop() {
  $('turnNo').textContent = '第 ' + G.turn + ' 回合';
  const w = $('turnWho');
  w.className = 's' + G.cur + (myTurnNow() ? ' mine' : '');
  w.innerHTML = `<i class="dot s${G.cur}"></i>${turnLabel()}` +
    (mode === 'online' ? `<em>${SIDE_N[G.cur]}</em>` : '');
  const c = s => alive().filter(u => u.side === s).length;
  $('force').innerHTML = `<span class="s0">${c(0)}</span> : <span class="s1">${c(1)}</span>` +
    `<span class="mons">　魔物 ${c(2)}</span>`;
  for (const s of [0, 1]) {
    const el = $('hold' + s);
    el.textContent = G.hold[s];
    el.parentNode.classList.toggle('on', G.hold[s] > 0);
  }
  // 不是自己的回合就別掛「結束回合」四個字，免得以為按得動
  const eb = $('btnEnd');
  eb.disabled = !canAct();
  eb.textContent = canAct() ? '結束回合'
    : G.cur === 2 ? '魔物行動中…'
    : mode === 'online' ? '等待對手…' : '對方回合';
  eb.classList.toggle('prime', canAct());
  refreshBadge();
}

/* ── 回合開始的大字提示 ──
   先在畫面正中央淡入一個大字，停一下，再縮小飛到上面的面板上，
   剛好落在「現在輪到誰」那一格。 */
let bannerJob = 0;
function turnBanner() {
  const el = $('turnBanner'), txt = $('turnBigTxt');
  const job = ++bannerJob;
  const mine = myTurnNow();
  txt.textContent = turnLabel();
  el.className = 'show s' + G.cur + (mine ? ' mine' : '');
  txt.style.transition = 'none';
  txt.style.transform = 'translate(0,0) scale(1)';
  txt.style.opacity = '0';

  // 用強制重排而不是 requestAnimationFrame：分頁被切到背景時 rAF 會停擺，
  // 那樣這個提示就永遠停在 opacity 0
  void txt.offsetWidth;
  txt.style.transition = 'opacity .28s ease';
  txt.style.opacity = '1';

  // 停留之後往上面的面板收
  setTimeout(() => {
    if (job !== bannerJob) return;
    const from = txt.getBoundingClientRect();
    const to = $('turnWho').getBoundingClientRect();
    if (!from.width || !to.width) { el.className = 'hide'; return; }
    const k = Math.max(0.12, to.height / from.height);
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    txt.style.transition = 'transform .55s cubic-bezier(.55,0,.25,1), opacity .55s ease';
    txt.style.transform = `translate(${dx}px,${dy}px) scale(${k})`;
    txt.style.opacity = '0';
    el.classList.add('fading');
    setTimeout(() => { if (job === bannerJob) el.className = 'hide'; }, 560);
  }, mine ? 900 : 620);
}

function refreshRoster() {
  const box = $('roster');
  const side = mode === 'online' ? myTeam : playerSide();
  const list = G.units.filter(u => u.side === side);
  box.innerHTML = '';
  for (const u of list) {
    const d = document.createElement('div');
    d.className = 'rr' + (u.alive ? '' : ' dead') + (u.moved && u.acted ? ' done' : '') + (sel === u ? ' sel' : '');
    const r = u.alive ? Math.max(0, u.hp) / mhpOf(u) : 0;
    const tail = u.alive ? 'Lv' + u.lv : u.down + ' 回合後復活';
    d.innerHTML = `<div class="rn">${nameOf(u)}<span>${tail}</span></div>
      <div class="rb"><i style="width:${r * 100}%"></i></div>`;
    d.onclick = () => {
      if (!u.alive) return;
      lookAt(u.x, u.y);
      if (canAct() && u.side === G.cur) select(u); else showCard(u);
    };
    box.appendChild(d);
  }
}

function showCard(u) {
  const c = $('unitCard');
  c.classList.remove('hide');
  const d = base(u);
  $('ucName').textContent = nameOf(u);
  $('ucName').style.color = SIDE_CSS[u.side];
  $('ucLv').textContent = isHero(u) ? 'Lv.' + u.lv : DMG_N[d.dmg] + '／' + ARM_N[d.arm];
  const mh = mhpOf(u), r = Math.max(0, u.hp) / mh;
  $('ucHp').style.width = (r * 100) + '%';
  $('ucHp').parentNode.classList.toggle('low', r <= 0.3);
  $('ucHpT').textContent = Math.max(0, u.hp) + ' / ' + mh + (shieldOf(u) ? '  +' + shieldOf(u) : '');
  const xpRow = $('xpRow');
  if (isHero(u) && u.lv < LV_MAX) {
    xpRow.classList.remove('hide');
    $('ucXp').style.width = (u.exp / XP_NEED(u.lv) * 100) + '%';
    $('ucXpT').textContent = u.exp + ' / ' + XP_NEED(u.lv);
  } else xpRow.classList.add('hide');
  $('ucAtk').textContent = atkOf(u);
  $('ucDef').textContent = defOf(u);
  $('ucMov').textContent = movOf(u);
  $('ucRng').textContent = rngOf(u);
  $('ucType').innerHTML = `<span class="tt">${DMG_N[d.dmg]}</span>攻擊　<span class="tt">${ARM_N[d.arm]}</span>`;
  const t = ter(u.x, u.y);
  const bits = [];
  if (t.def) bits.push('防' + (t.def > 0 ? '+' : '') + t.def);
  if (t.atk) bits.push('攻+' + t.atk);
  if (t.high) bits.push('高地');
  const pas = isHero(u) && u.pas ? SK[u.pas] : null;
  $('ucTer').innerHTML = `${t.n}${bits.length ? '（' + bits.join('・') + '）' : ''}` +
    (d.pass ? `<div class="pass">${d.pass}</div>` : '') +
    (pas ? `<div class="pass"><b class="q${pas.q}">${pas.n}</b>：${pas.d}</div>` : '') +
    (u.st.length ? `<div class="pass">${u.st.map(b2 => ST[b2.id].n + '（' + b2.turns + '）').join('、')}</div>` : '');

  const eq = $('ucEquip');
  if (isHero(u)) {
    eq.classList.remove('hide');
    eq.innerHTML = ['weapon', 'armor', 'trinket'].map(s => {
      const it = u.equip[s];
      return `<div class="eq${it ? ' r' + it.r : ' empty'}">${SLOT_N[s]}　${it ? itemName(it) + ' <span>' + itemStats(it) + '</span>' : '—'}</div>`;
    }).join('');
  } else eq.classList.add('hide');

  buildSkillBar(sel && sel.alive ? sel : u);
}
function hideCard() {
  $('unitCard').classList.add('hide');
  closeSkillBar();
  if (!sel) $('actbar').classList.add('hide');
}

function buildSkillBar(u) {
  const bar = $('skills');
  if (!isHero(u) || u.side !== G.cur || u.acted || G.over) { bar.classList.add('hide'); return; }
  bar.classList.remove('hide');
  bar.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const id = u.act[i];
    if (!id) {
      const e = document.createElement('button');
      e.className = 'sk lock';
      e.title = i < actSlots(u) ? '這個技能欄是空的，去背包裝一個技能' : '第 ' + (i + 1) + ' 個技能欄要 Lv.' + (i === 1 ? 3 : 6) + ' 才會開';
      e.innerHTML = i < actSlots(u) ? '<span>空槽</span><em>去背包裝</em>' : '<span>未解鎖</span><em>Lv' + (i === 1 ? 3 : 6) + '</em>';
      bar.appendChild(e); continue;
    }
    const s = SK[id];
    const b = document.createElement('button');
    const locked = false, cd = u.cds[id] || 0;
    b.className = 'sk' + (skillMode === id ? ' on' : '') + (locked ? ' lock' : '');
    b.className += ' q' + s.q;
    b.innerHTML = `<span>${s.n}</span><em>${cd > 0 ? cd + ' 回合' : 'CD' + s.cd}</em>`;
    b.onpointerenter = () => showSkillTip(u, id, b);
    b.onpointerleave = hideSkillTip;
    // 用 class 而不是 disabled：disabled 的按鈕在瀏覽器裡收不到滑鼠事件，
    // 那樣冷卻中或不是自己回合的時候就看不到技能說明了
    const off = cd > 0 || u.acted || !canAct() || !canSkillU(u);
    if (off) b.classList.add('off');
    b.onclick = () => {
      if (off) return;
      if (skillMode === id) { skillMode = null; drawRanges(); buildSkillBar(u); return; }
      skillMode = id; phase = 'skill'; drawRanges(); buildSkillBar(u);
      toast(s.n + '：' + s.d);
    };
    bar.appendChild(b);
  }
}
// 把技能的比例換算成「百分比／實際值」，滑鼠移上去會浮出來
function skillInfo(u, id) {
  const s = SK[id];
  const rows = [];
  if (s.pct) {
    const v = skillAmt(u, s);
    const what = ['heal', 'healAoe', 'shield', 'aura', 'domain'].includes(s.k) ? '治療／護盾' : '傷害';
    rows.push(what + '　<b>' + Math.round(s.pct * 100) + '%</b> ／ 實際 <b>' + v + '</b>');
  }
  if (s.atkPct) rows.push('攻擊　<b>+' + Math.round(s.atkPct * 100) + '%</b> ／ 實際 <b>+' +
    Math.round(atkOf(u) * s.atkPct) + '</b>');
  if (s.defPct) rows.push('防禦　<b>' + (s.defPct > 0 ? '+' : '') + Math.round(s.defPct * 100) +
    '%</b> ／ 實際 <b>' + (s.defPct > 0 ? '+' : '') + Math.round(Math.max(1, defOf(u)) * s.defPct) + '</b>');
  if (s.rng !== undefined) rows.push('射程　<b>' + skRng(u, s) + '</b> 格' + (s.rng === 0 ? '（跟著自身射程）' : ''));
  if (s.r) rows.push('範圍　目標周圍 <b>' + s.r + '</b> 格（正方形）');
  if (s.turns) rows.push('持續　<b>' + s.turns + '</b> 回合');
  if (s.cd) rows.push('冷卻　<b>' + s.cd + '</b> 回合');
  if (s.st) for (const e of s.st) rows.push('附加　<b>' + ST[e.id].n + '</b>' + (e.pct ? ' ' + Math.round(e.pct*100) + '%' : '') + (e.turns ? ' / ' + e.turns + ' 回合' : ''));
  return '<h5 class="q' + s.q + '">' + s.n + '<em>' + QN[s.q] + '</em></h5><p>' + s.d + '</p>' +
    rows.map(r => '<div class="sr">' + r + '</div>').join('');
}
function showSkillTip(u, id, el) {
  const t = $('skillTip');
  t.innerHTML = skillInfo(u, id);
  t.classList.remove('hide');
  const r = el.getBoundingClientRect();
  t.style.left = Math.max(8, Math.min(uiW() - t.offsetWidth - 8, r.left / uiK() + r.width / uiK() / 2 - t.offsetWidth / 2)) + 'px';
  t.style.top = (r.top / uiK() - t.offsetHeight - 10) + 'px';
}
const hideSkillTip = () => $('skillTip').classList.add('hide');

function closeSkillBar() { skillMode = null; $('skills').classList.add('hide'); }

/* ── 戰鬥預測 ── */
function showForecast(a, d, fromX, fromY) {
  const el = $('forecast');
  el.classList.remove('hide');
  const bx = a.x, by = a.y;
  if (fromX !== undefined) { a.x = fromX; a.y = fromY; }
  try {
    if (d.side === a.side) {
      $('fcTitle').textContent = '治療預測';
      $('fcA').className = 'heal';
      $('fcA').textContent = '+' + Math.min(healAmt(a), mhpOf(d) - d.hp);
      $('fcAName').textContent = '回復';
      $('fcBName').textContent = '目標';
      $('fcB').className = 'safe';
      $('fcB').textContent = d.hp + ' / ' + mhpOf(d);
      $('fcNote').textContent = '';
      return;
    }
    $('fcTitle').textContent = '戰鬥預測';
    const dm = dmgCalc(a, d, {});
    const fm = flankMult(a, d);
    $('fcAName').textContent = nameOf(a);
    $('fcA').className = 'dmg';
    $('fcA').textContent = dm;
    const cc = canCounter(a, d);
    $('fcBName').textContent = nameOf(d) + ' 反擊';
    if (cc && d.hp > dm) { $('fcB').className = 'dmg'; $('fcB').textContent = dmgCalc(d, a, {}); }
    else { $('fcB').className = 'safe'; $('fcB').textContent = d.hp <= dm ? '（會倒下）' : '不會反擊'; }
    const note = [];
    if (fm !== FLANK.front) note.push(flankName(fm) + ' ×' + fm);
    if (BEATS[dmgType(a)] === armType(d)) note.push(DMG_N[dmgType(a)] + '剋' + ARM_N[armType(d)] + ' ×1.5');
    if (ter(a.x, a.y).high && !ter(d.x, d.y).high) note.push('高地 +' + HIGH_GROUND);
    note.push(d.hp <= dm ? '★ 一擊必殺' : '還需 ' + Math.ceil(d.hp / dm) + ' 下');
    $('fcNote').innerHTML = note.join('　');
  } finally { a.x = bx; a.y = by; }
}
function hideForecast() { $('forecast').classList.add('hide'); }

/* ── 日誌 / 提示 ── */
const logs = [];
function log(html) {
  logs.push(html);
  if (logs.length > 80) logs.shift();
  const el = $('log');
  el.innerHTML = logs.map(l => '<div>' + l + '</div>').join('');
  el.scrollTop = el.scrollHeight;
}
let toastT = null;
function toast(msg) {
  const el = $('toast');
  el.innerHTML = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2800);
}

function dimDone() {
  for (const u of G.units) {
    if (!u.alive || !u.view) continue;
    const dim = u.side === G.cur && u.moved && u.acted;
    u.view.g.traverse(c => {
      if ((c.isMesh || c.isSkinnedMesh) && c.userData.base)
        c.material.color.copy(c.userData.base).multiplyScalar(dim ? 0.5 : 1);
    });
    u.view.ring.material.opacity = dim ? 0.22 : 0.85;
    u.view.ring.material.color.setHex(u.side === 2 && !u.awake ? 0x6b6f7d : SIDE_COL[u.side]);
    updTag(u);
  }
}

/* ── 小地圖 ── */
let mmCtx = null;
const MM = 4;
function drawMinimap() {
  const cv = $('mm');
  if (!mmCtx) { cv.width = W * MM; cv.height = H * MM; mmCtx = cv.getContext('2d'); }
  const g = mmCtx;
  g.clearRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.fillStyle = '#' + TER[MAP[y][x]].col.toString(16).padStart(6, '0');
    g.fillRect(x * MM, y * MM, MM, MM);
  }
  for (const c of CHESTS) if (!c.opened) { g.fillStyle = c.gold ? '#ffd75e' : '#d09a54'; g.fillRect(c.x * MM, c.y * MM, MM, MM); }
  for (const u of alive()) {
    g.fillStyle = SIDE_CSS[u.side];
    const s = u.side === 2 ? MM : MM + 2;
    g.fillRect(u.x * MM - (s - MM) / 2, u.y * MM - (s - MM) / 2, s, s);
  }
  g.strokeStyle = '#fff8'; g.lineWidth = 1;
  const cx = camTarget.x / TILE + (W - 1) / 2, cy = camTarget.z / TILE + (H - 1) / 2;
  const rad = camDist / TILE * 0.42;
  g.strokeRect((cx - rad) * MM, (cy - rad) * MM, rad * 2 * MM, rad * 2 * MM);
}

/* ── 背包：角色牌 + 裝備欄 + 技能欄 + 屬性點，兩個分頁，可依角色篩選 ── */

let bagTab = 'gear';     // 背包分頁：裝備 / 技能
let bagFilter = null;    // 只看某個角色能用的東西（uid），null = 全部
let bagSkSlot = null;    // 目前選中的技能欄 {uid, slot}（slot 0~2 或 'p'）
let bagSlot = null;      // 目前選中的裝備欄 {uid, slot}
let bagDrag = null;      // 正在從背包拖出來的裝備
let dragOff = null;      // 正在從角色身上拖下來的裝備 {uid, slot}

const bagSide = () => (mode === 'online' ? myTeam : playerSide());

// 線上模式自己的隊伍隨時都能整理；本機模式輪到誰才整理誰
const canManage = () => (mode === 'online' ? !G.over : canAct());

// 每個「欄位」一回合只能換一次
function canSwap(u, kind, slot, quiet) {
  if (!canManage()) {
    if (!quiet) toast(mode === 'online' ? '這局已經結束了' : '現在不是你的回合');
    return false;
  }
  const used = kind === 'eq' ? u.swapEq[slot] : u.swapSk[slot];
  if (used) {
    if (!quiet) toast(nameOf(u) + ' 的' + slotName(kind, slot) + '這回合已經換過了');
    return false;
  }
  return true;
}
const slotName = (kind, slot) =>
  kind === 'eq' ? SLOT_N[slot] + '欄'
    : slot === 'p' ? '被動技能欄' : '第 ' + (slot + 1) + ' 個技能欄';

/* ── 開關 ── */

function openBag() {
  const el = $('bagOv');
  el.classList.remove('hide');
  bagSlot = null; bagDrag = null;
  G.news[bagSide()] = 0;                  // 看過了就把驚嘆號收起來
  renderBag();
  refreshBadge();
  setTimeout(() => el.classList.add('on'), 16);
}
function closeBag() {
  const el = $('bagOv');
  el.classList.remove('on');
  setTimeout(() => el.classList.add('hide'), 260);
}
function bagOpen() { return !$('bagOv').classList.contains('hide'); }

function bindBagTabs() {
  document.querySelectorAll('#bagTabs .bt').forEach(b => {
    b.onclick = () => { setBagTab(b.dataset.tab); renderBag(); };
  });
}
function setBagTab(tab) { bagTab = tab; if (tab === 'gear') bagSkSlot = null; else bagSlot = null; }

/* ── 整體重畫 ── */

function renderBag() {
  const side = bagSide();
  renderBagFilter(side);
  renderBagCards(side);
  renderBagList(side);
  document.querySelectorAll('#bagTabs .bt').forEach(b => b.classList.toggle('on', b.dataset.tab === bagTab));
  updateBagHint();
}

// 上面那排：全部 + 每個角色的頭像
function renderBagFilter(side) {
  const box = $('bagFilter');
  box.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'bfb' + (bagFilter === null ? ' on' : '');
  all.textContent = '全部';
  all.onclick = () => { bagFilter = null; renderBag(); };
  box.appendChild(all);
  for (const u of G.units.filter(o => o.side === side && isHero(o))) {
    const b = document.createElement('button');
    b.className = 'bfb pic' + (bagFilter === u.id ? ' on' : '');
    b.title = nameOf(u);
    b.innerHTML = `<img src="${PORTRAIT[u.cls]}" alt="">`;
    b.onclick = () => { bagFilter = (bagFilter === u.id ? null : u.id); renderBag(); };
    box.appendChild(b);
  }
}

function updateBagHint() {
  $('bagHint').textContent = bagTab === 'skill'
    ? (bagSkSlot
        ? '已選 ' + nameOf(byId(bagSkSlot.uid)) + ' 的' +
          (bagSkSlot.slot === 'p' ? '被動' : '第 ' + (bagSkSlot.slot + 1) + ' 個') + '技能欄，點下面的技能書裝上'
        : '先點一個角色的技能欄，再點技能書。雙擊技能欄可以卸下')
    : bagSlot
      ? '已選 ' + nameOf(byId(bagSlot.uid)) + ' 的' + SLOT_N[bagSlot.slot] + '欄，點下面的裝備裝上'
      : '把裝備拖到角色身上，或先點一個裝備欄再點裝備';
  document.querySelectorAll('#bagCards .eslot').forEach(e => {
    const c = e.closest('.hcard');
    e.classList.toggle('pick', !!bagSlot && +c.dataset.uid === bagSlot.uid && e.dataset.slot === bagSlot.slot);
  });
}

/* ── 角色牌 ── */

function renderBagCards(side) {
  const box = $('bagCards');
  box.innerHTML = '';
  G.units.filter(u => u.side === side).forEach((u, i) => {
    const card = buildCard(u);
    card.style.animationDelay = (i * 45) + 'ms';
    box.appendChild(card);
  });
}

// 只重畫一張卡：換裝備的時候別讓整排都重播進場動畫
function refreshCard(u) {
  const old = document.querySelector('#bagCards .hcard[data-uid="' + u.id + '"]');
  if (!old) return;
  const card = buildCard(u);
  card.classList.add('flash');            // 換好了在這張卡上閃一下當回饋
  old.replaceWith(card);
}

function slotsHTML(u) {
  return ['weapon', 'armor', 'trinket'].map(sl => {
    const it = u.equip[sl];
    const on = bagSlot && bagSlot.uid === u.id && bagSlot.slot === sl;
    const used = u.swapEq[sl] ? ' used' : '';
    return `<div class="eslot${on ? ' pick' : ''}${used}${it ? ' r' + it.r : ''}" data-slot="${sl}"
        ${it ? 'draggable="true"' : ''} title="${it ? '雙擊卸下，或拖回背包' : ''}">
        <span class="es-l">${SLOT_N[sl]}</span>
        <span class="es-n">${it ? itemName(it) : '—'}</span>
        <span class="es-s">${it ? itemStats(it) : ''}</span>
      </div>`;
  }).join('');
}

// 三個主動槽 + 一個圓形的被動槽
function skillSlotsHTML(u) {
  const n = actSlots(u);
  let h = '';
  for (let i = 0; i < 3; i++) {
    const id = u.act[i], s = id ? SK[id] : null;
    const lock = i >= n, on = bagSkSlot && bagSkSlot.uid === u.id && bagSkSlot.slot === i;
    const used = u.swapSk[i] ? ' used' : '';
    h += `<div class="bsk${lock ? ' lock' : ''}${on ? ' pick' : ''}${used}${s ? ' q' + s.q : ''}" data-slot="${i}"
        title="${s ? s.d : ''}"><b>${lock ? '未解鎖' : s ? s.n : '空槽'}</b>
        <em>${lock ? 'Lv' + (i === 1 ? 3 : 6) : s ? 'CD' + s.cd : '點我裝技能'}</em></div>`;
  }
  const p = u.pas ? SK[u.pas] : null, plock = !hasPasSlot(u);
  const pon = bagSkSlot && bagSkSlot.uid === u.id && bagSkSlot.slot === 'p';
  h += `<div class="bsk pas${plock ? ' lock' : ''}${pon ? ' pick' : ''}${u.swapSk.p ? ' used' : ''}${p ? ' q' + p.q : ''}" data-slot="p"
      title="${p ? p.n + '：' + p.d : '被動技能槽（Lv.4 解鎖）'}">
      <b>${plock ? 'Lv4' : p ? p.n : '被動'}</b></div>`;
  return h;
}

// 自由屬性點：有點數才展開加號
function ptsHTML(u) {
  const rows = ['atk', 'def', 'hp'].map(k =>
    `<button class="ptb" data-k="${k}" ${u.pts > 0 ? '' : 'disabled'}>
      ${PT_N[k]} +${PT_GAIN[k]}<em>${u.alloc[k]}</em></button>`).join('');
  return `<div class="hc-pts${u.pts > 0 ? ' has' : ''}">
      <span class="ptl">屬性點 <b>${u.pts}</b></span>${rows}</div>`;
}

function buildCard(u) {
  const card = document.createElement('div');
  const lit = bagFilter === u.id;
  card.className = 'hcard' + (u.alive ? '' : ' down') + (lit ? ' lit' : '') +
    (bagFilter !== null && !lit ? ' dim' : '');
  card.dataset.uid = u.id;
  const r = u.alive ? Math.max(0, u.hp) / mhpOf(u) : 0;
  const xp = u.lv < LV_MAX ? u.exp / XP_NEED(u.lv) : 1;

  card.innerHTML = `
    <div class="hc-top">
      <img class="hc-face" src="${PORTRAIT[u.cls]}" alt="">
      <span class="hc-name">${nameOf(u)}</span>
      <span class="hc-lv">${u.alive ? 'Lv.' + u.lv : u.down + ' 回合後復活'}</span>
      <button class="hc-auto" title="自動裝上最好的裝備和技能">一鍵</button>
    </div>
    <div class="hc-bar"><i style="width:${r * 100}%"></i></div>
    <div class="hc-xp" title="經驗值"><i style="width:${xp * 100}%"></i>
      <span>${u.lv < LV_MAX ? u.exp + ' / ' + XP_NEED(u.lv) : '已滿級'}</span></div>
    <div class="hc-stat">攻 ${atkOf(u)}　防 ${defOf(u)}　移 ${movOf(u)}　射 ${rngOf(u)}</div>
    ${ptsHTML(u)}
    <div class="hc-slots">${slotsHTML(u)}</div>
    <div class="hc-skl">${skillSlotsHTML(u)}</div>`;

  card.querySelector('.hc-auto').onclick = ev => { ev.stopPropagation(); autoGear(u); };

  // 屬性點
  card.querySelectorAll('.ptb').forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); doSpend(u, b.dataset.k); };
  });

  // 裝備欄：點＝選起來，雙擊或拖回背包＝卸下
  card.querySelectorAll('.eslot').forEach(e => {
    const sl = e.dataset.slot;
    e.onclick = ev => {
      ev.stopPropagation();
      bagSlot = (bagSlot && bagSlot.uid === u.id && bagSlot.slot === sl) ? null : { uid: u.id, slot: sl };
      setBagTab('gear');
      renderBag();
    };
    e.ondblclick = ev => { ev.stopPropagation(); doUnequip(u, sl); };
    e.addEventListener('dragstart', ev => {
      if (!u.equip[sl]) { ev.preventDefault(); return; }
      ev.stopPropagation();
      bagDrag = null;
      dragOff = { uid: u.id, slot: sl };
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', 'off');
      $('bagPanel').classList.add('dropzone');
    });
    e.addEventListener('dragend', () => {
      dragOff = null;
      $('bagPanel').classList.remove('dropzone', 'drop');
    });
  });

  // 技能欄
  card.querySelectorAll('.bsk').forEach(e => {
    if (e.classList.contains('lock')) return;
    const sl = e.dataset.slot === 'p' ? 'p' : +e.dataset.slot;
    e.onclick = ev => {
      ev.stopPropagation();
      bagSkSlot = (bagSkSlot && bagSkSlot.uid === u.id && bagSkSlot.slot === sl) ? null : { uid: u.id, slot: sl };
      setBagTab('skill');
      renderBag();
    };
    e.ondblclick = ev => { ev.stopPropagation(); doSetSkill(u, sl, 0); };
    const id = sl === 'p' ? u.pas : u.act[sl];
    if (id) {
      e.onpointerenter = () => showSkillTip(u, id, e);
      e.onpointerleave = hideSkillTip;
    }
  });

  // 拖曳落點：整張卡都收，欄位型別對不上就不給綠框
  const ok = () => bagDrag && u.alive && canUse(u, bagDrag);
  card.addEventListener('dragover', ev => {
    if (!ok()) return;
    ev.preventDefault();
    const e = ev.target.closest('.eslot');
    card.classList.add('drop');
    card.querySelectorAll('.eslot').forEach(x => x.classList.remove('drop'));
    if (e && e.dataset.slot === bagDrag.slot) e.classList.add('drop');
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drop');
    card.querySelectorAll('.eslot').forEach(x => x.classList.remove('drop'));
  });
  card.addEventListener('drop', ev => {
    ev.preventDefault();
    card.classList.remove('drop');
    if (!ok()) return;
    doEquip(u, bagDrag);
    bagDrag = null;
  });
  return card;
}

/* ── 下面那格：裝備分頁 / 技能分頁 ── */

function renderBagList(side) {
  if (bagTab === 'skill') { renderSkillList(side); renderOrbs(side, 'skill'); }
  else { renderGearList(side); renderOrbs(side, 'gear'); }
}

// 篩選中的角色用不到的東西就不顯示
const filterUnit = () => (bagFilter === null ? null : byId(bagFilter));

function renderGearList(side) {
  const box = $('bagList');
  const who = filterUnit();
  const bag = G.bag[side].filter(it => !who || canUse(who, it));
  box.innerHTML = '';

  // 從角色身上拖下來的裝備，丟回背包面板就是卸下
  const panel = $('bagPanel');
  panel.ondragover = ev => { if (dragOff) { ev.preventDefault(); panel.classList.add('drop'); } };
  panel.ondragleave = () => panel.classList.remove('drop');
  panel.ondrop = ev => {
    ev.preventDefault();
    panel.classList.remove('drop', 'dropzone');
    if (dragOff) { doUnequip(byId(dragOff.uid), dragOff.slot); dragOff = null; }
  };

  if (!bag.length) {
    box.innerHTML = who
      ? `<div class="empty">背包裡沒有 ${nameOf(who)} 能用的裝備。</div>`
      : '<div class="empty">背包是空的。打怪和開寶箱會掉裝備。</div>';
    return;
  }
  bag.slice().sort((a, b) => b.r - a.r || a.slot.localeCompare(b.slot)).forEach(it => {
    const d = document.createElement('div');
    d.className = 'item r' + it.r;
    d.draggable = true;
    const af = it.affix ? AFFIX.find(x => x.id === it.affix) : null;
    const only = useHint(it);
    d.innerHTML = `<div class="in">${itemName(it)}
        <span class="sl">${RARITY[it.r].n} · ${SLOT_N[it.slot]}${only ? ' · ' + only : ''}</span></div>
      <div class="is">${itemStats(it)}${af ? '　<em>' + af.d + '</em>' : ''}</div>
      <button class="dis" title="分解成裝備精球">分解</button>`;
    d.querySelector('.dis').onclick = ev => { ev.stopPropagation(); doScrap(side, it.iid); };
    d.addEventListener('dragstart', ev => {
      bagDrag = it;
      d.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(it.iid));
      $('bagOv').classList.add('dragging');
    });
    d.addEventListener('dragend', () => {
      d.classList.remove('dragging');
      $('bagOv').classList.remove('dragging');
      document.querySelectorAll('.hcard.drop,.eslot.drop').forEach(x => x.classList.remove('drop'));
      bagDrag = null;
    });
    d.onclick = () => {
      // 先選了欄位就裝到那裡，其次是篩選中的角色，再其次是場上選中的單位
      let u = bagSlot ? byId(bagSlot.uid) : (who || (sel && sel.side === side && isHero(sel) ? sel : null));
      if (bagSlot && bagSlot.slot !== it.slot) { toast('這件是' + SLOT_N[it.slot] + '，欄位對不上'); return; }
      if (!u) { toast('先點一個角色的裝備欄，或用上面的頭像挑角色'); return; }
      doEquip(u, it);
    };
    box.appendChild(d);
  });
}

// 技能類型標籤
const K_LABEL = {
  passive: '被動', single: '單體', multi: '連擊', fan: '扇形', cross: '十字', around: '周圍',
  line: '直線', aoe: '範圍', pick: '散射', wave: '波狀', charge: '衝鋒', delayed: '延遲',
  teleport: '位移', retreat: '撤退', refreshSelf: '再動', refreshAlly: '再動', trap: '陷阱',
  trapN: '陷阱', heal: '治療', healAoe: '群療', aura: '光環', shield: '護盾',
  buffSelf: '自強', buffAlly: '增益', buffAround: '團隊', domain: '領域', raise: '復活'
};
const skClsTag = id => {
  const s = SK[id];
  if (s.c) return CLS[s.c].n + '專用';
  const g = { melee: '近戰', range: '遠程', sup: '輔助', all: '通用' };
  return s.u.split(',').map(x => g[x]).join('／');
};

function renderSkillList(side) {
  const box = $('bagList');
  const who = filterUnit();
  const books = G.books[side].filter(b => !who || skCanUse(who.cls, b.id));
  box.innerHTML = '';
  if (!books.length) {
    box.innerHTML = who
      ? `<div class="empty">沒有 ${nameOf(who)} 學得會的技能書。</div>`
      : '<div class="empty">還沒有技能書。打怪和開寶箱有機會掉，精球也能合成。</div>';
    return;
  }
  const target = bagSkSlot ? byId(bagSkSlot.uid) : null;
  books.slice().sort((a, b) => SK[b.id].q - SK[a.id].q || a.id.localeCompare(b.id)).forEach(bk => {
    const s = SK[bk.id];
    const fit = !target || (skCanUse(target.cls, bk.id) &&
      (bagSkSlot.slot === 'p' ? skIsPassive(bk.id) : !skIsPassive(bk.id)));
    const d = document.createElement('div');
    d.className = 'item book q' + s.q + (fit ? '' : ' bad');
    d.innerHTML = `<div class="in">${s.n}<i class="kt${skIsPassive(bk.id) ? ' pas' : ''}">${K_LABEL[s.k] || ''}</i>
        <span class="sl">${QN[s.q]} · ${skClsTag(bk.id)}</span></div>
      <div class="is">${s.d}</div>
      <button class="dis" title="分解成技能精球">分解</button>`;
    d.querySelector('.dis').onclick = ev => { ev.stopPropagation(); doDismantle(side, bk.bid); };
    d.onclick = () => {
      if (!bagSkSlot) { toast('先點一個角色的技能欄'); return; }
      doSetSkill(byId(bagSkSlot.uid), bagSkSlot.slot, bk.bid);
    };
    box.appendChild(d);
  });
}

// 精球列：技能分頁看技能精球，裝備分頁看裝備精球
function renderOrbs(side, which) {
  const box = $('bagOrbs');
  const orbs = which === 'skill' ? G.orbs[side] : G.gorbs[side];
  const label = which === 'skill' ? '技能精球' : '裝備精球';
  box.innerHTML = `<span class="ol">${label}</span>` + [0, 1, 2, 3, 4].map(q =>
    `<span class="orb q${q}" title="${QN[q]}">${orbs[q]}</span>`).join('') +
    '<span class="oh">三顆 → 高一階</span>';
  for (let q = 0; q < 4; q++) {
    const b = document.createElement('button');
    b.className = 'ob q' + (q + 1);
    b.textContent = '合成' + QN[q + 1];
    b.disabled = orbs[q] < 3 || !canManage();
    b.onclick = () => (which === 'skill' ? doCraft(side, q) : doCraftItem(side, q));
    box.appendChild(b);
  }
  if (which === 'gear') {
    const sep = document.createElement('span');
    sep.className = 'oh';
    sep.textContent = '批量分解';
    box.appendChild(sep);
    for (const [r, n] of [[0, '白'], [1, '白＋綠']]) {
      const b = document.createElement('button');
      b.className = 'ob scrap';
      b.textContent = n;
      b.disabled = !canManage();
      b.onclick = () => doScrapAll(side, r);
      box.appendChild(b);
    }
  }
}

/* ── 一鍵裝備：挑背包裡最好的裝備和技能自動裝上 ── */

// 換算成「點」來比大小，跟 skills.md 裡配裝備數值用的是同一把尺
const PT_W = { atk: 2, def: 2, hp: 0.4, mov: 4, rng: 8 };
function itemScore(it) {
  if (!it) return -1;
  let v = 0;
  for (const k in PT_W) if (it[k]) v += it[k] * PT_W[k];
  if (it.affix) v += 3;
  return v;
}

function autoGear(u, quiet) {
  if (!u || !isHero(u) || !u.alive) return 0;
  const side = u.side;
  let n = 0;

  // 裝備：每個欄位挑背包裡分數最高、而且比身上這件好的
  for (const sl of ['weapon', 'armor', 'trinket']) {
    if (u.swapEq[sl]) continue;
    let best = null, bs = itemScore(u.equip[sl]);
    for (const it of G.bag[side]) {
      if (it.slot !== sl || !canUse(u, it)) continue;
      const sc = itemScore(it);
      if (sc > bs) { bs = sc; best = it; }
    }
    if (best && doEquip(u, best, 1)) n++;
  }

  // 主動技能：空槽先補，有技能的話品質更高才換
  for (let i = 0; i < actSlots(u); i++) {
    if (u.swapSk[i]) continue;
    const cur = u.act[i] ? SK[u.act[i]].q : -1;
    let best = null;
    for (const b of G.books[side]) {
      if (skIsPassive(b.id) || !skCanUse(u.cls, b.id)) continue;
      if (u.act.includes(b.id)) continue;
      if (SK[b.id].q <= cur) continue;
      if (!best || SK[b.id].q > SK[best.id].q) best = b;
    }
    if (best && doSetSkill(u, i, best.bid, 1)) n++;
  }

  // 被動技能
  if (hasPasSlot(u) && !u.swapSk.p) {
    const cur = u.pas ? SK[u.pas].q : -1;
    let best = null;
    for (const b of G.books[side]) {
      if (!skIsPassive(b.id) || !skCanUse(u.cls, b.id)) continue;
      if (SK[b.id].q <= cur) continue;
      if (!best || SK[b.id].q > SK[best.id].q) best = b;
    }
    if (best && doSetSkill(u, 'p', best.bid, 1)) n++;
  }

  if (!quiet) toast(n ? `<b>${nameOf(u)}</b> 換上了 ${n} 樣東西` : nameOf(u) + ' 沒有更好的可以換');
  return n;
}

function autoGearAll() {
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const side = bagSide();
  let n = 0;
  for (const u of G.units) if (u.side === side && isHero(u)) n += autoGear(u, 1);
  toast(n ? `全隊換上了 <b>${n}</b> 樣東西` : '沒有更好的裝備或技能可以換了');
  if (bagOpen()) renderBag();
}

/* ── 所有會改到狀態的操作，都走同一條連線通道 ── */

function sendAct(a) {
  if (mode === 'online') netSend({ t: 'act', a });
  return true;
}

function doEquip(u, it, quiet) {
  if (!canUse(u, it)) { if (!quiet) toast(nameOf(u) + ' 用不了' + it.n + '（限 ' + useHint(it) + '）'); return false; }
  if (!u.alive) { if (!quiet) toast(nameOf(u) + ' 還倒著，等他站起來'); return false; }
  if (!canSwap(u, 'eq', it.slot, quiet)) return false;
  const a = { kind: 'equip', uid: u.id, iid: it.iid };
  sendAct(a); applyEquip(a);
  return true;
}
function applyEquip(a) {
  const u = byId(a.uid);
  if (!u) return;
  const it = G.bag[u.side].find(x => x.iid === a.iid);
  if (!it) return;
  equip(u, it);
  u.swapEq[it.slot] = 1;   // 只有裝上去才算用掉這一格的機會
  bagSlot = null;
  afterBagChange(u);
}

// 卸下不算一次換裝：把那一格的次數還回去，這回合還能重新裝一件
function doUnequip(u, slot) {
  if (!u.equip[slot]) return;
  if (!canManage()) { toast(mode === 'online' ? '這局已經結束了' : '現在不是你的回合'); return; }
  const a = { kind: 'unequip', uid: u.id, slot };
  sendAct(a); applyUnequip(a);
}
function applyUnequip(a) {
  const u = byId(a.uid);
  if (!u || !u.equip[a.slot]) return;
  const it = u.equip[a.slot];
  unequip(u, a.slot);
  u.swapEq[a.slot] = 0;
  log(`<b>${nameOf(u)}</b> 卸下了 ${itemName(it)}`);
  bagSlot = null;
  afterBagChange(u);
}

function doSetSkill(u, slot, bid, quiet) {
  if (!u || !isHero(u)) return false;
  // 卸下（bid = 0）不算一次
  if (bid) { if (!canSwap(u, 'sk', slot, quiet)) return false; }
  else if (!canManage()) { if (!quiet) toast('現在不是你的回合'); return false; }
  const a = { kind: 'skset', uid: u.id, slot, bid: bid || 0 };
  sendAct(a); applySetSkill(a);
  return true;
}
function applySetSkill(a) {
  const u = byId(a.uid);
  if (!u) return;
  const side = u.side;
  const old = a.slot === 'p' ? u.pas : u.act[a.slot];
  if (a.bid) {
    const i = G.books[side].findIndex(b => b.bid === a.bid);
    if (i < 0) return;
    if (!setSkill(u, a.slot, G.books[side][i].id)) return;
    G.books[side].splice(i, 1);
  } else {
    if (!old) return;
    if (a.slot === 'p') u.pas = null; else u.act[a.slot] = null;
  }
  // 換下來的技能退回背包，冷卻不重置（u.cds 照 id 記著，繼續走）
  if (old) G.books[side].push({ bid: ++bookSeq, id: old });
  u.swapSk[a.slot] = a.bid ? 1 : 0;   // 卸下等於把次數還回去
  bagSkSlot = null;
  if (sel) buildSkillBar(sel);
  afterBagChange(u);
}

function doSpend(u, k) {
  if (u.pts <= 0) return;
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const a = { kind: 'spend', uid: u.id, k };
  sendAct(a); applySpend(a);
}
function applySpend(a) {
  const u = byId(a.uid);
  if (!u || u.pts <= 0) return;
  u.pts--;
  u.alloc[a.k]++;
  if (a.k === 'hp') u.hp += PT_GAIN.hp;
  floatText(u.x, u.y, PT_N[a.k] + ' +' + PT_GAIN[a.k], 'up');
  afterBagChange(u);
}

function doDismantle(side, bid) {
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const a = { kind: 'skdis', side, bid };
  sendAct(a); applyDismantle(a);
}
function applyDismantle(a) { dismantle(a.side, a.bid); afterBagChange(null); }

function doCraft(side, q) {
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const a = { kind: 'skcraft', side, q };
  sendAct(a); applyCraft(a);
}
function applyCraft(a) { craft(a.side, a.q); afterBagChange(null); }

function doScrap(side, iid) {
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const a = { kind: 'gdis', side, iid };
  sendAct(a); applyScrap(a);
}
function applyScrap(a) { scrapItem(a.side, a.iid); afterBagChange(null); }

function doScrapAll(side, maxR) {
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const a = { kind: 'gdisall', side, maxR };
  sendAct(a); applyScrapAll(a);
}
function applyScrapAll(a) { scrapAll(a.side, a.maxR); afterBagChange(null); }

function doCraftItem(side, r) {
  if (!canManage()) { toast('現在不是你的回合'); return; }
  const a = { kind: 'gcraft', side, r };
  sendAct(a); applyCraftItem(a);
}
function applyCraftItem(a) { craftItem(a.side, a.r); afterBagChange(null); }

// 改完之後只重畫該重畫的：帶了角色就只換那一張卡，其他卡不動
function afterBagChange(u) {
  if (u) { updTag(u); if (sel === u) showCard(u); }
  refreshRoster();
  refreshBadge();
  if (!bagOpen()) return;
  if (u) refreshCard(u); else renderBagCards(bagSide());
  renderBagList(bagSide());
  updateBagHint();
}

/* ── 相機 ──
   所有鏡頭位移都走 moveCam()：固定 0.5 秒、先快後慢（easeOutCubic）。 */
const CAM_MS = 500;
const easeOut = k => 1 - Math.pow(1 - k, 3);
function clampCam() {
  const hx = W * TILE / 2, hz = H * TILE / 2;
  camTarget.x = Math.max(-hx, Math.min(hx, camTarget.x));
  camTarget.z = Math.max(-hz, Math.min(hz, camTarget.z));
}
let camJob = 0;
function moveCam(x, y, az) {
  const job = ++camJob;
  const x0 = camTarget.x, z0 = camTarget.z, a0 = camAz;
  let x1 = wx(x), z1 = wz(y);
  const hx = W * TILE / 2, hz = H * TILE / 2;
  x1 = Math.max(-hx, Math.min(hx, x1));
  z1 = Math.max(-hz, Math.min(hz, z1));
  let da = 0;
  if (az !== undefined) {
    da = az - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
  }
  if (Math.abs(x1 - x0) < 0.05 && Math.abs(z1 - z0) < 0.05 && !da) return Promise.resolve();
  return tween(CAM_MS, k => {
    if (job !== camJob) return;                       // 有新的鏡頭指令就讓位
    const e = easeOut(k);
    camTarget.x = x0 + (x1 - x0) * e;
    camTarget.z = z0 + (z1 - z0) * e;
    if (da) camAz = a0 + da * e;
    updCam();
  });
}
const lookAt = (x, y) => moveCam(x, y);
function flipCam(az) { return moveCam(camTarget.x / TILE + (W - 1) / 2, camTarget.z / TILE + (H - 1) / 2, az); }

/* ── 點擊判定 ── */
function pickTile(ev) {
  const m = new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  let best = null, bd = 1e9;
  for (const h of raycaster.intersectObjects(unitGroup.children, true)) {
    let o = h.object;
    while (o) { if (o.userData.uid !== undefined) { const u = byId(o.userData.uid); if (u && u.alive) return [u.x, u.y]; } o = o.parent; }
  }
  for (const im of tilePick) {
    const hits = raycaster.intersectObject(im, false);
    if (hits.length && hits[0].distance < bd) { bd = hits[0].distance; best = im.userData.cells[hits[0].instanceId]; }
  }
  return best;
}

let hoverUnit = null, hover = null;
function onHover(ev) {
  const t = pickTile(ev);
  const moved = !hover || !t || hover[0] !== t[0] || hover[1] !== t[1];
  hover = t;
  const u = t ? unitAt(t[0], t[1]) : null;
  hoverUnit = u;
  if (skillMode && sel && moved) drawRanges();
  if (u) showCard(u);
  else if (sel) showCard(sel);
  else hideCard();

  if (!sel || !u || skillMode || u === sel) { hideForecast(); return; }
  if (u.side === sel.side && !base(sel).healPct) { hideForecast(); return; }
  if (!sel.acted && dist(sel, u) <= rngOf(sel)) showForecast(sel, u);
  else if (!sel.moved && !sel.acted && reach) {
    const s = stopToHit(reach, sel, u.x, u.y);
    if (s) showForecast(sel, u, s[0], s[1]); else hideForecast();
  } else hideForecast();
}

function select(u) {
  sel = u;
  phase = 'sel';
  skillMode = null;
  reach = u.moved ? null : reachOf(u);
  drawRanges(); showCard(u); refreshRoster();
  $('actbar').classList.toggle('hide', u.side !== G.cur || (u.moved && u.acted));
  $('btnUndo').disabled = !preMove || preMove.uid !== u.id;
}
function deselect() {
  sel = null; phase = 'idle'; skillMode = null;
  clearOverlay(); hideCard(); hideForecast();
  $('actbar').classList.add('hide');
  refreshRoster();
}

function send(a) {
  if (mode === 'online') netSend({ t: 'act', a });
  return runAction(a);
}

function onClick(ev) {
  if (!canAct()) return;
  const t = pickTile(ev);
  if (!t) return;
  const [x, y] = t, u = unitAt(x, y);

  // 技能瞄準
  if (skillMode && sel) {
    const s = SK[skillMode];
    const a = { kind: 'skill', uid: sel.id, skill: skillMode, tx: x, ty: y, tid: u ? u.id : -1 };
    const rg = skRng(sel, s), d = dist(sel, { x, y });
    if (K_SELF.includes(s.k)) { skillMode = null; send(a); return; }
    // 治療／護盾／增益可以指自己，其餘不行
    if (d === 0 && !K_ALLY.includes(s.k)) { toast('這個技能不能對自己用'); return; }
    if (d > rg) { toast('超出技能範圍'); return; }
    if ((s.k === 'line' || s.k === 'wave' || s.k === 'charge') && x !== sel.x && y !== sel.y) { toast('這個技能只能打直線'); return; }
    if (K_EMPTY.includes(s.k) && (u || ter(x, y).cost > 90)) { toast('要選空地'); return; }
    if (K_ENEMY.includes(s.k) && (!u || u.side === sel.side)) { toast('要選敵人'); return; }
    if (K_ALLY.includes(s.k) && (!u || u.side !== sel.side)) { toast('要選友軍'); return; }
    skillMode = null;
    send(a);
    return;
  }

  if (phase === 'idle' || !sel) {
    if (u && u.side === G.cur && !(u.moved && u.acted)) select(u);
    else if (u) showCard(u);
    return;
  }

  // 已選單位
  if (u === sel) { deselect(); return; }

  if (u && !sel.acted) {
    const friendly = u.side === sel.side;
    const ok = friendly ? (base(sel).healPct && u.hp < mhpOf(u)) : true;
    if (ok) {
      const kind = friendly ? 'heal' : 'attack';
      if (dist(sel, u) <= rngOf(sel)) { send({ kind, uid: sel.id, tid: u.id, path: null }); return; }
      if (!sel.moved && reach) {
        const s = stopToHit(reach, sel, u.x, u.y);
        if (s) {
          preMove = { uid: sel.id, x: sel.x, y: sel.y };
          send({ kind, uid: sel.id, tid: u.id, path: pathTo(reach, sel, s[0], s[1]) });
          return;
        }
      }
      toast('打不到，先靠近一點');
      return;
    }
  }

  if (!sel.moved && reach && reach.has(x, y)) {
    preMove = { uid: sel.id, x: sel.x, y: sel.y };
    send({ kind: 'move', uid: sel.id, path: pathTo(reach, sel, x, y) });
    return;
  }

  if (u && u.side === G.cur && !(u.moved && u.acted)) { select(u); return; }
  deselect();
}

/* ── 輸入 ── */

// WASD / 方向鍵平移畫面（按著就一直移動，在主迴圈裡推進）
const held = Object.create(null);
const PANKEY = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0],
  arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0] };
function panStep(dt) {
  let fx = 0, fy = 0;
  for (const k in held) {
    if (!held[k] || !PANKEY[k]) continue;
    fx += PANKEY[k][0]; fy += PANKEY[k][1];
  }
  if (!fx && !fy) return;
  const sp = (camDist * 0.85 + 10) * Math.min(dt, 0.05) * (SET.panSpeed / 100);
  camTarget.x += (Math.cos(camAz) * fx + Math.sin(camAz) * fy) * sp;
  camTarget.z += (-Math.sin(camAz) * fx + Math.cos(camAz) * fy) * sp;
  clampCam(); updCam();
}

function bindInput() {
  const el = renderer.domElement;
  let down = null, dragged = false;

  el.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, btn: e.button, az: camAz, el: camEl };
    dragged = false;
  });
  addEventListener('pointermove', e => {
    if (!down) { if (!busy) onHover(e); return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
    if (!dragged) return;
    // 拖曳一律是轉視角，平移交給 WASD
    camAz = down.az - dx * 0.008;
    camEl = Math.max(0.30, Math.min(1.45, down.el + dy * 0.006));
    updCam();
  });
  addEventListener('pointerup', e => {
    if (down && !dragged && e.target === el) onClick(e);
    down = null;
  });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    camDist = Math.max(10, Math.min(70, camDist + Math.sign(e.deltaY) * 2.2 * (SET.zoomSpeed / 100)));
    updCam();
  }, { passive: false });
  el.addEventListener('contextmenu', e => e.preventDefault());

  $('mm').addEventListener('pointerdown', e => {
    const r = e.target.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * W);
    const y = Math.floor((e.clientY - r.top) / r.height * H);
    if (inBoard(x, y)) lookAt(x, y);
  });

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (PANKEY[k]) { held[k] = true; e.preventDefault(); return; }
    if (e.key === 'Escape') { if (skillMode) { skillMode = null; drawRanges(); if (sel) buildSkillBar(sel); } else deselect(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const list = G.units.filter(u => u.alive && u.side === G.cur && !(u.moved && u.acted));
      if (!list.length) return;
      const i = list.indexOf(sel);
      const n = list[(i + 1) % list.length];
      lookAt(n.x, n.y); if (canAct()) select(n);
    }
  });
  addEventListener('keyup', e => { held[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { for (const k in held) held[k] = false; });
}
