/* ══════════════ 競技場 ══════════════
   每 ARENA_INTERVAL 回合結束時，雙方所有還站著的英雄被強制傳送到一個
   16×16 的小競技場，打**一場**——先把對方全部打倒的一方獲勝就結束
   （不是同一輪三戰兩勝；那個規則以後可能會再改，現在先簡單一輪定勝負）。
   結束後所有人回到原本在主戰場的位置，血量統一恢復到上限的一半——
   這樣進競技場才有風險，不是純粹白拿獎勵的小遊戲。
   場上有一次性的增益地塊，走過去就撿到、用掉就消失。地形跟增益地塊
   的位置每次都重新隨機，但兩邊用同一個種子算，畫面會完全一致。 */

const ARENA_INTERVAL = 5;    // 每幾回合結束強制開一次
const ARENA_SIZE = 16;
const ARENA_GOLD_WIN = 40, ARENA_GOLD_LOSE = 10;

// 四種一次性增益，撿到立刻生效、從地上消失
const ARENA_BUFF_KINDS = ['power', 'charge', 'guard', 'haste'];
let ARENA_BUFFS = {};   // key 'x,y' -> 種類

function arenaSpawns() {
  return { 0: [[1, 14], [2, 14], [1, 13]], 1: [[14, 1], [13, 1], [14, 2]] };
}

// 地形跟增益地塊的位置都用亂數決定，但種子固定用「主局種子 × 這次進場的回合數」，
// 兩邊各自算出來的結果保證一致，不需要多送一個網路訊息去同步佈局
function genArenaMap() {
  const n = ARENA_SIZE;
  W = H = n; THRONE = [n >> 1, n >> 1]; CAMP = [[1, 14], [14, 1]];
  MAP = [];
  for (let y = 0; y < n; y++) { MAP[y] = []; for (let x = 0; x < n; x++) MAP[y][x] = 'P'; }
  const mirror = (x, y) => [n - 1 - x, n - 1 - y];
  const put = (x, y, t) => {
    if (!inBoard(x, y)) return;
    MAP[y][x] = t;
    const [mx, my] = mirror(x, y);
    if (inBoard(mx, my)) MAP[my][mx] = t;
  };
  const near = (x, y, cx, cy, r) => Math.abs(x - cx) + Math.abs(y - cy) <= r;
  const nearSpawn = (x, y) => near(x, y, 1, 14, 2) || near(x, y, 14, 1, 2);

  const arRng = mulberry32((G.seed ^ (G.turn * 0x1000193)) >>> 0);
  // 石頭：純障礙物——不可通行、擋視線、沒有任何加成，跟主地圖的山地／森林分開處理
  const rockCount = 4 + Math.floor(arRng() * 4);
  for (let i = 0; i < rockCount; i++) {
    const x = 2 + Math.floor(arRng() * (n - 4)), y = 2 + Math.floor(arRng() * (n - 4));
    if (nearSpawn(x, y)) continue;
    put(x, y, 'K');
    // 偶爾黏一格出來，讓障礙看起來像一叢石頭而不是孤零零一格
    if (arRng() < 0.4) {
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(arRng() * 4)];
      if (!nearSpawn(x + dx, y + dy)) put(x + dx, y + dy, 'K');
    }
  }
  // 地形變化：森林／山地／沼澤照舊可以走，只是帶著各自的加成與代價，每次隨機
  const terrainCount = 5 + Math.floor(arRng() * 5);
  const varietyTer = ['F', 'F', 'M', 'S'];
  for (let i = 0; i < terrainCount; i++) {
    const x = 2 + Math.floor(arRng() * (n - 4)), y = 2 + Math.floor(arRng() * (n - 4));
    if (nearSpawn(x, y) || MAP[y][x] !== 'P') continue;
    put(x, y, varietyTer[Math.floor(arRng() * varietyTer.length)]);
  }

  CAMPS = []; CHESTS = []; TRAPS = [];
  ARENA_BUFFS = {};
  // 四種增益各放一個，盡量分散、避開出生角落和已經是障礙物的格子
  const spots = [];
  let guard = 0;
  while (spots.length < ARENA_BUFF_KINDS.length && guard++ < 300) {
    const x = 2 + Math.floor(arRng() * (n - 4)), y = 2 + Math.floor(arRng() * (n - 4));
    if (nearSpawn(x, y) || MAP[y][x] !== 'P') continue;
    if (spots.some(s => Math.abs(s[0] - x) + Math.abs(s[1] - y) < 3)) continue;
    spots.push([x, y]);
  }
  ARENA_BUFF_KINDS.forEach((k, i) => { if (spots[i]) ARENA_BUFFS[spots[i][0] + ',' + spots[i][1]] = k; });
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

  toast('雙方被傳送到競技場！');
  log('<b class="up">── 競技場開打 ──</b>');
  arenaBanner();

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
  // 沒被傳送過去的（怪物、沒參賽的英雄）整批凍結，見 alive()/unitAt() 的註解
  for (const u of G.units) u.paused = !participants.includes(u.id);
  // 主戰場上還在倒數復活的（凍結中）不該把倒數圈畫進小小的競技場裡——
  // 不然畫面上會飄著幾個跟這場戰鬥完全無關、座標還是主地圖那套算出來的圈圈
  refreshRespawn();

  G.arena = { saved, participants };
  refreshArenaBuffTiles();
  camAz = Math.PI * 0.25; camDist = 22;
  camJob++;                          // 作廢任何還在飛的鏡頭補間（例如剛才 startTurn() 那個沒等的），
  camTarget.set(wx(7), 0, wz(8));    // 不然它跑完會把鏡頭拉回舊地圖的座標，畫面對不上新的小競技場
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
// 純粹雙方輪流，直到一輪打到只剩一邊站著（在 arenaDie() 裡反應式判定）
async function arenaEndTurn() {
  arenaStartTurn(G.cur === 0 ? 1 : 0);
}

// 這裡跟主賽事的 die() 分開走：不掉經驗、不進倒下復活、不觸發殲滅判定，
// 純粹只是「這場淘汰」，資源全部留給正式比賽用
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
  if (!arenaAliveSide(u.side)) { await wait(400); await exitArena(1 - u.side); }
}

async function exitArena(winnerSide) {
  log(`<b class="s${winnerSide}">${SIDE_N[winnerSide]}</b> 贏得競技場！`);
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
    u.alive = true;                                   // 這場就算在競技場被淘汰，回主戰場照樣站著
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
  camJob++;                          // 同上：作廢任何還沒跑完的鏡頭補間，回主地圖時鏡頭才會準確歸位
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
  const names = { power: '力量增幅', charge: '蓄力', guard: '守護', haste: '迅捷' };
  floatText(u.x, u.y, names[kind] + '！', 'up');
  if (kind === 'power') {
    addSt(u, u, { id: 'atk', pct: 0.2, turns: 3 });
    log(`<span class="s${u.side}">${nameOf(u)}</span> 撿到「力量增幅」，攻擊 +20%（3 回合）`);
  } else if (kind === 'charge') {
    u.charged = true;
    log(`<span class="s${u.side}">${nameOf(u)}</span> 撿到「蓄力」，下一次普通攻擊 +50% 傷害`);
  } else if (kind === 'guard') {
    addSt(u, u, { id: 'shield', pct: 1.5, turns: 3 });
    log(`<span class="s${u.side}">${nameOf(u)}</span> 撿到「守護」，獲得一層護盾（3 回合）`);
  } else if (kind === 'haste') {
    addSt(u, u, { id: 'mov', val: 2, turns: 2 });
    log(`<span class="s${u.side}">${nameOf(u)}</span> 撿到「迅捷」，移動 +2（2 回合）`);
  }
  await wait(250);
}

// 進競技場的轉場動畫：獨立一套，不走 showBanner()「飛到小面板」那套邏輯——
// 進競技場是雙方共同的大事件，值得比一般換邊回合更隆重一點。
// 節奏：灰階模糊淡入＋字放大（0.7 秒）→ 字左右搖晃像船一樣，維持到第 3 秒 →
// 灰色背景從畫面邊緣退回中心（2 秒），文字跟背景同時開始收、同時消失完，
// 不是背景先開始退、字晚一點才跟——兩個要在同一刻結束。
// 不 await 呼叫端——這純粹是疊在畫面上的動畫，不該卡住地圖/鏡頭的真正切換。
async function arenaBanner() {
  const el = $('arenaFx'), txt = $('arenaFxTxt');
  el.style.setProperty('--r', '0%');
  el.style.setProperty('--blur', '0px');
  txt.className = '';
  txt.style.transition = 'none';
  txt.style.transform = 'scale(.3)';
  txt.style.opacity = '0';
  el.classList.remove('hide');
  void el.offsetWidth;
  el.classList.add('show');

  await tween(700, k => {
    const e = easeOut(k);
    el.style.setProperty('--r', (e * 120) + '%');
    el.style.setProperty('--blur', (e * 6) + 'px');
    txt.style.transform = `scale(${0.3 + 0.7 * e})`;
    txt.style.opacity = e;
  });
  // 進場補間結束後要把 inline 的 transform/opacity 清掉，不然等一下切到
  // .grown／.leaving 這兩個用 class 控制動畫的階段，inline 樣式優先權比 class
  // 高，會把 CSS 動畫「應該要動的值」蓋掉，變成看起來完全沒有搖晃／滑出效果。
  txt.style.transition = '';
  txt.style.transform = '';
  txt.style.opacity = '';
  txt.classList.add('grown');

  await wait(3000 - 700);

  txt.classList.remove('grown');
  txt.classList.add('leaving');   // 跟灰色背景同時開始收，兩個一起在退場動畫跑完的那一刻消失
  await tween(2000, k => {
    const e = k * k;   // ease-in：退場一開始慢，後面加速收尾
    el.style.setProperty('--r', (120 * (1 - e)) + '%');
    el.style.setProperty('--blur', (6 * (1 - e)) + 'px');
  });
  el.classList.remove('show');
  el.classList.add('hide');
}
