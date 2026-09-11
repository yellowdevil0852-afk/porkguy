/* ══════════════ 電腦對手 ══════════════
   貪心式：每次挑「當下分數最高」的那個單位行動，直到沒有值得做的事為止。
   只在本機對戰生效，線上對戰有真人就不需要。 */

let aiOn = false;
const AI_SIDE = 1;

function setAI(on) {
  aiOn = on;
  const b = $('btnAI');
  b.textContent = 'AI 對手：' + (on ? '開' : '關');
  b.classList.toggle('prime', on);
  toast(on ? `電腦接管<span class="s${AI_SIDE}">${SIDE_N[AI_SIDE]}</span>` : '電腦已關閉，紅軍改回手動');
  if (on && mode === 'local' && G.cur === AI_SIDE && !busy && !G.over) setTimeout(aiTurn, 400);
}

/* ── 目標選擇 ── */

function aiGoal(u) {
  const thr = { x: THRONE[0], y: THRONE[1] };

  // 牧師不衝鋒，跟著隊伍走，優先靠近傷得最重的隊友
  if (base(u).healPct) {
    let hurt = null, worst = 0.85, near = null, nd = 1e9;
    for (const o of alive()) {
      if (o.side !== u.side || o === u) continue;
      const r = o.hp / mhpOf(o);
      if (r < worst) { worst = r; hurt = o; }
      const d = dist(u, o);
      if (d < nd) { nd = d; near = o; }
    }
    if (hurt) return hurt;
    if (near && nd > 3) return near;
    return thr;
  }

  // 對方在佔王座 → 全隊回防
  if (G.hold[1 - u.side] > 0) return thr;

  // 順路的寶箱先撿
  let best = null, bd = 11;
  for (const c of CHESTS) {
    if (c.opened) continue;
    const d = Math.abs(c.x - u.x) + Math.abs(c.y - u.y);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) return best;

  // 等級還低就先去打怪，練起來再上王座——但不能只看「最近」，不然新版怪物等級
  // 是連續漸層、離王座近的怪隨便都比自己高一大截，最近的那隻常常就是超等怪，
  // 揀到就是送死。距離照樣加分，但怪物等級明顯超過自己要重罰；分數太差
  // （附近全是啃不動的超等怪）就乾脆不衝，退回去顧王座。
  if (u.lv < 4) {
    let m = null, mb = -1e9;
    for (const o of alive()) {
      if (o.side !== 2) continue;
      const d = dist(u, o);
      if (d > 14) continue;
      const lvGap = o.lv - u.lv;
      let sc = -d * 2;
      if (lvGap > 2) sc -= (lvGap - 2) * 15;
      else if (lvGap < 0) sc += 3;
      if (sc > mb) { mb = sc; m = o; }
    }
    if (m && mb > -40) return m;
  }
  return thr;
}

// 站上王座值得，站著就別亂跑 —— 回傳當成 risk 加減，正數代表不想去
function thronePull(u, x, y) {
  if (u.side > 1) return 0;                             // 怪物不吃這條
  if (x === THRONE[0] && y === THRONE[1]) return -40;   // 想站上去
  if (G.thrOn === u.id) return 60;                      // 已經站著就別走開
  return 0;
}

// 站在這一格有多危險：附近敵人越多、地形越差就越不想站
function aiRisk(u, x, y) {
  let r = 0;
  for (const o of alive()) {
    if (o.side === u.side) continue;
    const d = Math.abs(o.x - x) + Math.abs(o.y - y);
    if (d <= rngOf(o)) r += 10 + atkOf(o) * 0.4;
    else if (d <= rngOf(o) + movOf(o) / 2) r += 3;
  }
  const t = TER[MAP[y][x]];
  r -= t.def * 2 + (t.high ? 3 : 0);
  return r;
}

/* ── 幫一個單位挑最好的一步 ── */

function aiPlan(u) {
  // 記住這回合開始時誰站在王座上（算分時 u 會被暫時搬走，不能當場問）
  const thr = unitAt(THRONE[0], THRONE[1]);
  G.thrOn = thr && thr.side === u.side ? thr.id : -1;
  const r = u.moved ? null : reachOf(u);
  const stops = r ? r.stops : [[u.x, u.y]];
  const bx = u.x, by = u.y;
  let best = null;
  // 只記落腳點，路徑等到單位座標還原之後才算
  // （pathTo 會拿 u.x/u.y 當起點對照，算分時 u 被暫時移走過，直接算會得到只有一格的路徑 → 看起來像瞬移）
  const take = p => { if (p && (!best || p.score > best.score)) best = p; };

  if (!u.acted) {
    for (const [sx, sy] of stops) {
      u.x = sx; u.y = sy;
      const risk = aiRisk(u, sx, sy) + thronePull(u, sx, sy);
      const step = r ? r.cost[key(sx, sy)] : 0;

      for (const t of G.units) {
        if (!t.alive || t.paused || t === u) continue;
        const d = Math.abs(t.x - sx) + Math.abs(t.y - sy);
        if (d < 1 || d > rngOf(u)) continue;
        // 石頭擋視線：AI 也要跟玩家一樣，射程內但被石頭擋住就打不到
        // （canReach 第一個參數要吃 dmgType，得傳真正的單位；u.x/u.y 這裡已經是候選落點 sx,sy 了）
        if (d > 1 && !canReach(u, t)) continue;

        if (t.side === u.side) {
          // 治療
          if (!base(u).healPct) continue;
          const need = mhpOf(t) - t.hp;
          if (need < 6) continue;
          take({ score: Math.min(need, healAmt(u)) * 9 - risk * 0.5 - step * 0.2,
                 action: { kind: 'heal', uid: u.id, tid: t.id, dest: [sx, sy] } });
          continue;
        }

        if (smokeBlocks(u, t)) continue;   // 煙霧彈：遠程鎖定不到，近戰不受影響

        const dmg = dmgCalc(u, t, {});
        const kill = dmg >= t.hp;
        // 搔癢式的攻擊不值得為它跑過去挨打
        if (dmg < 3 && !kill) continue;
        // 繳械不能普攻、嘲諷只能打嘲諷來源時，跳過普攻但技能補刀照舊
        const lock = tauntTid(u);
        const canBasic = canAtkU(u) && !(lock && t.id !== lock);
        if (canBasic) {
          const cnt = (!kill && canCounter(u, t)) ? dmgCalc(t, u, {}) : 0;
          let sc = Math.min(dmg, t.hp) * 10 + (kill ? 70 : 0) - risk - step * 0.3;
          sc -= cnt * 9 + (cnt / u.hp) * 90;              // 反擊佔自己血量越高越怕
          if (t.side !== 2) sc += 15;                     // 打敵方英雄比打怪值錢
          if (cnt >= u.hp) sc -= 300;                     // 會被反擊打死就別去
          take({ score: sc, action: { kind: 'attack', uid: u.id, tid: t.id, dest: [sx, sy] } });
        }

        // 能一擊帶走的話，用技能補刀
        for (const id of (u.act || [])) {
          if (!id) continue;
          const s = SK[id];
          if (s.k !== 'single' || !skillReady(u, id) || d > skRng(u, s)) continue;
          const sd = dmgCalc(u, t, { mult: s.pct });
          take({ score: Math.min(sd, t.hp) * 10 + (sd >= t.hp ? 80 : 0) - risk - step * 0.3 + 5,
                 action: { kind: 'skill', uid: u.id, skill: id, tid: t.id, tx: t.x, ty: t.y,
                           dest: [sx, sy] } });
        }
      }
      u.x = bx; u.y = by;
    }
  }

  // 沒有值得出手的目標就往目標移動（分數壓得比攻擊低，攻擊永遠優先）
  if (!u.moved && r && (!best || best.score < 12)) {
    const g = aiGoal(u);
    // 治療者要跟上隊伍但別站到前線去
    const timid = base(u).healPct ? 4 : 1;
    let mv = null, mb = -1e9, safeMv = null, safeR = 1e9;
    for (const [sx, sy] of stops) {
      const risk = aiRisk(u, sx, sy);
      if (risk < safeR) { safeR = risk; safeMv = [sx, sy]; }
      const d = Math.abs(sx - g.x) + Math.abs(sy - g.y);
      // 風險的權重調高（0.6→1.2），不要為了少走一步硬鑽進一群敵人的攻擊範圍
      const sc = -d * 3 - risk * 1.2 * timid;
      if (sc > mb) { mb = sc; mv = [sx, sy]; }
    }
    // 往目標方向走最好的那一步風險還是很高，而且待在原地或退開明顯安全很多，
    // 就別硬衝，改站去這回合摸得到的最安全格子
    if (mv && aiRisk(u, mv[0], mv[1]) > 35 && safeR < aiRisk(u, bx, by) - 5) mv = safeMv;
    if (mv && (mv[0] !== bx || mv[1] !== by))
      take({ score: 8, action: { kind: 'move', uid: u.id, dest: mv } });
  }
  if (best) best.reach = r;
  return best;
}

/* ── 跑完一整個回合 ── */

// 電腦也要會整理技能：空槽補上品質最高的、用不到的分解、精球夠就合成
function aiBestBook(u, passive) {
  let best = null;
  for (const b of G.books[AI_SIDE]) {
    if (skIsPassive(b.id) !== passive || !skCanUse(u.cls, b.id)) continue;
    if (u.act.includes(b.id) || u.pas === b.id) continue;
    if (!best || SK[b.id].q > SK[best.id].q) best = b;
  }
  return best;
}
function aiSkills() {
  const heroes = G.units.filter(u => u.side === AI_SIDE && isHero(u));
  for (const u of heroes) {
    for (let i = 0; i < actSlots(u); i++) {
      if (u.act[i]) continue;
      const b = aiBestBook(u, false);
      if (b) applySetSkill({ uid: u.id, slot: i, bid: b.bid });
    }
    if (hasPasSlot(u) && !u.pas) {
      const b = aiBestBook(u, true);
      if (b) applySetSkill({ uid: u.id, slot: 'p', bid: b.bid });
    }
  }
  // 全隊都學不會的書留著也沒用，拆成精球
  for (const b of G.books[AI_SIDE].slice())
    if (!heroes.some(u => skCanUse(u.cls, b.id))) dismantle(AI_SIDE, b.bid);
  for (let q = 3; q >= 0; q--)
    while (G.orbs[AI_SIDE][q] >= 3) {
      const before = G.orbs[AI_SIDE][q];
      craft(AI_SIDE, q);
      if (G.orbs[AI_SIDE][q] === before) break;   // 合不出東西就別卡在這
    }
}

// 電腦接管的一方沒有玩家會去點背包，屬性點和裝備就只能放著不管——
// 每次輪到它出手前先自動分配掉，跟玩家自己按「一鍵裝備」／屬性點按鈕是同一套函式，
// 只是換電腦幫自己按。屬性點沒有精算，攻擊/生命/防禦輪流分一輪，不求最優、
// 求「至少不要浪費在那邊」。
function aiManageSelf() {
  const order = ['atk', 'hp', 'atk', 'def'];
  for (const u of G.units) {
    if (u.side !== AI_SIDE || !isHero(u)) continue;
    let i = 0;
    while (u.pts > 0) { doSpend(u, order[i % order.length]); i++; }
  }
  autoGearAll();
}

async function aiTurn() {
  if (!aiOn || mode !== 'local' || G.cur !== AI_SIDE || G.over) return;
  while (busy) await wait(120);
  aiManageSelf();
  aiSkills();

  for (let guard = 0; guard < 60; guard++) {
    if (!aiOn || G.over) return;                 // 中途被關掉就交還控制權
    let best = null;
    for (const u of G.units) {
      if (!u.alive || u.paused || u.side !== AI_SIDE || (u.moved && u.acted)) continue;
      const p = aiPlan(u);
      if (p && (!best || p.score > best.score)) best = p;
    }
    if (!best) break;
    const u = byId(best.action.uid);
    // 路徑等到現在才算，此時 u 的座標已經還原成真正的起點
    const a = best.action;
    if (a.dest && best.reach && (a.dest[0] !== u.x || a.dest[1] !== u.y))
      a.path = pathTo(best.reach, u, a.dest[0], a.dest[1]);
    delete a.dest;
    if (mode === 'local' && u) await moveCam(u.x, u.y);   // 讓玩家看得到電腦在幹嘛
    await runAction(a);
    await wait(180);
  }

  if (!aiOn || G.over) return;
  await wait(300);
  doEndTurn(true);
}
