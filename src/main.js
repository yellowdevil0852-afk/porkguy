/* ══════════════ 啟動與主迴圈 ══════════════ */

function b64buf(b64) {
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}

let mapSize = 32;

/* ── 開局選角：五選三 ── */

let pickSel = [], pickThen = null;

function openPick(side, then) {
  pickThen = then;
  pickSel = [];
  $('menu').classList.remove('hide');
  ['mMain', 'mNet', 'mWait'].forEach(i => $(i).classList.add('hide'));
  $('mPick').classList.remove('hide');
  $('pickWho').textContent = SIDE_N[side] + '　選 ' + TEAM_SIZE + ' 個職業';
  $('pickWho').style.color = SIDE_CSS[side];

  const box = $('pickList');
  box.innerHTML = '';
  const paint = () => {
    [...box.children].forEach(e => e.classList.toggle('on', pickSel.includes(e.dataset.cls)));
    $('pickGo').disabled = pickSel.length !== TEAM_SIZE;
    $('pickGo').textContent = `確定（${pickSel.length}/${TEAM_SIZE}）`;
  };
  for (const cls of CLS_ORDER) {
    const c = CLS[cls];
    const d = document.createElement('div');
    d.className = 'pk';
    d.dataset.cls = cls;
    d.innerHTML = `<img src="${PORTRAIT[cls]}" alt="">
      <div class="pn">${c.n}</div>
      <div class="pd">HP ${c.hp}・攻 ${c.atk}・防 ${c.def}<br>
        ${DMG_N[c.dmg]}／${ARM_N[c.arm]}・移 ${c.mov}・射 ${c.rng}<br>${c.pass.split('：')[0]}</div>`;
    d.onclick = () => {
      const i = pickSel.indexOf(cls);
      if (i >= 0) pickSel.splice(i, 1);
      else if (pickSel.length < TEAM_SIZE) pickSel.push(cls);
      paint();
    };
    box.appendChild(d);
  }
  paint();
}

/* ── 開局節奏設定：選完角色、開局前跳出來，調商店/競技場多久出現一次、勝利門檻 ── */

function openPaceConfig(then) {
  $('menu').classList.remove('hide');
  ['mMain', 'mNet', 'mWait', 'mPick'].forEach(i => $(i).classList.add('hide'));
  $('mPace').classList.remove('hide');
  $('menu').querySelector('.card').classList.add('wide');

  const rangeRow = (label, key, min, max, suffix) => {
    const d = document.createElement('div');
    d.className = 'setr';
    d.innerHTML = `<span class="setl">${label}</span>`;
    const wrap = document.createElement('div');
    wrap.className = 'setv';
    const i = document.createElement('input');
    i.type = 'range'; i.min = min; i.max = max; i.value = PACE[key];
    const em = document.createElement('em');
    em.textContent = PACE[key] + suffix;
    i.oninput = () => {
      PACE[key] = +i.value; em.textContent = PACE[key] + suffix;
      savePace(); drawTimeline();
    };
    wrap.appendChild(i); wrap.appendChild(em);
    d.appendChild(wrap);
    return d;
  };
  const toggleRow = (label, onKey, numKey, min, max, suffix) => {
    const d = document.createElement('div');
    d.className = 'setr';
    d.innerHTML = `<span class="setl">${label}</span>`;
    const wrap = document.createElement('div');
    wrap.className = 'setv';
    const b = document.createElement('button');
    b.className = 'stg';
    const i = document.createElement('input');
    i.type = 'range'; i.min = min; i.max = max; i.value = PACE[numKey];
    const em = document.createElement('em');
    const paint = () => { b.textContent = PACE[onKey] ? '開' : '關'; b.classList.toggle('on', !!PACE[onKey]); };
    paint();
    em.textContent = PACE[numKey] + suffix;
    b.onclick = () => { PACE[onKey] = !PACE[onKey]; paint(); savePace(); };
    i.oninput = () => { PACE[numKey] = +i.value; em.textContent = PACE[numKey] + suffix; savePace(); };
    wrap.appendChild(b); wrap.appendChild(i); wrap.appendChild(em);
    d.appendChild(wrap);
    return d;
  };

  const rows = $('paceRows');
  rows.innerHTML = '';
  rows.appendChild(rangeRow('第一次商店回合', 'shopFirst', 1, 15, ' 回合'));
  rows.appendChild(rangeRow('商店之後幾回合出現競技場', 'arenaAfterShop', 1, 10, ' 回合'));
  rows.appendChild(rangeRow('競技場之後幾回合出現商店', 'shopAfterArena', 1, 10, ' 回合'));

  const winRows = $('paceWinRows');
  winRows.innerHTML = '';
  winRows.appendChild(toggleRow('佔領王座連續', 'throneOn', 'throneWin', 1, 20, ' 回合獲勝'));
  winRows.appendChild(toggleRow('累積競技場勝利', 'arenaWinOn', 'arenaWinNeed', 1, 15, ' 場獲勝'));

  function drawTimeline() {
    const tl = $('paceTimeline');
    tl.innerHTML = '';
    const cycle = PACE.arenaAfterShop + PACE.shopAfterArena;
    const N = Math.min(40, PACE.shopFirst + cycle * 3);
    for (let t = 1; t <= N; t++) {
      const a = isArenaTurn(t), s = isShopTurn(t);
      const chip = document.createElement('span');
      chip.className = 'paceChip' + (a ? ' pc-a' : s ? ' pc-s' : '');
      chip.textContent = a ? '⚔' : s ? '🛒' : t;
      chip.title = '第 ' + t + ' 回合' + (a ? '：競技場回合' : s ? '：商店回合' : '');
      tl.appendChild(chip);
    }
  }
  drawTimeline();

  $('paceGo').onclick = () => {
    $('menu').querySelector('.card').classList.remove('wide');
    then();
  };
  $('paceBack').onclick = () => {
    $('menu').querySelector('.card').classList.remove('wide');
    $('mPace').classList.add('hide'); $('mMain').classList.remove('hide');
  };
}

function startPlay(picks) {
  setSize(mapSize);
  $('menu').classList.add('hide');
  $('hud').classList.remove('hide');
  ['mNet', 'mWait', 'mPick'].forEach(i => $(i).classList.add('hide'));
  $('mMain').classList.remove('hide');
  const seed = (Math.random() * 1e9) | 0;
  ready = Promise.resolve(newGame(seed, picks));
  if (mode === 'online') {
    toast('你是<b>' + SIDE_N[myTeam] + '</b>');
    if (net.host) netSend({ t: 'sync', s: serialize() });
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  // 鏡頭附近以外的單位不只不更新骨骼動畫，模型本身也直接設 invisible 不進渲染流程——
  // 地圖跟怪物數量都比以前大很多（大地圖動輒好幾百隻怪），每隻都是獨立的蒙皮網格、
  // 各自一個 draw call，光是遠處那些平常看不到的也丟給 GPU 處理會很拖幀率。
  // 選中/滑鼠指到的單位不管多遠都維持可見，不然選單位之後鏡頭還沒轉過去會憑空消失。
  const R2 = (camDist * 1.4 + 24) ** 2;
  visUnits.length = 0;
  for (const u of G.units) {
    if (!u.view) continue;
    const p = u.view.g.position;
    const dx = p.x - camTarget.x, dz = p.z - camTarget.z;
    const near = dx * dx + dz * dz < R2;
    const vis = near || u === sel || u === hoverUnit;
    u.view.g.visible = vis;
    if (vis) visUnits.push(u.view.g);
    if (near || performance.now() - u.view.lastPlay < 2500) u.view.mixer.update(dt);
  }
  panStep(dt);
  updateFX(dt);
  pulseOverlays(clock.elapsedTime);
  spinGold(clock.elapsedTime);
  projectTags();
  renderer.render(scene, camera);
  if (window.__dbg) window.__dbg.frames++;
}
let mmTimer = 0;
setInterval(() => { if (!$('hud').classList.contains('hide')) drawMinimap(); }, 400);

async function boot() {
  const bar = $('ldBar'), txt = $('ldTxt');
  const names = Object.keys(ASSETS);

  const mgr = new THREE.LoadingManager();
  mgr.setURLModifier(u => {
    const n = u.replace(/.*\//, '');
    return TEX[n] || u;
  });
  const loader = new THREE.GLTFLoader(mgr);

  // 逼 GLTFLoader 用 <img> 而不是 fetch() 讀貼圖，file:// 直接開才不會被擋
  function parse(buf) {
    return new Promise((res, rej) => {
      const cib = window.createImageBitmap;
      window.createImageBitmap = undefined;
      try { loader.parse(buf, '', res, rej); }
      finally { window.createImageBitmap = cib; }
    });
  }

  for (let i = 0; i < names.length; i++) {
    txt.textContent = '載入模型 ' + (i + 1) + ' / ' + names.length;
    MODELS[names[i]] = await parse(b64buf(ASSETS[names[i]]));
    bar.style.width = ((i + 1) / (names.length + 2) * 100) + '%';
  }
  CLIPS.push(...MODELS.anims.animations);
  // 素材本身的錯誤：遊俠模型裡的「1H_Crossbow」旋轉值跟其他所有武器
  // （劍/斧/杖/弓……全部都是 [π,0,-π]）不一樣，唯獨這把是 [0,π/2,0]，
  // 導致弩弓卡進手臂/身體裡，從大部分視角看起來像「武器完全不見了」，
  // 只有影子還看得出形狀。直接在共用的模型範本上修正一次旋轉即可，
  // 不用動 buildUnitView() 的邏輯——之後所有複製體（含頭像預覽）都會沿用這個修正。
  MODELS.Rogue.scene.traverse(c => {
    if (c.name === '1H_Crossbow') c.rotation.set(Math.PI, 0, -Math.PI);
  });

  // 開發用：讓瀏覽器主控台看得到內部狀態
  window.__dbg = {
    G, MODELS, get sel() { return sel; }, get busy() { return busy; },
    get phase() { return phase; }, get reach() { return reach; },
    get mode() { return mode; }, get preMove() { return preMove; },
    frames: 0, get info() { return JSON.parse(JSON.stringify(renderer.info.render)); },
    ev: c => eval(c)      // 開發用：在遊戲內層作用域執行程式碼
  };

  txt.textContent = '建構世界…';
  loadSettings();
  loadPace();
  initThree();
  makePortraits();
  initFXTex();
  initSelRing();
  bindInput();
  applySettings();
  animate();
  bar.style.width = '100%';
  await new Promise(r => setTimeout(r, 100));
  $('loading').style.display = 'none';

  // ── 選單 ──
  // 本機對戰：藍軍先選，再換紅軍
  $('mLocal').onclick = () => {
    mode = 'local'; myTeam = 0;
    openPick(0, blue => openPick(1, red => openPaceConfig(() => startPlay([blue, red]))));
  };
  $('pickGo').onclick = () => { const p = pickSel.slice(); pickThen(p); };
  $('pickBack').onclick = () => {
    destroyPeer();
    mode = 'local';
    $('mPick').classList.add('hide'); $('mMain').classList.remove('hide');
  };
  $('mOnline').onclick = () => { $('mMain').classList.add('hide'); $('mNet').classList.remove('hide'); };
  // 之前這裡沒收拾 net.peer：連線卡住時按返回，舊的連線嘗試會留在背景，
  // 再按一次〔加入〕就會有兩個 Peer 物件同時搶著跑，狀態全亂掉。
  $('mBack').onclick = () => { destroyPeer(); $('mNet').classList.add('hide'); $('mMain').classList.remove('hide'); };
  $('mHost').onclick = startHost;
  $('mJoin').onclick = startJoin;
  $('mCode').onkeydown = e => { if (e.key === 'Enter') startJoin(); };
  $('mCancelHost').onclick = () => {
    destroyPeer();
    $('mWait').classList.add('hide'); $('mMain').classList.remove('hide');
  };
  const sizeBox = $('mSize');
  SIZES.forEach(n => {
    const b = document.createElement('button');
    b.textContent = n + '×' + n;
    b.className = 'szb' + (n === mapSize ? ' prime' : '');
    b.onclick = () => {
      mapSize = n;
      [...sizeBox.children].forEach(c => c.classList.toggle('prime', c === b));
    };
    sizeBox.appendChild(b);
  });

  const openSet = () => openSettings();
  $('btnSet').onclick = openSet;
  $('mSet').onclick = openSet;
  $('setClose').onclick = closeSettings;

  const help = show => $('help').classList.toggle('hide', !show);
  $('mHelp').onclick = () => help(true);
  $('btnHelp').onclick = () => help(true);
  $('helpClose').onclick = () => help(false);

  // ── 遊戲中 ──
  // 結束回合前先看看有沒有人整回合沒動過，第一次按只提醒，再按一次才真的結束
  let endWarned = false;
  $('btnEnd').onclick = () => {
    if (!canAct()) return;
    const idle = G.units.filter(u => u.alive && u.side === G.cur && !u.moved && !u.acted);
    if (idle.length && !endWarned && SET.confirmEnd) {
      endWarned = true;
      toast(`<b>${idle.map(nameOf).join('、')}</b> 這回合還沒動過<br>再按一次結束回合`);
      idle.forEach(u => { if (u.tag) u.tag.classList.add('idle'); });
      lookAt(idle[0].x, idle[0].y);
      return;
    }
    endWarned = false;
    G.units.forEach(u => { if (u.tag) u.tag.classList.remove('idle'); });
    doEndTurn(true);
  };
  $('btnEnd').addEventListener('pointerenter', () => { endWarned = false; });
  $('btnAI').onclick = () => setAI(!aiOn);
  $('btnBag').onclick = openBag;
  bindBagTabs();
  $('bagAuto').onclick = autoGearAll;
  $('bagClose').onclick = closeBag;
  $('shopBidBtn').onclick = () => doShopBid(+$('shopBidAmt').value);
  $('shopPassBtn').onclick = doShopPass;
  const stepShopBid = d => {
    const amt = $('shopBidAmt');
    const v = Math.max(+amt.min, Math.min(+amt.max, (+amt.value || 0) + d));
    amt.value = v;
    $('shopMinus').disabled = v <= +amt.min;
    $('shopPlus').disabled = v >= +amt.max;
  };
  $('shopMinus').onclick = () => stepShopBid(-5);
  $('shopPlus').onclick = () => stepShopBid(5);
  // 手動輸入的話不要幫忙夾範圍，讓玩家可以自由打字——出不起或不夠加價
  // 按〔出價〕的時候 doShopBid() 自然會擋下來並告知原因
  $('shopBidAmt').oninput = () => {
    const amt = $('shopBidAmt');
    $('shopMinus').disabled = +amt.value <= +amt.min;
    $('shopPlus').disabled = +amt.value >= +amt.max;
  };
  $('bagPhaseSkip').onclick = doBagSkip;
  $('btnQuit').onclick = () => {
    if (net.peer) { net.peer.destroy(); net.peer = null; }
    if (bagPhaseTimer) { clearInterval(bagPhaseTimer); bagPhaseTimer = null; }
    G.bagPhase = null; G.shop = null;
    mode = 'local';
    $('hud').classList.add('hide');
    $('netTag').classList.add('hide');
    $('menu').classList.remove('hide');
    $('mNet').classList.add('hide'); $('mWait').classList.add('hide');
    $('mMain').classList.remove('hide');
    $('result').classList.add('hide');
    $('bagPhaseBar').classList.add('hide');
    $('shopOv').classList.add('hide');
    closeBag();
  };
  $('btnUndo').onclick = () => {
    if (!canAct() || !sel || !preMove || preMove.uid !== sel.id || sel.acted) return;
    send({ kind: 'undo', uid: sel.id, x: preMove.x, y: preMove.y });
  };
  $('btnTele').onclick = () => {
    if (!canAct() || !sel || !canTeleTeammate(sel)) return;
    teleMode = true;
    toast('選一個隊友，傳送到他旁邊');
  };
  $('rAgain').onclick = () => {
    const seed = (Math.random() * 1e9) | 0;
    if (mode === 'online') { if (!net.host) { toast('等主機開新局'); return; } netSend({ t: 'again', seed }); }
    ready = Promise.resolve(newGame(seed));
  };
  $('rMenu').onclick = () => $('btnQuit').onclick();
}

boot();
