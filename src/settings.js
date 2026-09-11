/* ══════════════ 設定 ══════════════
   全部存在 localStorage，所以是「每台裝置各自記自己的」。
   file:// 直接開的時候有些瀏覽器會擋掉 localStorage，存不了就只在這一輪有效。 */

const SET_KEY = 'porkguy.settings.v1';

const SET_DEF = {
  // 音效（功能還沒做，欄位先留著）
  volMaster: 70, volSfx: 80, volBgm: 50,
  // 畫面
  uiScale: 100,          // 80–150 %
  bagCols: 4,            // 背包每行幾格
  animSpeed: 1,          // 0.5 / 1 / 2 / 0（0 = 瞬間）
  fx: 'high',            // high / mid / off
  shadow: true,
  dmgNum: true,
  tagMode: 'all',        // all / hurt / off
  threat: true,
  // 操作
  panSpeed: 100,         // 50–200 %
  zoomSpeed: 100,
  camFollow: true,
  // 遊戲
  autoEnd: false,
  confirmEnd: true,
  autoScrap: -1          // -1 不自動；0 白；1 白+綠
};

let SET = Object.assign({}, SET_DEF);

function loadSettings() {
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (raw) Object.assign(SET, JSON.parse(raw));
  } catch (e) { /* 讀不到就用預設 */ }
}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch (e) { /* 存不了就算了 */ }
}

// 開局節奏（商店/競技場多久出現一次、勝利門檻）也存起來，不然每局都要重調
const PACE_KEY = 'porkguy.pace.v1';
function loadPace() {
  try {
    const raw = localStorage.getItem(PACE_KEY);
    if (raw) Object.assign(PACE, JSON.parse(raw));
  } catch (e) { /* 讀不到就用預設 */ }
}
function savePace() {
  try { localStorage.setItem(PACE_KEY, JSON.stringify(PACE)); } catch (e) { /* 存不了就算了 */ }
}
function setOpt(k, v) {
  SET[k] = v;
  saveSettings();
  applySettings();
}

// 動畫時間統一走這裡，設定裡的速度就能一路生效
const spd = ms => (SET.animSpeed === 0 ? 0 : Math.round(ms / SET.animSpeed));

// HUD 整層用 zoom 等比縮放，所以 JS 算出來的螢幕座標要先除回去
const uiK = () => SET.uiScale / 100;
const uiW = () => innerWidth / uiK();
const uiH = () => innerHeight / uiK();

function applySettings() {
  const r = document.documentElement;
  r.style.setProperty('--uiscale', SET.uiScale / 100);
  r.style.setProperty('--bagcols', SET.bagCols);
  document.body.classList.toggle('no-shadow', !SET.shadow);
  if (typeof renderer !== 'undefined' && renderer) renderer.shadowMap.enabled = SET.shadow;
  if (typeof G !== 'undefined' && G.units) G.units.forEach(u => { if (u.tag) updTag(u); });
  if (typeof drawRanges === 'function' && typeof sel !== 'undefined' && sel) drawRanges();
}

/* ── 設定面板 ── */

// [key, 標題, 型別, 選項]
const SET_ROWS = [
  ['h', '音效'],
  ['volMaster', '主音量', 'range', [0, 100]],
  ['volSfx', '音效音量', 'range', [0, 100]],
  ['volBgm', '背景音樂', 'range', [0, 100]],
  ['h', '畫面'],
  ['uiScale', 'UI 大小', 'pick', [[80, '小'], [100, '標準'], [120, '大'], [150, '特大']]],
  ['bagCols', '背包每行格數', 'pick', [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']]],
  ['animSpeed', '動畫速度', 'pick', [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [0, '瞬間']]],
  ['fx', '技能特效', 'pick', [['high', '完整'], ['mid', '精簡'], ['off', '關閉']]],
  ['shadow', '陰影', 'toggle'],
  ['dmgNum', '傷害數字', 'toggle'],
  ['tagMode', '名牌顯示', 'pick', [['all', '全部'], ['hurt', '只顯示受傷'], ['off', '關閉']]],
  ['threat', '顯示威脅範圍', 'toggle'],
  ['h', '操作'],
  ['panSpeed', '鏡頭平移速度', 'range', [50, 200]],
  ['zoomSpeed', '滾輪縮放速度', 'range', [50, 200]],
  ['camFollow', '鏡頭自動跟隨', 'toggle'],
  ['h', '遊戲'],
  ['autoEnd', '全部動完自動結束回合', 'toggle'],
  ['confirmEnd', '結束回合前確認', 'toggle'],
  ['autoScrap', '自動分解掉落', 'pick', [[-1, '不自動'], [0, '白色'], [1, '白＋綠']]]
];

function buildSettings() {
  const box = document.getElementById('setBody');
  box.innerHTML = '';
  for (const row of SET_ROWS) {
    if (row[0] === 'h') {
      const h = document.createElement('div');
      h.className = 'seth';
      h.textContent = row[1];
      box.appendChild(h);
      continue;
    }
    const [k, label, type, opt] = row;
    const d = document.createElement('div');
    d.className = 'setr';
    d.innerHTML = `<span class="setl">${label}</span>`;
    const wrap = document.createElement('div');
    wrap.className = 'setv';

    if (type === 'toggle') {
      const b = document.createElement('button');
      const paint = () => { b.textContent = SET[k] ? '開' : '關'; b.classList.toggle('on', !!SET[k]); };
      b.className = 'stg';
      b.onclick = () => { setOpt(k, !SET[k]); paint(); };
      paint();
      wrap.appendChild(b);
    } else if (type === 'pick') {
      for (const [v, n] of opt) {
        const b = document.createElement('button');
        b.className = 'spk' + (SET[k] === v ? ' on' : '');
        b.textContent = n;
        b.onclick = () => {
          setOpt(k, v);
          [...wrap.children].forEach(c => c.classList.toggle('on', c === b));
          if (k === 'bagCols' && !document.getElementById('bagOv').classList.contains('hide')) renderBag();
        };
        wrap.appendChild(b);
      }
    } else {
      const i = document.createElement('input');
      i.type = 'range'; i.min = opt[0]; i.max = opt[1]; i.value = SET[k];
      const t = document.createElement('em');
      t.textContent = SET[k] + '%';
      i.oninput = () => { t.textContent = i.value + '%'; setOpt(k, +i.value); };
      wrap.appendChild(i); wrap.appendChild(t);
    }
    d.appendChild(wrap);
    box.appendChild(d);
  }
  const rst = document.createElement('button');
  rst.className = 'setrst';
  rst.textContent = '全部恢復預設';
  rst.onclick = () => { SET = Object.assign({}, SET_DEF); saveSettings(); applySettings(); buildSettings(); };
  box.appendChild(rst);
}

function openSettings() {
  buildSettings();
  document.getElementById('setOv').classList.remove('hide');
  setTimeout(() => document.getElementById('setOv').classList.add('on'), 16);
}
function closeSettings() {
  const el = document.getElementById('setOv');
  el.classList.remove('on');
  setTimeout(() => el.classList.add('hide'), 240);
}
