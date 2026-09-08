/* ══════════════ 規則與流程 ══════════════ */

let G = {
  units: [], cur: 0, turn: 1, over: null,
  hold: [0, 0],            // 王座連續佔領回合數
  bag: [[], []],           // 兩邊的背包
  seed: 1
};
let sel = null, reach = null, phase = 'idle', busy = false;
let preMove = null, skillMode = null;
let mode = 'local', myTeam = 0;
let uidSeq = 0, itemSeq = 0, wakeSeq = 0;
let grng = mulberry32(1);   // 所有「遊戲邏輯」的亂數，兩邊同步

const byId = i => G.units.find(u => u.id === i);
// u.paused：進競技場時，凡是沒被傳送過去的單位（怪物、沒參賽的英雄）都在主
// 戰場上原地凍結，但座標還留著舊地圖的數字。競技場地圖小，這些數字很容易
// 剛好落在新地圖的範圍內，變成「憑空冒出來的鄰居」害路徑計算和選目標整個亂掉。
// 用一個旗標把它們從所有空間查詢裡完全排除，離開競技場時再解除。
const alive = () => G.units.filter(u => u.alive && !u.paused);
const unitAt = (x, y) => G.units.find(u => u.alive && !u.paused && u.x === x && u.y === y);
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// 遠程／魔法攻擊的視線：兩點連線中間有沒有擋視線的地形（目前只有石頭）。
// 貼身距離（1 格）不用檢查——都站隔壁了，中間不可能還卡著一塊石頭。
// 不用嚴謹的 Bresenham，用比較密的取樣點沿線走一遍，射程本來就只有幾格，
// 這樣算既好驗證又不會漏掉貼著格線走的情況。
function hasLOS(a, b) {
  const d = dist(a, b);
  if (d <= 1) return true;
  const steps = d * 4;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    if (inBoard(x, y) && ter(x, y).block) return false;
  }
  return true;
}
// 近戰站隔壁看不看得到都無所謂；遠程／魔法才需要真的有視線
const canReach = (a, b) => dmgType(a) === 'melee' || hasLOS(a, b);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));   // 正方形距離
const base = u => u.side === 2 ? MON[u.kind] : CLS[u.cls];
const nameOf = u => u.side === 2 ? MON[u.kind].n
  : (u.lv >= PROMO_LV ? CLS[u.cls].pro : CLS[u.cls].n);
const isHero = u => u.side !== 2;
const myTurn = () => mode === 'local' || G.cur === myTeam;
const canAct = () => !busy && !G.over && myTurn();
const chestAt = (x, y) => CHESTS.find(c => !c.opened && c.x === x && c.y === y);

/* ── 數值 ── */

function statOf(u, k) {
  const d = base(u);
  let v = d[k] || 0;
  v += (u.lv - 1) * ((isHero(u) ? LV_GAIN : MON_GAIN)[k] || 0);
  if (isHero(u)) {
    if (u.lv >= PROMO_LV) v += PROMO[k] || 0;
    for (const s in u.equip) { const it = u.equip[s]; if (it && it[k]) v += it[k]; }
    if (hasAffix(u, 'swift') && k === 'mov') v += 2;
  }
  if (isHero(u) && u.alloc && u.alloc[k]) v += u.alloc[k] * PT_GAIN[k];
  for (const b of u.st) if (ST_STAT[b.id] === k) v += b.v;
  if (isHero(u)) {
    if (k === 'hp' && pasOf(u, 'hpPct')) v = Math.round(v * (1 + pasOf(u, 'hpPct')));
    if (k === 'def' && pasOf(u, 'defPct')) v = Math.round(v * (1 + pasOf(u, 'defPct')));
    if (k === 'mov') v += pasOf(u, 'mov');
    if (k === 'rng') v += pasOf(u, 'rng');
  }
  return v;
}
const mhpOf = u => Math.max(1, statOf(u, 'hp'));
function atkOf(u) {
  let v = statOf(u, 'atk');
  // 嗜血：職業本身的 + 被動再疊一份
  const lo = (u.cls === 'BB' ? 1 : 0) + pasOf(u, 'lowHpAtk');
  if (lo) v += Math.floor((1 - u.hp / mhpOf(u)) * 10) * lo;
  if (u.stk) v = Math.round(v * (1 + u.stk));                       // 戰鬥狂熱層數
  return v;
}
// 暴擊率：基礎 + 被動 + 銳利狀態
const critOf = u => CRIT + pasOf(u, 'crit') + stVal(u, 'crit') / 100;
const defOf = u => Math.max(0, statOf(u, 'def'));
const movOf = u => Math.max(1, statOf(u, 'mov'));
function rngOf(u) {
  let v = statOf(u, 'rng');
  if (u.cls === 'RG' && ter(u.x, u.y).high) v += 1;                  // 鷹眼
  return v;
}
const dmgType = u => base(u).dmg;
const armType = u => base(u).arm;
function hasAffix(u, id) {
  if (!isHero(u)) return false;
  for (const s in u.equip) if (u.equip[s] && u.equip[s].affix === id) return true;
  return false;
}


/* ── 傷害 ── */

function flankMult(a, d) {
  const dx = a.x - d.x, dy = a.y - d.y;
  const f = FACE[d.dir];
  const dot = dx * f[0] + dy * f[1];
  const cross = Math.abs(dx * f[1] - dy * f[0]);
  if (Math.abs(dot) < cross) return FLANK.side;
  return dot > 0 ? FLANK.front : FLANK.back;
}
const flankName = m => m === FLANK.back ? '背擊' : m === FLANK.side ? '側擊' : '';

// 相鄰的騎士提供減傷
function guardOf(d) {
  let g = hasAffix(d, 'guard') ? 2 : 0;
  for (const [dx, dy] of NB8) {
    const o = unitAt(d.x + dx, d.y + dy);
    if (o && o.side === d.side && o.cls === 'KN') { g += 2; break; }
  }
  return g;
}

function dmgCalc(a, d, opt) {
  opt = opt || {};
  const at = ter(a.x, a.y), dt = ter(d.x, d.y);
  let A = atkOf(a) + (opt.ignoreTer ? 0 : at.atk);
  if (at.high && !dt.high) A += HIGH_GROUND;
  else if (dt.high && !at.high) A -= 1;

  let D = defOf(d) + (opt.ignoreTer ? 0 : dt.def) + guardOf(d);
  if (a.cls === 'MG' || hasAffix(a, 'rend')) D = Math.floor(D / 2);
  D = Math.max(0, D);

  // 減傷曲線，見 data.js 的 MIT_K：防禦拉高傷害會越來越低，但不會像舊公式
  // 「攻擊 − 防禦」那樣一路砍到地板值 1，全等級的交手節奏才穩得住。
  let v = A * MIT_K / (MIT_K + D);
  if (BEATS[dmgType(a)] === armType(d)) v *= COUNTER_TRI;
  v *= (opt.noFlank ? 1 : flankMult(a, d));
  if (opt.mult) v *= opt.mult;
  if (opt.crit) v *= CRIT_MULT;
  v = Math.round(v);
  if (pasOf(d, 'rangedRes') && dmgType(a) !== 'melee') v = Math.round(v * (1 - pasOf(d, 'rangedRes')));
  if (opt.counter && pasOf(a, 'counterPct')) v = Math.round(v * (1 + pasOf(a, 'counterPct')));
  return Math.max(1, v);
}

// 反擊條件：還活著、在射程內、不是被背擊、攻擊方沒有「先制」
function canCounter(a, d, opt) {
  if (!d.alive || d.hp <= 0) return false;
  if (opt && opt.noCounter) return false;
  if (hasAffix(a, 'first')) return false;
  if (!canActU(d)) return false;
  if (pasOf(a, 'firstNoCounter') && !a.hitOnce) return false;
  if (pasOf(a, 'farNoCounter') && dist(a, d) >= pasOf(a, 'farNoCounter')) return false;
  if (flankMult(a, d) === FLANK.back && !pasOf(d, 'backCounter')) return false;
  return dist(a, d) <= rngOf(d) && canReach(d, a);
}

/* ── 移動範圍（含控制區域）── */

function zoc(u, x, y) {
  for (const [dx, dy] of DIRS) {
    const o = unitAt(x + dx, y + dy);
    if (o && o.side !== u.side && !(u.side === 2 && o.side === 2)) return true;
  }
  return false;
}

function reachOf(u) {
  const mv = movOf(u), N = W * H;
  const cost = new Int16Array(N).fill(-1), prev = new Int32Array(N).fill(-1);
  const buck = Array.from({ length: mv + 1 }, () => []);
  const s = key(u.x, u.y);
  cost[s] = 0; buck[0].push(s);
  for (let c = 0; c <= mv; c++) {
    for (let qi = 0; qi < buck[c].length; qi++) {
      const k = buck[c][qi];
      if (cost[k] !== c) continue;
      const x = k % W, y = (k - x) / W;
      if (c > 0 && (zoc(u, x, y) || ter(x, y).mire)) continue;   // 進敵人控制區 / 踏入沼澤就停
      if (c > 0 && TRAPS.some(t => t.x === x && t.y === y && t.side !== u.side)) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inBoard(nx, ny)) continue;
        const o = unitAt(nx, ny);
        if (o && o.side !== u.side) continue;
        let tc = ter(nx, ny).cost;
        if (tc > 1 && ter(nx, ny).forest && pasOf(u, 'forest')) tc = 1;   // 疾風步
        const nc = c + tc;
        if (nc > mv) continue;
        const nk = key(nx, ny);
        if (cost[nk] === -1 || nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; buck[nc].push(nk); }
      }
    }
  }
  const stops = [];
  for (let k = 0; k < N; k++) {
    if (cost[k] < 0) continue;
    const x = k % W, y = (k - x) / W, o = unitAt(x, y);
    if (!o || o === u) stops.push([x, y]);
  }
  return { cost, prev, stops, has: (x, y) => cost[key(x, y)] >= 0 && (!unitAt(x, y) || unitAt(x, y) === u) };
}

function pathTo(r, u, x, y) {
  const out = []; let k = key(x, y);
  while (k >= 0) { out.unshift([k % W, (k - k % W) / W]); k = r.prev[k]; }
  if (!out.length || out[0][0] !== u.x || out[0][1] !== u.y) return [[u.x, u.y]];
  return out;
}

// 找一個打得到目標的落腳點（原地優先，其次最近）
function stopToHit(r, u, tx, ty, range) {
  const rg = range || rngOf(u);
  // 遠程／魔法要挑一個看得到目標的落點，不然走過去了石頭還是擋在中間；
  // 找不到這種格子的話退回原本「離目標最近」的邏輯，至少不會完全不動
  const needLOS = dmgType(u) !== 'melee';
  let best = null, bc = 1e9, bestAny = null, bcAny = 1e9;
  for (const [sx, sy] of r.stops) {
    const d = Math.abs(sx - tx) + Math.abs(sy - ty);
    if (d < 1 || d > rg) continue;
    let c = r.cost[key(sx, sy)];
    if (sx === u.x && sy === u.y) c -= 1000;
    if (c < bcAny) { bcAny = c; bestAny = [sx, sy]; }
    if (needLOS && d > 1 && !hasLOS({ x: sx, y: sy }, { x: tx, y: ty })) continue;
    if (c < bc) { bc = c; best = [sx, sy]; }
  }
  return best || bestAny;
}

// 從 (cx,cy) 往外找一個沒人站、走得進去的格子
function freeNear(cx, cy, minR) {
  for (let r = minR || 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (!inBoard(x, y) || ter(x, y).cost > 90 || unitAt(x, y)) continue;
      return [x, y];
    }
  return null;
}

function targetsOf(u) {
  const out = [], rg = rngOf(u);
  for (const o of alive()) {
    if (o === u) continue;
    const d = dist(u, o);
    if (d < 1 || d > rg) continue;
    if (!canReach(u, o)) continue;   // 遠程／魔法被石頭擋視線就打不到
    if (o.side !== u.side) out.push(o);
    else if (base(u).healPct && o.hp < mhpOf(o)) out.push(o);
  }
  return out;
}

/* ── 單位建立 ── */

function mkHero(side, cls, x, y) {
  const c = CLS[cls];
  const u = {
    id: uidSeq++, side, cls, x, y, dir: side === 0 ? 3 : 7, turned: false,
    lv: 1, exp: 0, moved: false, acted: false, alive: true,
    equip: { weapon: null, armor: null, trinket: null }, cds: {}, st: [],
    act: [null, null, null], pas: null,
    pts: 0, alloc: { atk: 0, def: 0, hp: 0 },      // 自由屬性點
    swapEq: {}, swapSk: {}                        // 每個欄位這回合換過沒
  };
  u.hp = c.hp;
  G.units.push(u);
  return u;
}
function mkMon(kind, x, y, camp) {
  const m = MON[kind];
  const tier = camp ? camp.tier : 1;
  const u = {
    id: uidSeq++, side: 2, kind, x, y, dir: Math.floor(grng() * 8), turned: false,
    lv: MON_LV[tier], exp: 0, moved: false, acted: false, alive: true,
    equip: {}, cds: {}, st: [], awake: false, home: [x, y],
    camp: camp ? camp.id : -1, tier
  };
  u.hp = mhpOf(u);
  G.units.push(u);
  return u;
}

// 驚動一隻，整營地一起醒過來 —— 原本是一隻一隻叫醒，玩家可以站在
// 邊緣把一整群怪一隻隻挑掉，怪群完全不成群。現在攻擊或路過驚動任何一隻，
// 同一個營地的怪會一起圍上來，戰鬥才是「打一群」而不是「打一串單體」。
function wakeCamp(m) {
  if (m.side !== 2 || m.camp === undefined) return;
  for (const o of G.units) {
    if (o.side === 2 && o.camp === m.camp && o.alive && !o.awake) {
      o.awake = true; o.wokeAt = ++wakeSeq;
    }
  }
}

// 怪物陣亡後在自己的營地重生；離王座越近的怪群等級越高、復活越慢，
// 中心半徑 NO_REVIVE_R 格內的怪群打掉就不會再回來
function reviveMonsters() {
  let any = false;
  for (const u of G.units) {
    if (u.side !== 2 || u.alive || !u.down) continue;
    if (--u.down > 0) continue;
    const c = CAMPS[u.camp];
    const spot = c ? freeNear(c.x, c.y, 0) : freeNear(u.home[0], u.home[1], 0);
    if (!spot) { u.down = 1; continue; }
    u.x = spot[0]; u.y = spot[1]; u.alive = true;
    u.hp = mhpOf(u); u.st = []; u.awake = false; u.turned = false;
    u.dir = Math.floor(grng() * 8);
    buildUnitView(u); makeTag(u);
  }
  refreshRespawn();
}

/* ── 裝備 ── */

function rollItem(q) {
  const r = q === undefined ? 0 : q;
  const slots = ['weapon', 'armor', 'trinket'];
  const slot = slots[Math.floor(grng() * 3)];
  const g = GEAR[slot][Math.floor(grng() * GEAR[slot].length)];
  const it = { iid: ++itemSeq, slot, r, n: g.n };
  for (const k of ['atk', 'def', 'hp', 'mov', 'rng']) {
    if (!g[k]) continue;
    it[k] = g[k] > 0 ? Math.max(1, Math.round(g[k] * RARITY[r].mult)) : g[k];
  }
  if (r > 0 && grng() < 0.15 + r * 0.22) it.affix = AFFIX[Math.floor(grng() * AFFIX.length)].id;
  return it;
}
function itemName(it) {
  const a = it.affix ? AFFIX.find(x => x.id === it.affix).n + '之' : '';
  return a + it.n;
}
function itemStats(it) {
  const p = [];
  for (const [k, n] of [['atk', '攻'], ['def', '防'], ['hp', 'HP'], ['mov', '移'], ['rng', '射程']])
    if (it[k]) p.push(n + (it[k] > 0 ? '+' : '') + it[k]);
  return p.join(' ');
}
// 武器有職業限制（弓只有遊俠拿得動之類），防具飾品不限
function canUse(u, it) {
  if (it.slot !== 'weapon') return true;
  const g = GEAR.weapon.find(x => x.n === it.n);
  return !g || !g.use || g.use.includes(u.cls);
}
function useHint(it) {
  const g = GEAR.weapon.find(x => x.n === it.n);
  return (it.slot === 'weapon' && g && g.use && g.use.length < CLS_ORDER.length)
    ? g.use.map(c => CLS[c].n).join('／') : '';
}

function equip(u, it) {
  if (!canUse(u, it)) { toast(nameOf(u) + ' 用不了' + it.n); return; }
  const bag = G.bag[u.side];
  const i = bag.indexOf(it);
  if (i < 0) return;
  bag.splice(i, 1);
  const old = u.equip[it.slot];
  u.equip[it.slot] = it;
  if (old) bag.push(old);
  u.hp = Math.min(u.hp, mhpOf(u));
  log(`<b>${nameOf(u)}</b> 裝備了 ${itemName(it)}`);
}
function unequip(u, slot) {
  const it = u.equip[slot];
  if (!it) return;
  u.equip[slot] = null;
  G.bag[u.side].push(it);
  u.hp = Math.min(u.hp, mhpOf(u));
}

/* ── 經驗 ── */

function gainExp(u, n, shared) {
  if (!u.alive || !isHero(u)) return;
  // 附近的隊友一起分經驗，整隊才會一起成長
  if (!shared) {
    const sh = Math.round(n * XP_SHARE);
    if (sh > 0) for (const o of alive())
      if (o !== u && o.side === u.side && isHero(o) && dist(o, u) <= XP_SHARE_R) gainExp(o, sh, 1);
  }
  u.exp += n;
  while (u.lv < LV_MAX && u.exp >= XP_NEED(u.lv)) { u.exp -= XP_NEED(u.lv); levelUp(u); }
  if (u.lv >= LV_MAX) u.exp = 0;
}
function levelUp(u) {
  u.lv++;
  u.hp += LV_GAIN.hp;
  u.pts = (u.pts || 0) + FREE_PTS;
  let msg = `<span class="up">${nameOf(u)} 升到 Lv.${u.lv}</span>`;
  if (u.lv === PROMO_LV) { u.hp += PROMO.hp; msg += ` <span class="up">— 進階為 ${CLS[u.cls].pro}</span>`; }
  if (u.lv === 3 || u.lv === 6) msg += ` <span class="up">— 開了第 ${u.lv === 3 ? 2 : 3} 個技能欄</span>`;
  if (u.lv === 4) msg += ` <span class="up">— 開了被動技能欄</span>`;
  msg += ` <span class="up">＋${FREE_PTS} 屬性點</span>`;
  u.hp = Math.min(u.hp, mhpOf(u));
  log(msg);
  markNews(u.side);
  floatText(u.x, u.y, 'LEVEL UP', 'up');
  play(u, A.cheer, true);
}

/* ── 動畫小工具 ── */

const wait = ms => { const t = spd(ms); return t ? new Promise(r => setTimeout(r, t)) : Promise.resolve(); };
// 用 setTimeout 而不是 requestAnimationFrame 驅動：分頁被切到背景時 rAF 會停擺，
// 動畫補間就永遠不會結束，整個回合會卡死。畫面本身還是照常在 rAF 迴圈裡畫。
function tween(ms, fn) {
  ms = spd(ms);
  if (!ms) { fn(1); return Promise.resolve(); }
  return new Promise(res => {
    const t0 = performance.now();
    (function step() {
      const k = Math.min(1, (performance.now() - t0) / ms);
      fn(k);
      if (k < 1) setTimeout(step, 16); else res();
    })();
  });
}

// 畫面外的單位不必演動畫（魔物階段一次可能有十幾隻要跑）
const onCam = u => {
  const dx = wx(u.x) - camTarget.x, dz = wz(u.y) - camTarget.z;
  const r = camDist * 1.1 + 18;
  return dx * dx + dz * dz < r * r;
};

async function animMove(u, path) {
  const end = path[path.length - 1];
  if (!onCam(u) && !onCam({ x: end[0], y: end[1] })) {
    for (let i = 1; i < path.length; i++) {
      const tr = TRAPS.find(t => t.x === path[i][0] && t.y === path[i][1] && t.side !== u.side);
      u.x = path[i][0]; u.y = path[i][1];
      if (tr) { TRAPS.splice(TRAPS.indexOf(tr), 1); refreshTraps(); await hurt(u, tr.dmg, '陷阱'); break; }
    }
    placeUnit(u);
    await openChest(u);
    return;
  }
  play(u, A.walk);
  for (let i = 1; i < path.length; i++) {
    const [px, py] = path[i - 1], [nx, ny] = path[i];
    setDir(u, nx - px, ny - py);
    const y0 = ter(px, py).h, y1 = ter(nx, ny).h;
    await tween(135, k => {
      u.view.g.position.set(
        wx(px) + (wx(nx) - wx(px)) * k,
        y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * 0.09,
        wz(py) + (wz(ny) - wz(py)) * k
      );
    });
    u.x = nx; u.y = ny;
    await bleedOnMove(u);
    if (!u.alive) return;
    // 陷阱
    const tr = TRAPS.find(t => t.x === nx && t.y === ny && t.side !== u.side);
    if (tr) {
      TRAPS.splice(TRAPS.indexOf(tr), 1);
      refreshTraps();
      await hurt(u, tr.dmg, '陷阱');
      if (tr.st && u.alive) for (const e of tr.st) addSt(u, u, e);
      break;
    }
  }
  placeUnit(u);
  play(u, A.idle);
  await openChest(u);
}

async function openChest(u) {
  if (G.arena) { await pickupArenaBuff(u); return; }
  const c = chestAt(u.x, u.y);
  if (!c || !isHero(u)) return;
  c.opened = true;
  preMove = null;                 // 開過箱子就不能反悔了
  refreshChests();
  const tbl = c.gold ? Q_TABLE.gold : Q_TABLE[3];
  const it = rollItem(rollQ(tbl));
  const kept = takeItem(u.side, it);
  const coin = (c.gold ? 15 : 5) + Math.floor(grng() * (c.gold ? 11 : 6));
  giveGold(u.side, coin);
  floatText(u.x, u.y, c.gold ? '金寶箱！' : '寶箱！', 'up');
  log(`<b>${nameOf(u)}</b> 打開${c.gold ? '金' : ''}寶箱，獲得 <span class="r${it.r}">${itemName(it)}</span> ` +
      (kept ? itemStats(it) : '（自動分解）') + `，還有 <b>${coin}</b> 金幣`);
  markNews(u.side);
  // 金寶箱一定附一本技能書，普通寶箱四成
  if (c.gold || grng() < 0.4) {
    const bk = giveBook(u.side, rollQ(tbl));
    if (bk) log(`　還有技能書 <b class="q${SK[bk.id].q}">${SK[bk.id].n}</b>`);
  }
  await wait(320);
}

async function hurt(u, dmg, why) {
  const d = absorb(u, dmg);
  u.hp -= d;
  floatText(u.x, u.y, String(d), 'dmg');
  if (why) log(`<b>${nameOf(u)}</b> 受到${why} <b>${d}</b> 傷害`);
  updTag(u);
  if (u.hp > 0) play(u, A.hit, true);
  await wait(160);
  if (u.hp <= 0) await die(u, null);
}

async function strike(a, d, opt) {
  opt = opt || {};
  faceTile(a, d.x, d.y);
  const t = dmgType(a);
  const ranged = rngOf(a) > 1 || t !== 'melee';
  const seen = onCam(a) || onCam(d);
  const swing = grng() < 0.5;                       // 先擲骰，兩邊的亂數序列才會一致
  if (seen) {
    play(a, t === 'magic' ? A.cast : ranged ? A.shoot : (swing ? A.melee : A.chop), true);
    await wait(ranged ? 170 : 230);
    if (ranged && dist(a, d) > 1) await projectile(a, d, t);
  }

  const crit = !opt.noCrit && grng() < critOf(a);
  const fm = flankMult(a, d);
  const charged = !!a.charged;       // 競技場的蓄力地塊：下一次普通攻擊打完就消耗掉
  const dmg = dmgCalc(a, d, { crit, mult: (opt.mult || 1) * (charged ? 1.5 : 1), noFlank: opt.noFlank });
  if (charged) {
    a.charged = false;
    addSt(a, a, { id: 'weaken', pct: 0.3, turns: 2 });
  }
  const tag = (crit ? '暴擊 ' : '') + (charged ? '蓄力 ' : '') +
    (opt.noFlank ? '' : flankName(fm) + (flankName(fm) ? ' ' : ''));

  const real = absorb(d, dmg);
  a.stk = 0;                                        // 狂熱層數用掉了
  d.hp -= real;
  floatText(d.x, d.y, tag + real, crit ? 'crit' : 'dmg');
  updTag(d);

  if (hasAffix(a, 'vamp')) {
    const heal = Math.min(Math.ceil(real * 0.3), mhpOf(a) - a.hp);
    if (heal > 0) { a.hp += heal; floatText(a.x, a.y, '+' + heal, 'heal'); updTag(a); }
  }
  log(`<span class="s${a.side}">${nameOf(a)}</span> → <span class="s${d.side}">${nameOf(d)}</span> <b>${real}</b>${tag ? '（' + tag.trim() + '）' : ''}`);

  await onHurtPassives(a, d, real, crit, ranged || t === 'magic');

  // 被打就結仇：整個營地一起醒過來
  if (d.side === 2 && d.alive) wakeCamp(d);

  // 被打會轉頭看向攻擊者，但一回合只轉一次
  if (d.alive && d.hp > 0 && !d.turned) { faceTile(d, a.x, a.y); d.turned = true; }

  // 受擊退縮
  if (seen) {
    if (d.hp > 0 && d.view) {
      play(d, A.hit, true);
      const g = d.view.g, bx = g.position.x, bz = g.position.z;
      const nx = (bx - wx(a.x)) * 0.10, nz = (bz - wz(a.y)) * 0.10;
      await tween(150, k => { const s = Math.sin(k * Math.PI); g.position.x = bx + nx * s; g.position.z = bz + nz * s; });
    } else await wait(120);
    play(a, A.idle);
  }

  // 反傷
  if (d.alive && d.hp > 0 && hasAffix(d, 'thorn') && dist(a, d) <= 1) {
    const back = Math.max(1, Math.round(real * 0.25));
    a.hp -= back;
    floatText(a.x, a.y, String(back), 'dmg');
    updTag(a);
  }
  return real;
}

async function projectile(a, d, type) {
  const mesh = type === 'magic'
    ? new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8ee6ff }))
    : new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0xdccfb2 }));
  fxGroup.add(mesh);
  const p0 = new THREE.Vector3(wx(a.x), ter(a.x, a.y).h + 0.9, wz(a.y));
  const p1 = new THREE.Vector3(wx(d.x), ter(d.x, d.y).h + 0.8, wz(d.y));
  mesh.lookAt(p1); mesh.rotateX(Math.PI / 2);
  await tween(200, k => { mesh.position.lerpVectors(p0, p1, k); mesh.position.y += Math.sin(k * Math.PI) * 0.5; });
  fxGroup.remove(mesh);
}

async function die(u, killer) {
  if (!u.alive) return;
  // 競技場走自己的一套：不掉經驗、不進倒下復活、不算殲滅，純粹這一輪淘汰。
  // 只攔截「正在競技場裡的參賽者」——主戰場上被凍結的怪物如果被殘留的
  // 持續傷害（中毒／流血）拖死，還是要照正常流程處理，不然會去操作一個
  // 從沒在競技場建過模型的單位，u.view 是 null 就直接爆炸。
  if (G.arena && G.arena.participants.includes(u.id)) { await arenaDie(u); return; }
  if (lastStandCheck(u)) return;
  u.alive = false;
  // 殉道：倒下時把全隊拉起來
  const mt = pasOf(u, 'martyr');
  if (mt) {
    playFX('holy', u);
    for (const o of alive()) {
      if (o.side !== u.side || o === u) continue;
      healUnit(u, o, Math.round(mhpOf(o) * mt));
      addSt(o, u, { id: 'atk', pct: 0.3, turns: 2 });
    }
    log(`<b>${nameOf(u)}</b> 的殉道治癒了全隊`);
  }
  if (isHero(u)) {
    // 英雄不是真的死，會退回營地養傷，但會掉三成經驗
    u.down = REVIVE_TURNS;
    u.exp = Math.floor(u.exp * 0.7);
    log(`<span class="kill">${SIDE_N[u.side]}的${nameOf(u)} 倒下了</span>（${REVIVE_TURNS} 回合後在營地復活）`);
    // 「殲滅敵軍」只在敵方英雄親手打完最後一擊才算數。怪群現在會整營地圍
    // 上來，一次把三個人都放倒完全可能發生 —— 但那只是回合結束前的重傷，
    // 下一回合照樣在營地站起來，不該因為撞到一群怪就直接輸掉整場比賽。
    if (killer && isHero(killer) && killer.side !== u.side &&
        !alive().some(o => o.side === u.side && isHero(o))) {
      endGame(killer.side, '殲滅敵軍');
    }
  } else {
    const c = CAMPS[u.camp];
    if (c && c.revive) u.down = MON_REVIVE_BASE + (u.lv - 1);
    log(`<span class="kill">${nameOf(u)} 被消滅了</span>` + (u.down ? `（${u.down} 回合後重生）` : ''));
  }
  if (killer && killer.alive) {
    gainExp(killer, u.side === 2 ? MON[u.kind].exp : XP_KILL_PC);
    if (u.side === 2) monsterDrop(killer, u);
    killRefresh(killer);
  }
  // u.view 有可能是 null：競技場開打時會把全場（含怪物）的模型都先拆掉，
  // 這時候如果凍結中的怪物被殘留的持續傷害拖死，onCam() 只看座標不看
  // 有沒有模型，兩者組合起來就會想對一個不存在的模型播死亡動畫。
  if (u.view && onCam(u)) {
    play(u, A.die, true);
    await wait(700);
    await tween(320, k => {
      if (!u.view) return;
      u.view.g.traverse(c => {
        if (c.isMesh || c.isSkinnedMesh) { c.material.transparent = true; c.material.opacity = 1 - k; }
      });
    });
  }
  removeView(u);
  refreshRespawn();   // 兩邊都要重畫：英雄倒下也要在自家營地畫倒數圈
}

/* ── 行動 ── */

// a = {uid, path?, kind, tid?, tx?, ty?, skill?}
async function runAction(a) {
  busy = true;
  clearOverlay(); hideForecast(); closeSkillBar();
  const u = byId(a.uid);
  if (!u || !u.alive) { busy = false; return; }

  if (a.kind === 'undo') {
    u.x = a.x; u.y = a.y; u.moved = false;
    placeUnit(u); updTag(u); dimDone();
    busy = false; preMove = null;
    refreshTop(); refreshRoster();
    if (u.side === G.cur && myTurn()) select(u);
    return;
  }

  if (a.path && a.path.length) {
    if (a.path.length > 1) await animMove(u, a.path);
    else { u.x = a.path[0][0]; u.y = a.path[0][1]; placeUnit(u); await openChest(u); }
    u.moved = true;
  }

  if (a.kind === 'attack') {
    const d = byId(a.tid);
    if (d && d.alive) {
      await strike(u, d);
      u.hitOnce = 1;                      // 獵人本能只吃本回合第一次出手
      if (d.hp <= 0) await die(d, u);
      else {
        gainExp(u, XP_HIT);
        if (canCounter(u, d)) {
          await wait(90);
          await strike(d, u, { noCrit: false });
          if (u.hp <= 0) await die(u, d); else gainExp(d, XP_CNT);
        }
      }
    }
    u.acted = true;
  } else if (a.kind === 'heal') {
    const t = byId(a.tid);
    if (t && t.alive) {
      faceTile(u, t.x, t.y);
      play(u, A.cast, true);
      await wait(340);
      const amt = Math.min(healAmt(u), mhpOf(t) - t.hp);
      t.hp += amt;
      floatText(t.x, t.y, '+' + amt, 'heal');
      blessSelf(u, amt);
      updTag(t); updTag(u);
      log(`<span class="s${u.side}">${nameOf(u)}</span> 治療 ${nameOf(t)} <b>${amt}</b>`);
      gainExp(u, XP_HEAL);
      play(u, A.idle);
    }
    u.acted = true;
  } else if (a.kind === 'skill') {
    await useSkill(u, a.skill, a);
    u.acted = true;
  } else if (a.kind === 'wait') {
    u.moved = true; u.acted = true;
  }

  updTag(u);
  // 只是移動的話讓單位保持選取，可以看完全場再決定要不要出手
  const keep = a.kind === 'move' && u.alive && !u.acted && u.side === G.cur && myTurn();
  sel = null; phase = 'idle';
  if (a.kind !== 'move') preMove = null;
  dimDone();
  busy = false;
  if (checkVictory()) return;
  refreshTop(); refreshRoster();
  if (keep) select(u); else hideCard();
  // 全部動完就自動換手（電腦回合交給 aiTurn 自己收尾）
  if (SET.autoEnd && myTurn() && !G.over && !(aiOn && mode === 'local' && G.cur === AI_SIDE) &&
      !G.units.some(o => o.alive && o.side === G.cur && !(o.moved && o.acted)))
    setTimeout(() => { if (!busy && !G.over && myTurn()) doEndTurn(true); }, 450);
}

// 牧師的祝福：治療別人時自己也回三成
function blessSelf(u, amt) {
  if (u.cls !== 'CL' || amt <= 0) return;
  const h = Math.min(Math.round(amt * 0.3), mhpOf(u) - u.hp);
  if (h > 0) { u.hp += h; floatText(u.x, u.y, '+' + h, 'heal'); updTag(u); }
}

/* ── 技能 ── */

// 技能實際數值 = 攻擊力 × 比例
const skillAmt = (u, s) => Math.max(1, Math.round(atkOf(u) * (s.pct || 0)));
const healAmt = u => Math.max(1, Math.round(atkOf(u) * (base(u).healPct || 0)));

// 這個單位現在能不能放這個技能
function skillReady(u, id) {
  const s = SK[id];
  return !!s && isHero(u) && !s.k.startsWith('passive') && !(u.cds[id] > 0)
    && !u.acted && canSkillU(u);
}

// 技能的射程 / 範圍，加上被動修正
const skRng = (u, s) => (s.rng === 0 ? rngOf(u) : (s.rng || 1));

// 一次結算：算傷害、上狀態、扣血、判死
async function hit(u, t, s, opt) {
  opt = opt || {};
  if (!t || !t.alive) return 0;
  let mult = s.pct || 1;
  if (s.exec && t.hp / mhpOf(t) <= s.exec[0]) mult = s.exec[1];
  if (pasOf(u, 'vsDebuff') && t.st.some(x => !ST[x.id].good)) mult *= 1 + pasOf(u, 'vsDebuff');
  if (pasOf(u, 'magicPct') && dmgType(u) === 'magic') mult *= 1 + pasOf(u, 'magicPct');

  let dmg = dmgCalc(u, t, { mult, noFlank: opt.noFlank, ignoreTer: s.ignoreTer });
  dmg = Math.round(dmg * (1 + stVal(t, 'curse')));
  if (hasSt(t, 'freeze')) dmg = Math.round(dmg * 1.5);

  const crit = !opt.noCrit && grng() < critOf(u);
  if (crit) dmg = Math.round(dmg * CRIT_MULT);

  const real = absorb(t, dmg);
  u.stk = 0;
  t.hp -= real;
  floatText(t.x, t.y, (crit ? '暴擊 ' : '') + real, crit ? 'crit' : 'dmg');
  hitFX(t, dmgType(u) === 'magic');
  updTag(t);
  afterDamage(u, t, real);
  await onHurtPassives(u, t, real, crit, dmgType(u) !== 'melee');
  // 技能傷害原本沒有結仇，法師一顆火球把整群怪炸醒不了一個 —— 補上跟普攻一樣的規則
  if (t.side === 2 && t.alive) wakeCamp(t);

  for (const e of (s.st || [])) addSt(t, u, e);
  const ae = pasOf(u, 'aoeDebuff');
  if (ae && opt.aoe) addSt(t, u, ae);

  if (t.hp <= 0) await die(t, u); else gainExp(u, XP_HIT);
  return real;
}

// 吸血、生命汲取這類「造成傷害之後」的被動
function afterDamage(u, t, dmg) {
  let ls = pasOf(u, 'lifesteal');
  if (ls && u.hp / mhpOf(u) < 0.5) ls *= 2;
  if (hasAffix(u, 'vamp')) ls += 0.3;
  if (ls > 0) {
    const h = Math.min(Math.ceil(dmg * ls), mhpOf(u) - u.hp);
    if (h > 0) { u.hp += h; floatText(u.x, u.y, '+' + h, 'heal'); updTag(u); }
  }
  const dh = pasOf(u, 'dmgToHeal');
  if (dh) {
    let low = null;
    for (const o of alive())
      if (o.side === u.side && o.hp < mhpOf(o) && (!low || o.hp / mhpOf(o) < low.hp / mhpOf(low))) low = o;
    if (low) {
      const h = Math.min(Math.ceil(dmg * dh), mhpOf(low) - low.hp);
      if (h > 0) { low.hp += h; floatText(low.x, low.y, '+' + h, 'heal'); updTag(low); }
    }
  }
}

// 受擊／命中之後才結算的被動：濺射、反傷、戰鬥狂熱
async function onHurtPassives(a, d, real, crit, ranged) {
  // 奧術洞察：暴擊時往相鄰敵人濺射
  const sp = pasOf(a, 'splash');
  if (sp && crit && real > 0) {
    for (const [dx, dy] of NB8) {
      const o = unitAt(d.x + dx, d.y + dy);
      if (!o || !o.alive || o.side === a.side || o === d) continue;
      const v = Math.max(1, Math.round(real * sp));
      o.hp -= absorb(o, v);
      floatText(o.x, o.y, String(v), 'dmg');
      updTag(o);
      if (o.hp <= 0) await die(o, a);
    }
  }
  // 戰鬥狂熱：被打一次疊一層，最多五層
  const st = pasOf(d, 'stackOnHurt');
  if (st && d.alive) d.stk = Math.min(st * 5, (d.stk || 0) + st);
  // 復仇之盾：被近戰打就讓對方流血
  const re = pasOf(d, 'retaliate');
  if (re && !ranged && d.alive && a.alive) addSt(a, d, re);
}

// 不倒之軀 / 殉道：血量歸零時的最後掙扎，回傳 true 表示這次沒死成
function lastStandCheck(u) {
  if (u.hp > 0 || !pasOf(u, 'lastStand') || u.usedStand) return false;
  u.usedStand = 1;
  u.hp = 1;
  addSt(u, u, { id: 'def', pct: 0.8, turns: 2 });
  floatText(u.x, u.y, '不倒之軀', 'up');
  playFX('holy', u);
  log(`<b>${nameOf(u)}</b> 撐住了最後一口氣`);
  updTag(u);
  return true;
}

// 擊殺後恢復行動（不死狂戰 / 血怒狂潮）
function killRefresh(u) {
  const n = pasOf(u, 'killRefresh') || (u.soloTurn === G.turn ? 9 : 0);
  if (!n) return;
  if (u.krTurn !== G.turn) { u.krTurn = G.turn; u.krUsed = 0; }
  if (u.krUsed >= n) return;
  u.krUsed++;
  u.moved = false; u.acted = false;
  floatText(u.x, u.y, '再戰一次', 'up');
}

// 治療（含牧師被動回饋）
function healUnit(src, t, amt) {
  if (hasSt(t, 'poison')) amt = Math.ceil(amt / 2);
  const h = Math.min(amt, mhpOf(t) - t.hp);
  if (h <= 0) return 0;
  t.hp += h;
  floatText(t.x, t.y, '+' + h, 'heal');
  updTag(t);
  const back = pasOf(src, 'healBack');
  if (back && src !== t) {
    const b = Math.min(Math.round(h * back), mhpOf(src) - src.hp);
    if (b > 0) { src.hp += b; floatText(src.x, src.y, '+' + b, 'heal'); updTag(src); }
  }
  if (pasOf(src, 'linkShare')) t.link = 2;
  gainExp(src, XP_HEAL);
  return h;
}

// 把單位往遠離 (fx,fy) 的方向推 n 格
function pushUnit(t, fx, fy, n) {
  if (pasOf(t, 'noPush')) return;
  const dx = Math.sign(t.x - fx), dy = Math.sign(t.y - fy);
  for (let i = 0; i < n; i++) {
    const nx = t.x + dx, ny = t.y + dy;
    if (!inBoard(nx, ny) || ter(nx, ny).cost > 90 || unitAt(nx, ny)) break;
    t.x = nx; t.y = ny;
  }
  if (t.view) placeUnit(t);
}

const inSquare = (a, cx, cy, r) => Math.max(Math.abs(a.x - cx), Math.abs(a.y - cy)) <= r;
const enemiesIn = (u, cx, cy, r) => alive().filter(o => o.side !== u.side && inSquare(o, cx, cy, r));
const alliesIn = (u, cx, cy, r) => alive().filter(o => o.side === u.side && inSquare(o, cx, cy, r));

/* ── 技能執行 ── */

async function useSkill(u, id, a) {
  const s = SK[id];
  if (!s) return;
  u.cds[id] = s.cd + 1 - pasOf(u, 'cdCut');
  if (pasOf(u, 'freeCast') && grng() < pasOf(u, 'freeCast')) { u.cds[id] = 0; floatText(u.x, u.y, '冷卻重置', 'up'); }
  log(`<span class="s${u.side}">${nameOf(u)}</span> 使用「<b class="q${s.q}">${s.n}</b>」`);

  const tgt = (a.tid !== undefined && a.tid >= 0) ? byId(a.tid) : null;
  const tx = a.tx !== undefined ? a.tx : u.x, ty = a.ty !== undefined ? a.ty : u.y;
  const cast = anim => { play(u, anim || A.cast, true); };

  switch (s.k) {
    case 'single': {
      if (!tgt) break;
      faceTile(u, tgt.x, tgt.y);
      cast(dmgType(u) === 'melee' ? A.melee : dmgType(u) === 'ranged' ? A.shoot : A.cast);
      await wait(220);
      playFX(s.fx, u, tgt);
      const dead = tgt.hp <= (await hit(u, tgt, s)) ;
      if (s.push) pushUnit(tgt, u.x, u.y, s.push);
      if (s.spendTurn) tgt.turned = true;
      if (s.rooted) u.moved = true;
      if (s.resetOnKill && dead) u.cds[id] = 0;
      break;
    }
    case 'multi': {
      if (!tgt) break;
      faceTile(u, tgt.x, tgt.y);
      for (let i = 0; i < s.hits && tgt.alive; i++) {
        cast(dmgType(u) === 'ranged' ? A.shoot : A.melee);
        await wait(180);
        playFX(s.fx, u, tgt);
        await hit(u, tgt, s);
      }
      break;
    }
    case 'fan': {
      cast(A.melee); await wait(200); playFX(s.fx, u);
      const f = FACE[u.dir];
      for (const o of enemiesIn(u, u.x, u.y, 1)) {
        const dx = o.x - u.x, dy = o.y - u.y;
        if (dx * f[0] + dy * f[1] < 0.2) continue;      // 只掃面向那一側
        await hit(u, o, s, { noFlank: 1 });
      }
      break;
    }
    case 'cross': {
      cast(A.melee); await wait(200); playFX(s.fx, u);
      for (const [dx, dy] of DIRS) {
        const o = unitAt(u.x + dx, u.y + dy);
        if (o && o.side !== u.side) await hit(u, o, s, { noFlank: 1 });
      }
      break;
    }
    case 'around': {
      cast(A.chop); await wait(240); playFX(s.fx, u);
      for (const o of enemiesIn(u, u.x, u.y, 1).slice()) await hit(u, o, s, { noFlank: 1 });
      break;
    }
    case 'line': {
      faceTile(u, tx, ty);
      cast(dmgType(u) === 'ranged' ? A.shoot : A.cast);
      await wait(220);
      const dx = Math.sign(tx - u.x), dy = Math.sign(ty - u.y);
      beam(u.x, u.y, u.x + dx * s.len, u.y + dy * s.len,
        s.fx === 'ice' ? 0x8fe6ff : s.fx === 'bolt' ? 0xbfe4ff : 0xdccfb4, 0.1, 0.25);
      for (let i = 1; i <= s.len; i++) {
        const x = u.x + dx * i, y = u.y + dy * i;
        if (!inBoard(x, y)) break;
        const o = unitAt(x, y);
        if (o && o.side !== u.side) { playFX(s.fx, u, o); await hit(u, o, s, { noFlank: 1 }); }
      }
      break;
    }
    case 'aoe': {
      faceTile(u, tx, ty);
      cast(); await wait(240);
      playFX(s.fx, u, { x: tx, y: ty });
      await wait(120);
      for (const o of enemiesIn(u, tx, ty, s.r).slice()) {
        if (s.pct) await hit(u, o, s, { noFlank: 1, aoe: 1 });
        else for (const e of (s.st || [])) addSt(o, u, e);
      }
      break;
    }
    case 'pick': {
      faceTile(u, tx, ty);
      cast(A.shoot); await wait(200);
      const list = enemiesIn(u, tx, ty, s.r).slice(0, s.pick);
      for (const o of list) { playFX(s.fx, u, o); await hit(u, o, s, { noFlank: 1 }); }
      break;
    }
    case 'wave': {
      faceTile(u, tx, ty);
      cast(); await wait(240);
      const dx = Math.sign(tx - u.x), dy = Math.sign(ty - u.y);
      const px = dy, py = -dx;                          // 垂直方向，做出三格寬的牆
      for (let w = -1; w <= 1; w++)
        for (let i = 1; i <= 4; i++) {
          const x = u.x + dx * i + px * w, y = u.y + dy * i + py * w;
          if (!inBoard(x, y)) continue;
          if (i === 2) playFX(s.fx, u, { x, y });
          const o = unitAt(x, y);
          if (o && o.side !== u.side) {
            await hit(u, o, s, { noFlank: 1, aoe: 1 });
            if (o.alive) pushUnit(o, u.x, u.y, 1 + Math.floor(grng() * 2));
          }
        }
      break;
    }
    case 'charge': {
      faceTile(u, tx, ty);
      const dx = Math.sign(tx - u.x), dy = Math.sign(ty - u.y);
      let stop = null, path = [[u.x, u.y]];
      for (let i = 1; i <= s.len; i++) {
        const x = u.x + dx * i, y = u.y + dy * i;
        if (!inBoard(x, y) || ter(x, y).cost > 90) break;
        const o = unitAt(x, y);
        if (o) { if (o.side !== u.side) stop = o; break; }
        path.push([x, y]);
      }
      if (path.length > 1) await animMove(u, path);
      playFX(s.fx, u, stop || u);
      if (stop) { await hit(u, stop, s); if (stop.alive && s.push) pushUnit(stop, u.x, u.y, s.push); }
      break;
    }
    case 'delayed': {
      faceTile(u, tx, ty);
      cast(); await wait(300);
      ringFX(tx, ty, 0xff6a20, TILE * (s.r * 2 + 1), 0.8);
      PENDING.push({ x: tx, y: ty, r: s.r, pct: s.pct, fx: s.fx, side: u.side, uid: u.id, turn: G.turn });
      refreshPending();
      toast('隕石鎖定完成 —— 下回合開始落下');
      break;
    }
    case 'teleport': {
      cast(); await wait(200);
      playFX('blink', u);
      u.x = tx; u.y = ty; placeUnit(u);
      playFX('blink', u);
      await openChest(u);
      break;
    }
    case 'retreat': {
      let best = [u.x, u.y], bd = -1;
      const r = reachOf(u);
      for (const [sx, sy] of r.stops) {
        if (r.cost[key(sx, sy)] > s.len * 2) continue;
        let d = 1e9;
        for (const o of alive()) if (o.side !== u.side) d = Math.min(d, Math.abs(o.x - sx) + Math.abs(o.y - sy));
        if (d > bd) { bd = d; best = [sx, sy]; }
      }
      playFX(s.fx, u);
      if (best[0] !== u.x || best[1] !== u.y) await animMove(u, pathTo(r, u, best[0], best[1]));
      break;
    }
    case 'refreshSelf': { playFX(s.fx, u); u.moved = false; floatText(u.x, u.y, '再動一次', 'up'); await wait(350); break; }
    case 'refreshAlly': {
      if (!tgt) break;
      playFX(s.fx, u); playFX('buff', tgt);
      tgt.moved = false; tgt.acted = false;
      floatText(tgt.x, tgt.y, '再動一次', 'up');
      await wait(400);
      break;
    }
    case 'trap': case 'trapN': {
      cast(); await wait(220);
      const n = s.n || 1;
      const spots = n === 1 ? [[tx, ty]]
        : [[tx, ty], [tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]].slice(0, n);
      for (const [x, y] of spots) {
        if (!inBoard(x, y) || ter(x, y).cost > 90 || unitAt(x, y)) continue;
        TRAPS.push({ x, y, side: u.side, dmg: skillAmt(u, s), st: s.st || null });
        playFX('trap', u, { x, y });
      }
      refreshTraps();
      break;
    }
    case 'heal': {
      const t = tgt || u;
      faceTile(u, t.x, t.y);
      cast(); await wait(260);
      playFX(s.fx, u, t);
      healUnit(u, t, skillAmt(u, s));
      if (s.freeAct) u.acted = false;
      break;
    }
    case 'healAoe': {
      faceTile(u, tx, ty);
      cast(); await wait(280);
      playFX(s.fx, u, { x: tx, y: ty });
      for (const o of alliesIn(u, tx, ty, s.r)) {
        healUnit(u, o, skillAmt(u, s));
        if (s.cleanse) clearBad(o);
      }
      break;
    }
    case 'aura': {
      cast(); await wait(260); playFX(s.fx, u);
      AURAS.push({ uid: u.id, side: u.side, r: s.r, pct: s.pct, turns: s.turns + 1 });
      for (const o of alliesIn(u, u.x, u.y, s.r)) floatText(o.x, o.y, '光環', 'heal');
      break;
    }
    case 'shield': {
      const t = tgt || u;
      cast(); await wait(240);
      playFX(s.fx, u, t);
      addSt(t, u, { id: 'shield', pct: s.pct, turns: 3 });
      floatText(t.x, t.y, '護盾 ' + skillAmt(u, s), 'heal');
      break;
    }
    case 'buffSelf': {
      play(u, A.cheer, true); await wait(300);
      playFX(s.fx, u);
      for (const e of (s.self || [])) addSt(u, u, e);
      if (s.killRefresh) u.soloTurn = G.turn;
      break;
    }
    case 'buffAlly': {
      if (!tgt) break;
      cast(); await wait(280);
      playFX(s.fx, u, tgt);
      for (const e of (s.give || [])) addSt(tgt, u, e);
      break;
    }
    case 'buffAround': {
      play(u, A.cheer, true); await wait(280);
      playFX(s.fx, u);
      for (const o of alliesIn(u, u.x, u.y, s.r)) {
        if (o === u) continue;
        for (const e of (s.give || [])) addSt(o, u, e);
        floatText(o.x, o.y, s.n, 'up');
      }
      for (const e of (s.self || [])) addSt(u, u, e);
      break;
    }
    case 'domain': {
      play(u, A.cheer, true); await wait(320);
      playFX(s.fx, u);
      for (const o of alliesIn(u, u.x, u.y, s.r)) {
        healUnit(u, o, skillAmt(u, s));
        for (const e of (s.give || [])) addSt(o, u, e);
      }
      for (const o of enemiesIn(u, u.x, u.y, s.r)) for (const e of (s.st || [])) addSt(o, u, e);
      break;
    }
    case 'raise': {
      const down = G.units.find(o => o.side === u.side && !o.alive && isHero(o));
      if (!down) { toast('沒有倒下的隊友'); u.cds[id] = 0; return; }
      const spot = freeNear(u.x, u.y, 1);
      if (!spot) { toast('旁邊沒有空位'); u.cds[id] = 0; return; }
      cast(); await wait(300);
      down.x = spot[0]; down.y = spot[1]; down.alive = true; down.down = 0;
      down.hp = Math.ceil(mhpOf(down) * 0.6);
      down.st = []; down.turned = false;
      buildUnitView(down); makeTag(down);
      playFX(s.fx, u, down);
      log(`<span class="up">${nameOf(down)} 被 ${nameOf(u)} 拉了回來</span>`);
      u.uses = (u.uses || 0) + 1;
      refreshRoster();
      break;
    }
  }
  play(u, A.idle);
}

/* ── 延遲技能（隕石）與光環 ── */
let PENDING = [], AURAS = [];

async function resolvePending(side) {
  for (let i = PENDING.length - 1; i >= 0; i--) {
    const p = PENDING[i];
    if (p.side !== side || p.turn === G.turn) continue;
    PENDING.splice(i, 1);
    const u = byId(p.uid);
    await moveCam(p.x, p.y);
    playFX(p.fx, u || { x: p.x, y: p.y }, { x: p.x, y: p.y });
    await wait(400);
    if (u) for (const o of enemiesIn(u, p.x, p.y, p.r).slice())
      await hit(u, o, { pct: p.pct }, { noFlank: 1, aoe: 1 });
  }
  refreshPending();
}

function tickAuras(side) {
  for (let i = AURAS.length - 1; i >= 0; i--) {
    const a = AURAS[i];
    if (a.side !== side) continue;
    const u = byId(a.uid);
    if (!u || !u.alive || --a.turns <= 0) { AURAS.splice(i, 1); continue; }
    for (const o of alliesIn(u, u.x, u.y, a.r)) {
      const h = Math.min(Math.round(atkOf(u) * a.pct), mhpOf(o) - o.hp);
      if (h > 0) { o.hp += h; floatText(o.x, o.y, '+' + h, 'heal'); updTag(o); }
    }
  }
}


/* ── 回合 ── */

async function startTurn(side) {
  G.cur = side; G.lastSide = side;
  // 王座計數
  const holder = alive().find(u => u.x === THRONE[0] && u.y === THRONE[1] && u.side === side);
  G.hold[side] = holder ? G.hold[side] + 1 : 0;
  if (G.hold[side] >= THRONE_WIN) { endGame(side, '佔領王座滿 ' + THRONE_WIN + ' 回合'); return; }

  // 倒下的英雄倒數，時間到就在營地重新站起來
  let anyRevived = false;
  for (const u of G.units) {
    if (u.side !== side || u.alive || !isHero(u)) continue;
    if (--u.down > 0) continue;
    const spot = freeNear(CAMP[side][0], CAMP[side][1]);
    if (!spot) { u.down = 1; continue; }
    u.x = spot[0]; u.y = spot[1]; u.alive = true;
    u.hp = Math.ceil(mhpOf(u) / 2);
    u.st = [{ id: 'mov', v: REVIVE_DASH, turns: 3 }];   // 剛回來的兩個回合腳程快一點
    u.turned = false; u.dir = side === 0 ? 3 : 7;
    u.spawnAt = null;                                   // 下次倒下要重算位置，不要沿用舊的
    buildUnitView(u); makeTag(u);
    log(`<span class="up">${nameOf(u)} 在營地重新站了起來</span>`);
    anyRevived = true;
  }
  if (anyRevived) refreshRespawn();   // 清掉復活那個人的倒數圈，其他還沒好的維持顯示
  for (const u of G.units) {
    if (u.side !== side) continue;
    u.moved = false; u.acted = false; u.turned = false; u.hitOnce = 0;
    u.swapEq = {}; u.swapSk = {};                // 每個欄位每回合各有一次換裝機會
    for (const k in u.cds) if (u.cds[k] > 0) u.cds[k]--;
    if (!canMoveU(u)) u.moved = true;
    if (!canActU(u)) u.acted = true;
    u.hp = Math.min(u.hp, mhpOf(u));
  }
  // 站在自家營地周圍一格的單位，每回合回一次血
  const [ax, ay] = CAMP[side];
  for (const u of alive()) {
    if (u.side !== side || cheb(u, { x: ax, y: ay }) > 1) continue;
    const h = Math.min(Math.round(mhpOf(u) * CAMP_HEAL), mhpOf(u) - u.hp);
    if (h <= 0) continue;
    u.hp += h; updTag(u);
    floatText(u.x, u.y, '+' + h, 'heal');
  }

  tickAuras(side);
  for (const u of alive().slice()) if (u.side === side) await tickStatus(u);
  await resolvePending(side);
  if (G.over) return;

  dimDone(); refreshTop(); refreshRoster();
  turnBanner();
  log(`— 第 ${G.turn} 回合・<span class="s${side}">${SIDE_N[side]}</span> —`);
  // 本機對戰換人時把鏡頭帶到該方的隊伍上，否則對方的單位在幾十格外，會以為沒輪到他
  if (mode === 'local') {
    const list = alive().filter(u => u.side === side);
    const az = side === 0 ? Math.PI * 0.25 : Math.PI * 1.25;
    if (list.length) {
      const cx = Math.round(list.reduce((s, u) => s + u.x, 0) / list.length);
      const cy = Math.round(list.reduce((s, u) => s + u.y, 0) / list.length);
      moveCam(cx, cy, az);
    } else flipCam(az);
  }
  const other = 1 - side;
  if (G.hold[other] > 0) toast(`${SIDE_N[other]}已佔領王座 ${G.hold[other]}/${THRONE_WIN} 回合`);
  if (aiOn && mode === 'local' && side === AI_SIDE && !G.over) setTimeout(aiTurn, 700);
}

async function doEndTurn(broadcast) {
  if (G.over || busy) return;
  if (broadcast && mode === 'online') netSend({ t: 'end' });
  sel = null; phase = 'idle'; preMove = null;
  clearOverlay(); hideCard(); hideForecast(); closeSkillBar();
  if (G.arena) { await arenaEndTurn(); return; }

  // 藍方剛結束只是換紅方繼續這一輪，還沒到「所有玩家都行動完」，不夾背包回合
  if (G.cur === 0) { await startTurn(1); return; }

  // 走到這裡代表雙方這一輪都結束了——背包回合夾在「所有玩家回合」跟「魔物／
  // 競技場／商店」之間，只在這裡插一次，不是每個人結束回合都插
  const proceed = async () => {
    if (G.turn % ARENA_INTERVAL === 0) { await enterArena(); return; }
    if (G.turn % SHOP_INTERVAL === 0) { await enterShop(); return; }
    await monsterPhase();
    if (G.over) return;
    G.turn++;
    await startTurn(0);
  };

  if (mode === 'online') { enterBagPhase(proceed); return; }
  await proceed();
}

/* ── 怪物 ── */

async function monsterPhase() {
  busy = true;
  G.cur = 2; refreshTop(); turnBanner();
  reviveMonsters();
  // 先動最早被驚動的那一群，鏡頭跟著它們跑，玩家才看得懂發生什麼事
  const mons = G.units.filter(u => u.alive && u.side === 2)
    .sort((a, b) => (a.wokeAt || 1e9) - (b.wokeAt || 1e9) || a.id - b.id);
  let lastCam = -1;
  for (const m of mons) {
    if (!m.alive || G.over) continue;
    if (!m.awake) {
      if (!alive().some(u => u.side !== 2 && dist(u, m) <= AGGRO)) continue;
      wakeCamp(m);
      play(m, A.cheer, true);
      await wait(180);
    }
    // 換一群怪就把鏡頭帶過去（同一群的不重複移動）
    if (m.camp !== lastCam) { lastCam = m.camp; await moveCam(m.x, m.y); }
    m.turned = false;
    for (const k in m.cds) if (m.cds[k] > 0) m.cds[k]--;


    // 找最近的英雄（同距離取 id 小的，兩邊才會算出一樣的結果）
    let tgt = null, bd = 1e9;
    for (const u of alive()) {
      if (u.side === 2) continue;
      const d = dist(u, m);
      if (d < bd || (d === bd && tgt && u.id < tgt.id)) { bd = d; tgt = u; }
    }
    if (!tgt) continue;

    // 仇恨鏈：追出營地 LEASH 格就放棄，回頭並重新睡下
    const home = CAMPS[m.camp] || { x: m.home[0], y: m.home[1] };
    if (dist(tgt, home) > LEASH + rngOf(m)) {
      if (dist(m, home) > 1) {
        const r0 = reachOf(m);
        let back = null, bc = 1e9;
        for (const [sx, sy] of r0.stops) {
          const d = Math.abs(sx - home.x) + Math.abs(sy - home.y);
          if (d < bc) { bc = d; back = [sx, sy]; }
        }
        if (back && (back[0] !== m.x || back[1] !== m.y)) await animMove(m, pathTo(r0, m, back[0], back[1]));
      } else { m.awake = false; m.wokeAt = 0; }
      continue;
    }

    if (bd <= rngOf(m)) {
      await mAttack(m, tgt);
      continue;
    }
    // 走過去
    const r = reachOf(m);
    const hit = stopToHit(r, m, tgt.x, tgt.y);
    let dest = hit;
    if (!dest) {
      let bc = 1e9;
      for (const [sx, sy] of r.stops) {
        const d = Math.abs(sx - tgt.x) + Math.abs(sy - tgt.y);
        const c = d * 100 + r.cost[key(sx, sy)];
        if (c < bc) { bc = c; dest = [sx, sy]; }
      }
    }
    if (dest && (dest[0] !== m.x || dest[1] !== m.y)) await animMove(m, pathTo(r, m, dest[0], dest[1]));
    if (m.alive && dist(m, tgt) <= rngOf(m)) await mAttack(m, tgt);
  }
  busy = false;
  checkVictory();
}

async function mAttack(m, tgt) {
  await strike(m, tgt);
  if (tgt.hp <= 0) { await die(tgt, m); return; }
  if (canCounter(m, tgt)) {
    await wait(80);
    await strike(tgt, m);
    if (m.hp <= 0) await die(m, tgt); else gainExp(tgt, XP_CNT);
  }
}

/* ── 勝負 ── */

// 「殲滅敵軍」的判定移到 die() 裡即時做（見那邊的註解）——
// 只有敵方英雄親手完成團滅才算數，怪物打趴全隊不算。
// 這裡留著給呼叫端一個「遊戲是不是已經結束了」的統一出口。
function checkVictory() { return !!G.over; }
function endGame(side, why) {
  G.over = { side, why };
  clearOverlay(); hideCard(); hideForecast();
  $('winTitle').textContent = SIDE_N[side] + '勝利';
  $('winTitle').style.color = SIDE_CSS[side];
  $('winWhy').textContent = why;
  $('result').classList.remove('hide');
  log(`<b class="up">${SIDE_N[side]}獲勝 — ${why}</b>`);
}

/* ── 開新局 ── */

function newGame(seed, picks) {
  G.units.forEach(removeView);
  G.units = []; G.cur = 0; G.turn = 1; G.over = null;
  G.hold = [0, 0]; G.bag = [[], []]; G.books = [[], []];
  G.orbs = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];        // 技能精球
  G.gorbs = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];       // 裝備精球
  G.gold = [0, 0];                                    // 金幣
  G.arena = null;                                     // 不在競技場時是 null
  G.shop = null;                                      // 不在商店時是 null
  G.bagPhase = null;                                  // 不在背包回合時是 null
  G.news = [0, 0];                                    // 有沒有沒看過的新掉落
  G.picks = picks || [CLS_ORDER.slice(0, TEAM_SIZE), CLS_ORDER.slice(0, TEAM_SIZE)];
  PENDING = []; AURAS = []; bookSeq = 0;
  uidSeq = 0; itemSeq = 0; wakeSeq = 0;
  sel = null; phase = 'idle'; preMove = null; busy = false; skillMode = null;
  logs.length = 0;
  clearTags();
  $('result').classList.add('hide');
  clearOverlay(); hideCard(); hideForecast(); closeSkillBar();

  G.seed = seed;
  grng = mulberry32(seed ^ 0x9e3779b9);
  genMap(seed);
  buildWorld();
  refreshTraps();
  refreshPending();

  // 英雄：從營地往外一圈一圈排（跳過營地本身，那格站著城堡）
  for (let s = 0; s < 2; s++) {
    for (const cls of G.picks[s]) {
      const spot = freeNear(CAMP[s][0], CAMP[s][1], 1);
      if (spot) { const h = mkHero(s, cls, spot[0], spot[1]); h.act[0] = START_SKILL[cls]; }
    }
  }
  // 怪物營地
  for (const c of CAMPS) {
    const kinds = c.tier === 3 ? ['boss', 'warrior', 'mage', 'minion']
      : c.tier === 2 ? ['warrior', 'rogue', 'mage', 'minion']
      : ['minion', 'minion', 'rogue'];
    for (const k of kinds) {
      const spot = freeNear(c.x, c.y, 0);
      if (spot) mkMon(k, spot[0], spot[1], c);
    }
  }
  for (const u of G.units) buildUnitView(u);
  G.units.forEach(makeTag);

  camTarget.set(wx(CAMP[myTeam][0]), 0, wz(CAMP[myTeam][1]));
  camAz = myTeam === 0 ? Math.PI * 0.25 : Math.PI * 1.25;
  camDist = 30; updCam();

  dimDone(); refreshTop(); refreshRoster(); drawMinimap();
  log(`— 第 1 回合・<span class="s0">${SIDE_N[0]}</span> —`);
}
