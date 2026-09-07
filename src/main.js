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
  // 只更新鏡頭附近的骨骼動畫，遠處的先凍住（大地圖上動輒五十幾個單位）
  const R2 = (camDist * 1.4 + 24) ** 2;
  for (const u of G.units) {
    if (!u.view) continue;
    const p = u.view.g.position;
    const dx = p.x - camTarget.x, dz = p.z - camTarget.z;
    if (dx * dx + dz * dz < R2 || performance.now() - u.view.lastPlay < 2500) u.view.mixer.update(dt);
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
    openPick(0, blue => openPick(1, red => startPlay([blue, red])));
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
  $('rAgain').onclick = () => {
    const seed = (Math.random() * 1e9) | 0;
    if (mode === 'online') { if (!net.host) { toast('等主機開新局'); return; } netSend({ t: 'again', seed }); }
    ready = Promise.resolve(newGame(seed));
  };
  $('rMenu').onclick = () => $('btnQuit').onclick();
}

boot();
