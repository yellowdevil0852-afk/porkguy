/* ══════════════ 線上對戰（PeerJS / WebRTC）══════════════
   出手方把「做了什麼」送過去，兩邊跑同一套 runAction。
   所有牽涉亂數的地方都走 grng（同一個種子），所以不必傳骰子結果。 */

let net = { peer: null, conn: null, host: false };
let netQ = Promise.resolve(), ready = Promise.resolve();
const PREFIX = 'wztac2-';
const CODEC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mkCode = () => Array.from({ length: 6 },
  () => CODEC[Math.floor(Math.random() * CODEC.length)]).join('');

// 兩邊都在對稱式 NAT（常見於行動網路、部分公司／家用防火牆）後面時，光靠 STUN
// 常常連不出真正的媒體通道——signaling 看起來成功、UI 卻卡住不動，也不一定會噴
// error 事件。PeerJS 本身內建一組 TURN（turn.peerjs.com）當備援，但傳 `config`
// 選項是整個物件覆蓋掉、不是合併——沒把內建那組抄進來的話等於用掉了它，反而更差。
// 這裡把 PeerJS 內建的 TURN 跟另一個公開免費 TURN（Open Relay Project）都列進去，
// 兩組 TURN 誰能用就用誰，比只靠單一一組免費服務更耐操一點。
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

function netSend(o) { if (net.conn && net.conn.open) try { net.conn.send(o); } catch (e) {} }

function hookConn(c) {
  net.conn = c;
  c.on('open', () => {
    $('netTag').classList.remove('hide');
    $('netTag').textContent = '線上';
    toast('對手已連線');
    // 這裡不能直接送 sync：兩邊還在選角，這時候 serialize() 出來的是空局面。
    // 等房主選完、也收到客人的選角之後，startPlay() 才會送出真正的開局狀態。
  });
  c.on('data', m => { netQ = netQ.then(() => onNetData(m)).catch(e => console.error(e)); });
  c.on('close', () => { toast('對手已斷線，請對方用同一組房號重新加入'); $('netTag').textContent = '已斷線'; });
  c.on('error', () => toast('連線錯誤'));
}

function serialize() {
  return {
    seed: G.seed, w: W, cur: G.cur, turn: G.turn, hold: G.hold.slice(),
    units: G.units.map(u => ({
      id: u.id, side: u.side, cls: u.cls, kind: u.kind, x: u.x, y: u.y, dir: u.dir,
      hp: u.hp, lv: u.lv, exp: u.exp, alive: u.alive, moved: u.moved, acted: u.acted,
      awake: u.awake, equip: u.equip, cds: u.cds, st: u.st, act: u.act, pas: u.pas, down: u.down,
      pts: u.pts, alloc: u.alloc, swapEq: u.swapEq, swapSk: u.swapSk
    })),
    bag: G.bag, books: G.books, orbs: G.orbs, gorbs: G.gorbs, gold: G.gold, picks: G.picks,
    chests: CHESTS.map(c => c.opened ? 1 : 0), traps: TRAPS, iid: itemSeq, bid: bookSeq
  };
}

async function applySync(s) {
  G.units.forEach(removeView);
  clearTags();
  G.units = [];
  setSize(s.w || W);                    // 地圖大小以主機為準
  G.seed = s.seed;
  grng = mulberry32(s.seed ^ 0x9e3779b9);
  genMap(s.seed);
  buildWorld();
  CHESTS.forEach((c, i) => { c.opened = !!s.chests[i]; });
  refreshChests();
  TRAPS = s.traps || [];
  refreshTraps();
  G.cur = s.cur; G.turn = s.turn; G.hold = s.hold; G.bag = s.bag; G.over = null;
  G.books = s.books || [[], []];
  G.orbs = s.orbs || [[0,0,0,0,0],[0,0,0,0,0]];
  G.gorbs = s.gorbs || [[0,0,0,0,0],[0,0,0,0,0]];
  G.gold = s.gold || [0, 0];
  G.news = [0, 0];
  G.picks = s.picks || [[], []];
  itemSeq = s.iid || 0; bookSeq = s.bid || 0;
  uidSeq = 0;
  for (const d of s.units) {
    const u = Object.assign({ equip: {}, cds: {}, st: [], act: [null, null, null], pas: null,
      pts: 0, alloc: { atk: 0, def: 0, hp: 0 }, swapEq: {}, swapSk: {} }, d);
    uidSeq = Math.max(uidSeq, u.id + 1);
    G.units.push(u);
    if (u.alive) buildUnitView(u);
  }
  G.units.forEach(makeTag);
  camTarget.set(wx(CAMP[myTeam][0]), 0, wz(CAMP[myTeam][1]));
  camAz = myTeam === 0 ? Math.PI * 0.25 : Math.PI * 1.25;
  updCam();
  refreshRespawn(); dimDone(); refreshTop(); refreshRoster(); drawMinimap(); refreshBadge();
}

async function onNetData(m) {
  await ready;
  if (m.t === 'act') {
    if (m.a.kind === 'equip') applyEquip(m.a);
    else if (m.a.kind === 'unequip') applyUnequip(m.a);
    else if (m.a.kind === 'skset') applySetSkill(m.a);
    else if (m.a.kind === 'skdis') applyDismantle(m.a);
    else if (m.a.kind === 'skcraft') applyCraft(m.a);
    else if (m.a.kind === 'spend') applySpend(m.a);
    else if (m.a.kind === 'gdis') applyScrap(m.a);
    else if (m.a.kind === 'gdisall') applyScrapAll(m.a);
    else if (m.a.kind === 'gcraft') applyCraftItem(m.a);
    else if (m.a.kind === 'shopbid') applyShopBid(m.a);
    else if (m.a.kind === 'shoppass') applyShopPass(m.a);
    else await runAction(m.a);
  } else if (m.t === 'end') await doEndTurn(false);
  else if (m.t === 'again') { toast('對手開了新的一局'); ready = Promise.resolve(newGame(m.seed, G.picks)); }
  else if (m.t === 'sync') { enterGame(); await applySync(m.s); }
  else if (m.t === 'pick') onGuestPick(m.cls);
  else if (m.t === 'bagskip') applyBagSkip(m.side);
}

// 收拾目前的連線嘗試 —— 換頁面、按返回、或重新按一次建立/加入之前都要先呼叫，
// 不然舊的 Peer 物件還留著，新舊兩個連線嘗試會同時搶著改 net.conn，狀態會亂掉。
function destroyPeer() {
  clearConnTimer();
  if (net.peer) { try { net.peer.destroy(); } catch (e) {} net.peer = null; }
  net.conn = null;
}
let connTimer = null;
function clearConnTimer() { if (connTimer) { clearTimeout(connTimer); connTimer = null; } }
// WebRTC 的兩端協商偶爾會卡住不動、也不觸發任何 error 事件（常見於某些防火牆／
// 對稱式 NAT），這時候畫面會停在「連線中…」動也不動、使用者完全不知道發生什麼事。
// 用逾時把這種情況攔下來，至少給個明確的訊息和收拾乾淨的狀態，能夠重新再試一次。
// 15 秒原本是抓「完全卡死」的，但要繞去 TURN 中繼本來就比直連多花幾秒協商，
// 拉長到 25 秒給 TURN 多一點時間，不要在它其實還在忙的時候就提前判死刑。
const CONN_TIMEOUT = 25000;

function startHost() {
  destroyPeer();
  const code = mkCode();
  $('mNet').classList.add('hide');
  $('mWait').classList.remove('hide');
  $('roomCode').textContent = code;
  net.host = true;
  net.peer = new Peer(PREFIX + code, { debug: 0, config: ICE_CONFIG });
  net.peer.on('open', () => { $('mWaitNote').textContent = '房間已開啟，等待對手加入…'; });
  net.peer.on('connection', c => {
    clearConnTimer();
    const fresh = !$('menu').classList.contains('hide');
    hookConn(c);
    if (fresh) { mode = 'online'; myTeam = 0; hostPick = null; guestPick = null; hostPickFlow(); }
  });
  net.peer.on('error', e => {
    clearConnTimer();
    $('mWaitNote').textContent = e.type === 'unavailable-id'
      ? '房號重複，請再按一次建立房間' : '無法連上信令伺服器：' + e.type;
  });
  connTimer = setTimeout(() => {
    $('mWaitNote').textContent = '一直連不上信令伺服器，檢查網路後重新建立房間';
  }, CONN_TIMEOUT);
}

function startJoin() {
  const code = $('mCode').value.trim().toUpperCase();
  if (code.length !== 6) { $('mNetNote').textContent = '請輸入 6 碼房號'; return; }
  destroyPeer();
  $('mNetNote').textContent = '連線中…';
  net.host = false;
  net.peer = new Peer({ debug: 0, config: ICE_CONFIG });
  net.peer.on('open', () => {
    const c = net.peer.connect(PREFIX + code, { reliable: true });
    hookConn(c);
    c.on('open', () => { clearConnTimer(); mode = 'online'; myTeam = 1; guestPickFlow(); });
  });
  net.peer.on('error', e => {
    clearConnTimer();
    $('mNetNote').textContent = e.type === 'peer-unavailable'
      ? '找不到這個房間，確認房號是否正確' : '連線失敗：' + e.type;
  });
  connTimer = setTimeout(() => {
    $('mNetNote').textContent = '連線逾時 —— 雙方其中一邊的網路可能擋掉了 WebRTC。' +
      '換一個網路（例如手機熱點）試試，或請房主重新建立房間。';
    destroyPeer();
  }, CONN_TIMEOUT);
}


/* ── 線上選角：兩邊各自挑三個職業，湊齊了才由房主開局 ── */

let hostPick = null, guestPick = null;

function hostPickFlow() {
  openPick(0, p => {
    hostPick = p;
    $('mPick').classList.add('hide');
    $('mWait').classList.remove('hide');
    $('roomCode').textContent = '已選好';
    $('mWaitNote').textContent = guestPick ? '開局中…' : '等待對手選角…';
    tryStartHost();
  });
}
function onGuestPick(cls) {
  guestPick = cls;
  if (!hostPick) { $('mWaitNote').textContent = '對手選好了，等你'; return; }
  tryStartHost();
}
function tryStartHost() {
  if (!hostPick || !guestPick) return;
  startPlay([hostPick, guestPick]);
}
function guestPickFlow() {
  $('mNet').classList.add('hide');
  openPick(1, p => {
    netSend({ t: 'pick', cls: p });
    $('mPick').classList.add('hide');
    $('mWait').classList.remove('hide');
    $('roomCode').textContent = '已選好';
    $('mWaitNote').textContent = '等待房主開局…';
  });
}
function enterGame() {
  $('menu').classList.add('hide');
  $('hud').classList.remove('hide');
  ['mNet', 'mWait', 'mPick'].forEach(i => $(i).classList.add('hide'));
  $('mMain').classList.remove('hide');
}
