/* ══════════════ 背包回合（只在線上對戰生效）══════════════
   本機對戰維持原本「每個欄位一回合只能換一次」的規則。
   線上對戰改成：每個人的回合結束後，插入一段 60 秒的背包回合，雙方都可以
   在這段時間自由裝備／卸下／換技能，過了這段時間就鎖住，直到下一個背包回合。
   不需要完全同步到毫秒等級——雙方各自在本地跑一樣的倒數，跳過或逾時都是
   各自獨立判斷要不要繼續，等同於怪物階段那種「兩邊各跑一次同一套邏輯」。 */

const BAG_PHASE_MS = 60000;
let bagPhaseTimer = null;

function enterBagPhase(next) {
  G.bagPhase = { skipped: [false, false], next, endAt: Date.now() + BAG_PHASE_MS };
  log('<b class="up">── 背包回合：雙方都可以自由裝備、換技能 ──</b>');
  toast('背包回合開始，60 秒內可以自由裝備');
  refreshTop();
  refreshBagPhaseBar();
  if (bagPhaseTimer) clearInterval(bagPhaseTimer);
  bagPhaseTimer = setInterval(tickBagPhase, 250);
}

function tickBagPhase() {
  if (!G.bagPhase) { clearInterval(bagPhaseTimer); bagPhaseTimer = null; return; }
  if (Date.now() >= G.bagPhase.endAt) { finishBagPhase(); return; }
  refreshBagPhaseBar();
}

function doBagSkip() {
  if (!G.bagPhase || G.bagPhase.skipped[myTeam]) return;
  netSend({ t: 'bagskip', side: myTeam });
  applyBagSkip(myTeam);
}
function applyBagSkip(side) {
  if (!G.bagPhase || G.bagPhase.skipped[side]) return;
  G.bagPhase.skipped[side] = true;
  toast(`<b class="s${side}">${SIDE_N[side]}</b> 跳過了背包回合`);
  refreshBagPhaseBar();
  if (G.bagPhase.skipped[0] && G.bagPhase.skipped[1]) finishBagPhase();
}
function finishBagPhase() {
  if (!G.bagPhase) return;
  clearInterval(bagPhaseTimer); bagPhaseTimer = null;
  const next = G.bagPhase.next;
  G.bagPhase = null;
  refreshBagPhaseBar();
  refreshTop();
  next();
}

function refreshBagPhaseBar() {
  const bar = $('bagPhaseBar');
  if (!G.bagPhase) { bar.classList.add('hide'); return; }
  bar.classList.remove('hide');
  const left = Math.max(0, Math.ceil((G.bagPhase.endAt - Date.now()) / 1000));
  $('bagPhaseClock').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  const stat = s => `<span class="s${s}${G.bagPhase.skipped[s] ? '' : ' dim'}">` +
    SIDE_N[s] + (G.bagPhase.skipped[s] ? ' 已跳過' : ' 整理中…') + '</span>';
  $('bagPhaseStatus').innerHTML = stat(0) + stat(1);
  $('bagPhaseSkip').disabled = G.bagPhase.skipped[myTeam];
}
