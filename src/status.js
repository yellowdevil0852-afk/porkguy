/* ══════════════ 狀態系統 ══════════════
   一個單位身上的狀態統一放在 u.st = [{ id, v, turns, from }]。
   v 是已經換算好的實際數值（傷害／加成／護盾剩餘量），控制類的 v 是 0。 */

// 哪些狀態會直接改數值（sunder / weaken 存負數）
const ST_STAT = { atk: 'atk', def: 'def', mov: 'mov', weaken: 'atk', sunder: 'def' };
const CTRL = ['stun', 'root', 'silence', 'freeze', 'fear'];

function addSt(u, src, e) {
  if (!u.alive) return;
  // 不屈意志：控制改成堅甲
  if (ST[e.id].ctrl && pasOf(u, 'ctrlImmune')) {
    u.st.push({ id: 'def', v: Math.round(Math.max(1, defOf(u)) * 0.3), turns: 2 });
    floatText(u.x, u.y, '免疫', 'up');
    return;
  }
  let v = 0;
  if (e.pct) v = Math.max(1, Math.round(atkOf(src) * e.pct));
  if (e.val) v = e.val;
  if (e.id === 'weaken' || e.id === 'sunder')
    v = -Math.round(Math.max(1, e.id === 'weaken' ? atkOf(u) : defOf(u)) * e.pct);
  if (e.id === 'curse') v = e.pct;
  const old = u.st.find(x => x.id === e.id);
  if (old && !ST[e.id].dot) { old.v = e.id === 'shield' ? old.v + v : v; old.turns = Math.max(old.turns, e.turns + 1); }
  else u.st.push({ id: e.id, v, turns: (e.turns || 1) + 1, from: src.id });
  updTag(u);
}
const hasSt = (u, id) => u.st.some(x => x.id === id);
const stVal = (u, id) => u.st.reduce((s, x) => s + (x.id === id ? x.v : 0), 0);
const shieldOf = u => Math.max(0, stVal(u, 'shield'));
const isCtrl = u => u.st.some(x => CTRL.includes(x.id));
const canMoveU = u => !hasSt(u, 'stun') && !hasSt(u, 'root') && !hasSt(u, 'freeze');
const canActU = u => !hasSt(u, 'stun') && !hasSt(u, 'freeze') && !hasSt(u, 'fear');
const canSkillU = u => canActU(u) && !hasSt(u, 'silence');
function clearBad(u) {
  u.st = u.st.filter(x => ST[x.id].good);
  updTag(u);
}

// 被動：讀裝著的被動技能
function pasOf(u, key) {
  if (!isHero(u) || !u.pas) return 0;
  const p = SK[u.pas] && SK[u.pas].p;
  return p ? (p[key] || 0) : 0;
}

// 護盾先擋，剩下的才進血量
function absorb(u, dmg) {
  let left = dmg;
  for (const b of u.st) {
    if (b.id !== 'shield' || left <= 0) continue;
    const t = Math.min(b.v, left);
    b.v -= t; left -= t;
  }
  u.st = u.st.filter(b => b.id !== 'shield' || b.v > 0);
  if (left < dmg) floatText(u.x, u.y, '護盾 -' + (dmg - left), 'heal');
  return left;
}

/* ── 回合開始的結算 ── */
async function tickStatus(u) {
  if (!u.st.length) return;
  let dot = 0;
  const burns = [];
  for (const b of u.st) {
    if (ST[b.id].dot) {
      let d = b.v;
      if (pasOf(u, 'dotRes')) d = Math.ceil(d * (1 - pasOf(u, 'dotRes')));
      dot += d;
      if (b.id === 'burn') burns.push(b);
    } else if (b.id === 'regen') {
      const h = Math.min(b.v, mhpOf(u) - u.hp);
      if (h > 0) { u.hp += h; floatText(u.x, u.y, '+' + h, 'heal'); }
    }
  }
  if (dot > 0) {
    u.hp -= dot;
    floatText(u.x, u.y, String(dot), 'dmg');
    updTag(u);
    if (u.hp <= 0) { await die(u, null); return; }
  }
  // 灼燒會傳染給相鄰的一個敵人
  for (const b of burns) {
    for (const [dx, dy] of NB8) {
      const o = unitAt(u.x + dx, u.y + dy);
      if (o && o.side === u.side && o !== u && !hasSt(o, 'burn')) {
        o.st.push({ id: 'burn', v: b.v, turns: 2 });
        floatText(o.x, o.y, '延燒', 'dmg');
        break;
      }
    }
  }
  u.st = u.st.filter(b => --b.turns > 0 && !(b.id === 'shield' && b.v <= 0));
  updTag(u);
}

// 流血：移動時多掉一次
async function bleedOnMove(u) {
  const b = u.st.find(x => x.id === 'bleed');
  if (!b) return;
  let d = b.v;
  if (pasOf(u, 'dotRes')) d = Math.ceil(d * (1 - pasOf(u, 'dotRes')));
  u.hp -= d;
  floatText(u.x, u.y, String(d), 'dmg');
  updTag(u);
  if (u.hp <= 0) await die(u, null);
}

// 名牌下面那排狀態圖示
function stIcons(u) {
  if (!u.st.length) return '';
  return u.st.map(b => {
    const d = ST[b.id];
    const cls = d.good ? 'g' : d.ctrl ? 'c' : 'b';
    return `<i class="${cls}" title="${d.n}">${d.n[0]}</i>`;
  }).join('');
}
