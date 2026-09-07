/* ══════════════ 商店 ══════════════
   每 SHOP_INTERVAL 回合結束，開一次商店：5 件商品依品質由低到高依序拍賣，
   保底一件金色。回合制競標——不是即時倒數，雙方輪流「加價」或「放棄」，
   這樣完全不用處理「兩人同時出價」這種需要一個公正裁判才能判定的情況，
   P2P 對等連線沒有這種裁判角色。
   加價門檻跟著品質走：白 10、綠 20、藍 30、紫 40、金 50。 */

const SHOP_INTERVAL = 3;
const SHOP_MIN_RAISE = q => (q + 1) * 10;

// 商店賣的技能不分邊——只要兩隊當中有人的職業學得會就算數，
// 賣家不知道最後花落誰家，這樣才是真的在「拍賣」而不是各自的掉落池
function rollShopSkill(q) {
  const cls = [...new Set([...(G.picks[0] || []), ...(G.picks[1] || [])])];
  const pool = SK_IDS.filter(id => SK[id].q === q && cls.some(c => skCanUse(c, id)));
  if (!pool.length) return null;
  return pool[Math.floor(grng() * pool.length)];
}

function rollShopItem(q) {
  if (grng() < 0.5) {
    const id = rollShopSkill(q);
    if (id) return { kind: 'skill', q, id };
  }
  return { kind: 'gear', q, it: rollItem(q) };
}

function genShopItems() {
  const items = [];
  for (let i = 0; i < 4; i++) items.push(rollShopItem(rollQ(Q_TABLE[3])));
  items.push(rollShopItem(4));                 // 保底一件金色
  items.sort((a, b) => a.q - b.q);              // 由低到高依序拍賣
  return items;
}

const shopItemName = it => it.kind === 'skill' ? SK[it.id].n : itemName(it.it);
const shopItemDesc = it => it.kind === 'skill' ? SK[it.id].d : itemStats(it.it);
const shopItemType = it => it.kind === 'skill' ? (skIsPassive(it.id) ? '被動技能' : '主動技能') : SLOT_N[it.it.slot];

async function enterShop() {
  const items = genShopItems();
  G.shop = { items, idx: 0, bid: 0, bidder: -1, turn: 0, passStreak: 0 };
  log('<b class="up">── 商店開張：5 件商品依序拍賣 ──</b>');
  toast('商店開張！雙方輪流出價');
  refreshTop();
  openShop();
  aiShopMaybeBid();
}

function startShopAuction() {
  const s = G.shop;
  s.bid = 0; s.bidder = -1; s.passStreak = 0;
  s.turn = s.idx % 2;
  refreshShopUI();
  aiShopMaybeBid();
}

// 把商品交給得標的一方——技能給指定那一本，不能重骰；裝備照掉落規則
// 過一次自動分解門檻（可能直接變精球，效果跟怪物掉落一致）
function awardShopItem(side, item) {
  if (item.kind === 'skill') {
    const b = giveBookId(side, item.id);
    log(`<b class="s${side}">${SIDE_N[side]}</b> 標下技能書 <b class="q${item.q}">${SK[item.id].n}</b>`);
    return b;
  }
  const kept = takeItem(side, item.it);
  log(`<b class="s${side}">${SIDE_N[side]}</b> 標下 <span class="r${item.q}">${itemName(item.it)}</span> ${itemStats(item.it)}` +
    (kept ? '' : '（自動分解）'));
  markNews(side);
}

function finishAuction(winner) {
  const s = G.shop;
  const item = s.items[s.idx];
  if (winner >= 0) {
    G.gold[winner] -= s.bid;
    awardShopItem(winner, item);
    toast(`<b class="s${winner}">${SIDE_N[winner]}</b> 以 <b>${s.bid}</b> 金幣標下「${shopItemName(item)}」！`);
  } else {
    log(`「${shopItemName(item)}」沒人出價，流標。`);
  }
  s.idx++;
  refreshRoster(); refreshBadge();
  if (s.idx >= s.items.length) { exitShop(); return; }
  startShopAuction();
}

function doShopBid(amount) {
  const side = mode === 'online' ? myTeam : G.shop.turn;
  if (!G.shop || G.shop.turn !== side) { toast('現在不是你出價'); return; }
  const item = G.shop.items[G.shop.idx];
  const min = G.shop.bid + SHOP_MIN_RAISE(item.q);
  amount = amount || min;
  // 之前這裡會把出不起的金額硬夾回 min，等於偷偷送出一個超過自己金幣的出價——
  // applyShopBid() 會擋下來，但玩家什麼提示都看不到，回合就卡住不會往下走。
  if (amount < min) { toast('至少要加價到 ' + min); return; }
  if (amount > G.gold[side]) { toast('金幣不夠，你只有 ' + G.gold[side]); return; }
  const a = { kind: 'shopbid', side, amount };
  if (mode === 'online') netSend({ t: 'act', a });
  applyShopBid(a);
}
function applyShopBid(a) {
  const s = G.shop;
  if (!s || s.turn !== a.side) return;
  const item = s.items[s.idx];
  const min = s.bid + SHOP_MIN_RAISE(item.q);
  if (a.amount < min || a.amount > G.gold[a.side]) return;
  s.bid = a.amount; s.bidder = a.side; s.turn = 1 - a.side; s.passStreak = 0;
  log(`<span class="s${a.side}">${SIDE_N[a.side]}</span> 出價 <b>${a.amount}</b> 金幣競標「${shopItemName(item)}」`);
  refreshShopUI();
  aiShopMaybeBid();
}

function doShopPass() {
  const side = mode === 'online' ? myTeam : G.shop.turn;
  if (!G.shop || G.shop.turn !== side) { toast('現在不是你決定'); return; }
  const a = { kind: 'shoppass', side };
  if (mode === 'online') netSend({ t: 'act', a });
  applyShopPass(a);
}
function applyShopPass(a) {
  const s = G.shop;
  if (!s || s.turn !== a.side) return;
  if (s.bidder >= 0) { finishAuction(s.bidder); return; }
  if (s.passStreak) { finishAuction(-1); return; }
  s.passStreak = 1;
  s.turn = 1 - a.side;
  refreshShopUI();
  aiShopMaybeBid();
}

async function exitShop() {
  log('<b class="up">── 商店結束 ──</b>');
  G.shop = null;
  closeShop();
  refreshTop(); refreshRoster();
  await monsterPhase();
  if (G.over) return;
  G.turn++;
  await startTurn(0);
}

/* ── 商店面板 ── */

function openShop() {
  $('shopOv').classList.remove('hide');
  refreshShopUI();
}
function closeShop() {
  $('shopOv').classList.add('hide');
}

function refreshShopUI() {
  if (!G.shop) { $('shopOv').classList.add('hide'); return; }
  const s = G.shop;
  $('shopList').innerHTML = s.items.map((it, i) => {
    const cls = 'shItem q' + it.q + (i === s.idx ? ' cur' : i < s.idx ? ' done' : '');
    return `<div class="${cls}"><b>${shopItemName(it)}</b><em>${QN[it.q]}・${shopItemType(it)}</em></div>`;
  }).join('');

  const item = s.items[s.idx];
  const mySide = mode === 'online' ? myTeam : s.turn;
  const myGo = mode === 'online' ? s.turn === myTeam : true;
  const min = s.bid + SHOP_MIN_RAISE(item.q);

  $('shopCur').innerHTML = `<h5 class="q${item.q}">${shopItemName(item)}<em>${QN[item.q]}・${shopItemType(item)}</em></h5>
    <p>${shopItemDesc(item)}</p>
    <div class="sr">目前出價　<b>${s.bidder >= 0 ? s.bid + ' 金幣（' + SIDE_N[s.bidder] + '）' : '尚無人出價'}</b></div>
    <div class="sr">最低加價　<b>${SHOP_MIN_RAISE(item.q)}</b>　　你的金幣　<b>${G.gold[mySide]}</b></div>`;

  $('shopWhoseTurn').innerHTML = `輪到 <b class="s${s.turn}">${SIDE_N[s.turn]}</b>` +
    (mode === 'online' ? (myGo ? '（你）' : '（對手，請稍候）') : '');
  const amt = $('shopBidAmt');
  amt.min = min; amt.max = Math.max(min, G.gold[mySide]); amt.value = Math.min(min, G.gold[mySide]) || min;
  $('shopBidBtn').disabled = !myGo || G.gold[mySide] < min;
  $('shopPassBtn').disabled = !myGo;
}

// 電腦對手的簡單出價策略：本機單人模式才會用到。錢夠、品質不差就跟一手，
// 不然就放棄——不試圖抓什麼「值不值得」的精算，純粹讓商店回合能自己跑完
function aiShopMaybeBid() {
  if (!(aiOn && mode === 'local')) return;
  const s = G.shop;
  if (!s || s.turn !== AI_SIDE) return;
  setTimeout(() => {
    if (!G.shop || G.shop.turn !== AI_SIDE) return;
    const item = s.items[s.idx];
    const min = s.bid + SHOP_MIN_RAISE(item.q);
    const afford = G.gold[AI_SIDE] >= min + SHOP_MIN_RAISE(item.q) * 2;   // 留點餘裕，別把錢花光
    if (afford && grng() < 0.6) doShopBid(min); else doShopPass();
  }, 500);
}
