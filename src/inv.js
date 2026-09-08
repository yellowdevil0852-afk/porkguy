/* ══════════════ 技能書、精球、掉落 ══════════════ */

let bookSeq = 0;

// 主動槽 Lv1/3/6，被動槽 Lv4
const actSlots = u => (u.lv >= 6 ? 3 : u.lv >= 3 ? 2 : 1);
const hasPasSlot = u => u.lv >= 4;

// 這一側現在有哪些職業（抽技能時只抽用得到的）
const sideClasses = side => [...new Set(G.units.filter(u => u.side === side && isHero(u)).map(u => u.cls))];

// 依品質權重擲一個品質
function rollQ(table) {
  let r = grng() * 100;
  for (let i = 0; i < 5; i++) { r -= table[i]; if (r < 0) return i; }
  return 0;
}
const Q_TABLE = {
  1: [45, 35, 16, 4, 0],
  3: [25, 33, 27, 13, 2],
  5: [10, 22, 32, 26, 10],
  boss: [0, 10, 30, 40, 20],
  gold: [0, 15, 35, 35, 15]
};

// 抽一個該品質、本隊用得到的技能
function rollSkill(side, q) {
  const cls = sideClasses(side);
  const pool = SK_IDS.filter(id => SK[id].q === q && cls.some(c => skCanUse(c, id)));
  if (!pool.length) return null;
  return pool[Math.floor(grng() * pool.length)];
}
function giveBook(side, q) {
  const id = rollSkill(side, q);
  if (!id) return null;
  return giveBookId(side, id);
}
// 給一本指定的技能書——商店拍賣要先讓雙方都看到「賣的是哪一本」，
// 得標之後給的必須是同一本，不能像 giveBook() 那樣重骰
function giveBookId(side, id) {
  const b = { bid: ++bookSeq, id };
  G.books[side].push(b);
  return b;
}

// 分解成精球；三顆同品質換一個高一階的技能
function dismantle(side, bid) {
  const i = G.books[side].findIndex(b => b.bid === bid);
  if (i < 0) return;
  const b = G.books[side][i];
  const q = SK[b.id].q;
  G.books[side].splice(i, 1);
  G.orbs[side][q]++;
  log(`分解了 <b class="q${q}">${SK[b.id].n}</b>，得到 1 顆${QN[q]}精球`);
}
function craft(side, q) {
  if (G.orbs[side][q] < 3) { toast('精球不夠，需要三顆'); return; }
  const nq = Math.min(4, q + 1);
  const id = rollSkill(side, nq);
  if (!id) { toast('這個品質沒有你們用得到的技能'); return; }
  G.orbs[side][q] -= 3;
  G.books[side].push({ bid: ++bookSeq, id });
  log(`三顆${QN[q]}精球合成了 <b class="q${nq}">${SK[id].n}</b>`);
  toast(`合成了 <b class="q${nq}">${SK[id].n}</b>`);
}

// 裝上／卸下技能
function setSkill(u, slot, id) {
  if (id && !skCanUse(u.cls, id)) { toast(nameOf(u) + ' 學不會這個技能'); return false; }
  if (slot === 'p') {
    if (id && !skIsPassive(id)) { toast('這是主動技能'); return false; }
    if (!hasPasSlot(u)) { toast('被動槽要 Lv.4 才會開'); return false; }
    u.pas = id;
  } else {
    if (id && skIsPassive(id)) { toast('這是被動技能'); return false; }
    if (slot >= actSlots(u)) { toast('這個技能槽還沒解鎖'); return false; }
    if (id && u.act.includes(id)) { toast('已經裝著同一個技能了'); return false; }
    u.act[slot] = id;
  }
  return true;
}

/* ── 裝備精球：跟技能同一套規則，但兩種精球分開算 ── */

function scrapItem(side, iid) {
  const i = G.bag[side].findIndex(x => x.iid === iid);
  if (i < 0) return;
  const it = G.bag[side][i];
  G.bag[side].splice(i, 1);
  G.gorbs[side][it.r]++;
  log(`分解了 <span class="r${it.r}">${itemName(it)}</span>，得到 1 顆${RARITY[it.r].n}裝備精球`);
}
// 一次拆掉某個品質以下的全部裝備
function scrapAll(side, maxR) {
  const list = G.bag[side].filter(it => it.r <= maxR);
  if (!list.length) { toast('沒有可以分解的裝備'); return; }
  for (const it of list) scrapItem(side, it.iid);
  toast(`分解了 <b>${list.length}</b> 件裝備`);
}
function craftItem(side, r) {
  if (G.gorbs[side][r] < 3) { toast('裝備精球不夠，需要三顆'); return; }
  G.gorbs[side][r] -= 3;
  const it = rollItem(Math.min(4, r + 1));
  G.bag[side].push(it);
  log(`三顆${RARITY[r].n}裝備精球合成了 <span class="r${it.r}">${itemName(it)}</span> ${itemStats(it)}`);
  toast(`合成了 <span class="r${it.r}">${itemName(it)}</span>`);
}

// 掉落進包時先過一次自動分解門檻
function takeItem(side, it) {
  if (SET.autoScrap >= 0 && it.r <= SET.autoScrap) {
    G.gorbs[side][it.r]++;
    return false;
  }
  G.bag[side].push(it);
  return true;
}

/* ── 掉落 ── */
// 每擊殺一隻怪兩次獨立判定：25% 裝備、15% 技能書
// 金幣：怪群等級越高掉越多，不是機率而是固定小範圍——不然商店和競技場
// 靠機率湊不出穩定的經濟，玩家永遠不知道自己下一次能不能出得起價
function goldFromTier(tier) {
  const range = { boss: [20, 30], 3: [6, 10], 2: [4, 7], 1: [2, 4] }[tier] || [2, 4];
  return range[0] + Math.floor(grng() * (range[1] - range[0] + 1));
}
function giveGold(side, n) {
  if (n <= 0) return;
  G.gold[side] += n;
  markNews(side);
}

function monsterDrop(killer, m) {
  if (!isHero(killer)) return;
  const tier = MON[m.kind].boss ? 'boss' : (m.tier || 1) * 2 - 1;
  const tbl = Q_TABLE[tier] || Q_TABLE[1];
  let got = false;
  const gold = Math.round(goldFromTier(MON[m.kind].boss ? 'boss' : (m.tier || 1)) * (m.elite ? MON_ELITE.gold : 1));
  giveGold(killer.side, gold);
  floatText(m.x, m.y, '+' + gold + ' 金幣', 'up');
  // 精英變種掉落機率加倍，多打的那份風險要有更值得的回報
  if (grng() < (m.elite ? 0.5 : 0.25)) {
    const it = rollItem(rollQ(tbl));
    if (takeItem(killer.side, it)) {
      log(`　掉落 <span class="r${it.r}">${itemName(it)}</span> ${itemStats(it)}`);
      got = true;
    } else log(`　掉落 <span class="r${it.r}">${itemName(it)}</span>（自動分解）`);
  }
  if (grng() < (m.elite ? 0.3 : 0.15)) {
    const b = giveBook(killer.side, rollQ(tbl));
    if (b) { log(`　掉落技能書 <b class="q${SK[b.id].q}">${SK[b.id].n}</b>`); got = true; }
  }
  if (got) { markNews(killer.side); floatText(m.x, m.y, '掉落！', 'up'); }
}

/* ── 背包旁邊的驚嘆號 ── */
// 有沒看過的掉落，或有沒分配的屬性點時亮起來
// 有新掉落或剛升級就亮起來，打開背包看過就收掉
function markNews(side) { G.news[side] = 1; refreshBadge(); }
function refreshBadge() {
  $('bagBadge').classList.toggle('hide', !G.news[bagSide()]);
}
