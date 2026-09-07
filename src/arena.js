/* ══════════════ 競技場 ══════════════
   每 ARENA_INTERVAL 回合結束時，雙方所有還站著的英雄被強制傳送到一個
   固定 16×16 的小競技場，打「先拿到 ARENA_WINS 分」的三戰制。
   結束後所有人回到原本在主戰場的位置，血量統一恢復到上限的一半——
   這樣進競技場才有風險，不是純粹白拿獎勵的小遊戲。
   場上有一次性的增益地塊，走過去就撿到、用掉就消失，撿完當輪不會再長出來。 */

const ARENA_INTERVAL = 5;    // 每幾回合結束強制開一次
const ARENA_SIZE = 16;
const ARENA_WINS = 3;        // 先拿到幾分獲勝
const ARENA_GOLD_WIN = 40, ARENA_GOLD_LOSE = 10;

// 固定佈局，180° 對稱，不用亂數 —— 競技場的地形不需要每次都不一樣，
// 重點在雙方公平，用固定佈局最不容易出同步或平衡的意外
let ARENA_BUFFS = {};   // key 'x,y' -> 'power' | 'charge'，撿掉就從這裡刪掉

function arenaSpawns() {
  return { 0: [[1, 14], [2, 14], [1, 13]], 1: [[14, 1], [13, 1], [14, 2]] };
}

function genArenaMap() {
  const n = ARENA_SIZE;
  W = H = n; THRONE = [n >> 1, n >> 1]; CAMP = [[1, 14], [14, 1]];
  MAP = [];
  for (let y = 0; y < n; y++) { MAP[y] = []; for (let x = 0; x < n; x++) MAP[y][x] = 'P'; }
  const mirror = (x, y) => [n - 1 - x, n - 1 - y];
  const put = (x, y, t) => { MAP[y][x] = t; const [mx, my] = mirror(x, y); MAP[my][mx] = t; };
  // 中央一叢障礙卡位置，兩側各留一點森林
  put(6, 6, 'M'); put(7, 7, 'M'); put(6, 7, 'F'); put(7, 6, 'F');
  put(2, 8, 'F'); put(13, 7, 'F');
  CAMPS = []; CHESTS = []; TRAPS = [];
  ARENA_BUFFS = {};
  const setBuff = (x, y, kind) => { ARENA_BUFFS[x + ',' + y] = kind; const [mx, my] = mirror(x, y); ARENA_BUFFS[mx + ',' + my] = kind; };
  setBuff(4, 4, 'power');
  setBuff(4, 11, 'charge');
}

const arenaUnits = side => (G.arena ? G.arena.participants.map(byId).filter(u => u && u.side === side) : []);
const arenaAliveSide = side => arenaUnits(side).some(u => u.alive);

async function enterArena() {
  const p0 = alive().filter(u => u.side === 0 && isHero(u));
  const p1 = alive().filter(u => u.side === 1 && isHero(u));
  if (!p0.length || !p1.length) {
    log('雙方至少要各有一個站著的英雄才能開競技場，這次跳過。');
    await monsterPhase();
    if (G.over) return;
    G.turn++;
    await startTurn(0);
    return;
  }

  toast('雙方被傳送到競技場！先拿到 ' + ARENA_WINS + ' 分獲勝');
  log('<b class="up">── 競技場開打：先拿到 ' + ARENA_WINS + ' 分獲勝 ──</b>');

  const saved = {
    seed: G.seed, w: W, heroPos: {},
    chestsOpened: CHESTS.map(c => c.opened), traps: TRAPS.slice()
  };
  for (const u of [...p0, ...p1]) saved.heroPos[u.id] = [u.x, u.y];

  G.units.forEach(removeView);
  clearTags();
  genArenaMap();
  buildWorld();
  refreshTraps();

  const spawns = arenaSpawns();
  const at = { 0: 0, 1: 0 };
  const participants = [];
  for (const u of [...p0, ...p1]) {
    u.hp = mhpOf(u); u.st = []; u.moved = false; u.acted = false; u.turned = false;
    for (const k in u.cds) u.cds[k] = 0;
    const spot = spawns[u.side][at[u.side]++];
    u.x = spot[0]; u.y = spot[1]; u.dir = u.side === 0 ? 3 : 7;
    buildUnitView(u); makeTag(u);
    participants.push(u.id);
  }
  // 沒被傳送過去的（怪物、沒參賽的英雄）整批凍結，見上面 alive()/unitAt() 的註解
  for (const u of G.units) u.paused = !participants.includes(u.id);

  G.arena = { wins: [0, 0], round: 1, saved, participants };
  refreshArenaBuffTiles();
  camAz = Math.PI * 0.25; camDist = 22;
  camTarget.set(wx(7), 0, wz(8));
  updCam();
  refreshTop(); refreshRoster(); drawMinimap();
  arenaStartTurn(0);
}

function arenaStartTurn(side) {
  G.cur = side;
  for (const u of arenaUnits(side)) {
    if (!u.alive) continue;
    u.moved = false; u.acted = false; u.turned = false; u.hitOnce = 0;
    for (const k in u.cds) if (u.cds[k] > 0) u.cds[k]--;
    if (!canMoveU(u)) u.moved = true;
    if (!canActU(u)) u.acted = true;
  }
  dimDone(); refreshTop(); refreshRoster();
  turnBanner();
  if (aiOn && mode === 'local' && side === AI_SIDE) setTimeout(aiTurn, 500);
}

// 只有 doEndTurn() 判斷 G.arena 存在時才會走到這裡——競技場裡沒有魔物階段，
// 純粹雙方輪流，直到某一輪打到只剩一邊站著（在 arenaDie() 裡反應式判定）
async function arenaEndTurn() {
  arenaStartTurn(G.cur === 0 ? 1 : 0);
}

// 這裡跟主賽事的 die() 分開走：不掉經驗、不進倒下復活、不觸發殲滅判定，
// 純粹只是「這一輪淘汰」，資源全部留給正式比賽用
async function arenaDie(u) {
  u.alive = false;
  log(`<span class="kill">${nameOf(u)} 在競技場倒下了</span>`);
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
  refreshRoster();
  if (!arenaAliveSide(u.side)) await arenaRoundOver(1 - u.side);
}

async function arenaRoundOver(winnerSide) {
  G.arena.wins[winnerSide]++;
  log(`<b class="s${winnerSide}">${SIDE_N[winnerSide]}</b> 贏得競技場第 ${G.arena.round} 輪（${G.arena.wins[0]}：${G.arena.wins[1]}）`);
  toast(`<b class="s${winnerSide}">${SIDE_N[winnerSide]}</b> 贏得第 ${G.arena.round} 輪！`);
  if (G.arena.wins[winnerSide] >= ARENA_WINS) { await wait(500); await exitArena(winnerSide); return; }
  await wait(600);
  resetArenaRound();
}

function resetArenaRound() {
  G.arena.round++;
  const spawns = arenaSpawns();
  const at = { 0: 0, 1: 0 };
  genArenaMap();               // 增益地塊重新長出來、地形重新蓋一次
  buildWorld();
  refreshTraps();
  for (const id of G.arena.participants) {
    const u = byId(id);
    if (!u) continue;
    u.alive = true; u.hp = mhpOf(u); u.st = []; u.moved = false; u.acted = false; u.turned = false;
    for (const k in u.cds) u.cds[k] = 0;
    const spot = spawns[u.side][at[u.side]++];
    u.x = spot[0]; u.y = spot[1]; u.dir = u.side === 0 ? 3 : 7;
    buildUnitView(u); makeTag(u);
  }
  refreshArenaBuffTiles();
  refreshTop(); refreshRoster(); drawMinimap();
  arenaStartTurn(0);
}

async function exitArena(winnerSide) {
  log(`<b class="s${winnerSide}">${SIDE_N[winnerSide]}</b> 拿下整場競技場！`);
  giveGold(0, winnerSide === 0 ? ARENA_GOLD_WIN : ARENA_GOLD_LOSE);
  giveGold(1, winnerSide === 1 ? ARENA_GOLD_WIN : ARENA_GOLD_LOSE);
  toast(`競技場結束，<b class="s${winnerSide}">${SIDE_N[winnerSide]}</b>獲勝！雙方都拿到了金幣`);
  await wait(700);

  const { saved, participants } = G.arena;
  G.units.forEach(removeView);
  clearTags();
  setSize(saved.w);
  genMap(saved.seed);           // 地圖生成的 rng 跟戰鬥用的 grng 是分開的兩條，
  buildWorld();                 // 重新產生完全一樣的主地圖不會弄亂正在進行的戰鬥亂數
  CHESTS.forEach((c, i) => { c.opened = !!saved.chestsOpened[i]; });
  TRAPS = saved.traps;
  refreshChests(); refreshTraps();

  for (const id of participants) {
    const u = byId(id);
    if (!u) continue;
    const pos = saved.heroPos[id];
    u.x = pos[0]; u.y = pos[1];
    u.alive = true;                                   // 這輪就算在競技場被淘汰，回主戰場照樣站著
    u.hp = Math.max(1, Math.ceil(mhpOf(u) / 2));       // 統一回復一半——這是進競技場的風險代價
    u.st = [];
    u.dir = u.side === 0 ? 3 : 7;
  }
  for (const u of G.units) u.paused = false;   // 解凍，主戰場的怪物和其他英雄恢復正常
  for (const u of G.units) if (u.alive) { buildUnitView(u); makeTag(u); }
  refreshRespawn();
  ARENA_BUFFS = {};
  refreshArenaBuffTiles();   // 清掉還留在畫面上的增益地塊光環
  G.arena = null;
  camTarget.set(wx(THRONE[0]), 0, wz(THRONE[1])); camDist = 30; updCam();
  refreshTop(); refreshRoster(); drawMinimap();
  if (checkVictory()) return;

  G.turn++;
  await startTurn(0);
}

// 走到增益地塊上就撿走，一次性——跟開寶箱共用「移動結束後檢查腳下」的呼叫點
async function pickupArenaBuff(u) {
  if (!isHero(u)) return;
  const key = u.x + ',' + u.y;
  const kind = ARENA_BUFFS[key];
  if (!kind) return;
  delete ARENA_BUFFS[key];
  refreshArenaBuffTiles();
  if (kind === 'power') {
    addSt(u, u, { id: 'atk', pct: 0.3, turns: 3 });
    floatText(u.x, u.y, '力量增幅！', 'up');
    log(`<span class="s${u.side}">${nameOf(u)}</span> 撿到「力量增幅」，攻擊 +30%（3 回合）`);
  } else {
    u.charged = true;
    floatText(u.x, u.y, '蓄力！', 'up');
    log(`<span class="s${u.side}">${nameOf(u)}</span> 撿到「蓄力」，下一次普通攻擊 +100% 傷害`);
  }
  await wait(250);
}
