/* ══════════════ 資料表 ══════════════
   平衡數值全部集中在這裡，改完重跑 node build.js 就生效。 */

let W = 27, H = 27;                      // 地圖邊長，開局時由選單決定
const TILE = 2;
const SIZES = [16, 24, 32, 48, 64];      // 可選的地圖大小
let THRONE = [13, 13];                   // 正中央，setSize() 會重算
const THRONE_WIN = 5;                    // 連續佔領幾回合獲勝
const AGGRO = 3;                         // 怪物驚醒距離
const LEASH = 8;                         // 怪物離營地最遠追多少格
const REVIVE_TURNS = 3;                  // 英雄倒下後幾回合在營地復活
const REVIVE_DASH = 2;                   // 復活後兩回合的額外移動力
const CAMP_HEAL = 0.25;                  // 站在營地周圍一格，每回合回復最大生命的幾成
// 怪群等級（依營地離王座的遠近）。英雄封頂 Lv10，第 4 級是貼著王座本體的
// 最終守衛，滿級站崗——只有夠大的地圖（48×48 以上）才擠得下這一圈，見 placeCamps()。
const MON_LV = { 1: 1, 2: 4, 3: 7, 4: 10 };
const MON_REVIVE_BASE = 5;               // 怪物重生的底線回合數，之後每一等 +1
// 精英變種：跟首領共用「換色＋放大」那套做法，但是隨機出現在任何一般怪身上，
// 不占地圖版面、不用新模型，純粹讓「這隻不太一樣」有機會發生在任何一場戰鬥裡。
const MON_ELITE = { chance: 0.15, hp: 1.4, atk: 1.25, def: 1.15, exp: 1.8, gold: 1.6, tint: 0xd68cff };
const NO_REVIVE_R = 5;                   // 王座半徑幾格內的怪群不復活
const CRIT = 0.10, CRIT_MULT = 1.5;
const FLANK = { front: 1, side: 1.25, back: 1.25 };
const COUNTER_TRI = 1.2;                 // 攻擊類型剋護甲類型的倍率
const HIGH_GROUND = 2;                   // 高處往低處打的加成
// 減傷曲線常數：防禦等於這個數字時，傷害剛好減半（傷害 = 攻擊 × K/(K+防禦)）。
// 取代舊的「攻擊 − 防禦」線性扣減 —— 那個公式在數值拉開後防禦方會變成
// 「怎麼打都只剩地板值 1」，攻防差距一大，戰鬥就從「打幾下」退化成「碰一下就死」。
// 減傷曲線讓防禦永遠有效但永遠不會把傷害壓到底，全等級的交手節奏才會穩定在 3～5 下。
const MIT_K = 18;

// ── 地形 ──
const TER = {
  R: { n: '道路', cost: 1, def: 0, atk: 0, h: 0.00, col: 0xb08c5c },
  P: { n: '平原', cost: 1, def: 0, atk: 0, h: 0.00, col: 0x5b8f45 },
  F: { n: '森林', cost: 2, def: 2, atk: 0, h: 0.10, col: 0x35602f, forest: 1 },
  M: { n: '山地', cost: 2, def: 2, atk: 1, h: 0.60, col: 0x7d7568, high: 1 },
  S: { n: '沼澤', cost: 3, def: -1, atk: 0, h: -0.10, col: 0x4d5c34, mire: 1 },
  W: { n: '深水', cost: 99, def: 0, atk: 0, h: -0.34, col: 0x1b4870 },
  T: { n: '王座', cost: 1, def: 2, atk: 0, h: 0.30, col: 0xb99539 },
  C: { n: '營地', cost: 1, def: 2, atk: 0, h: 0.10, col: 0x9a8a68 },
  // 石頭：不可通行，沒有任何數值加成，而且會擋住遠程／魔法的視線
  K: { n: '石頭', cost: 99, def: 0, atk: 0, h: 0.45, col: 0x6b6f78, block: 1 }
};
const ORDER = ['R', 'P', 'F', 'M', 'S', 'W', 'T', 'C', 'K'];

// ── 攻擊 / 護甲類型（剋制三角）──
//   法剋重甲、斬剋布甲、射剋輕甲
const BEATS = { magic: 'heavy', melee: 'cloth', ranged: 'light' };
const DMG_N = { melee: '斬', ranged: '射', magic: '法' };
const ARM_N = { heavy: '重甲', light: '輕甲', cloth: '布甲' };

// ── 英雄職業 ──
//   heal / 技能的數值一律用「攻擊力的百分比」，等級和裝備一起帶動成長
const CLS = {
  KN: {
    n: '騎士', pro: '聖殿騎士', model: 'Knight', dmg: 'melee', arm: 'heavy',
    hp: 34, atk: 11, def: 7, mov: 4, rng: 1,
    show: { 1: ['1H_Sword', 'Round_Shield'], 2: ['2H_Sword'] },
    pass: '守護：周圍一格的友軍受到的傷害 −2'
  },
  RG: {
    n: '遊俠', pro: '神射手', model: 'Rogue', dmg: 'ranged', arm: 'light',
    hp: 24, atk: 10, def: 3, mov: 5, rng: 3,
    show: { 1: ['1H_Crossbow'], 2: ['Knife'] },
    pass: '鷹眼：站在山地時射程 +1'
  },
  MG: {
    n: '法師', pro: '大賢者', model: 'Mage', dmg: 'magic', arm: 'cloth',
    hp: 20, atk: 13, def: 2, mov: 4, rng: 3,
    show: { 1: ['2H_Staff', 'Mage_Hat'], 2: ['1H_Wand', 'Mage_Hat'] },
    pass: '穿透：無視目標一半的防禦'
  },
  CL: {
    n: '牧師', pro: '主教', model: 'Rogue_Hooded', dmg: 'magic', arm: 'light',
    hp: 24, atk: 8, def: 4, mov: 5, rng: 3, healPct: 1.5,
    show: { 1: [], 2: [] }, weapon: 'staff',
    pass: '祝福：治療時自己也回復該次治療量的三成'
  },
  BB: {
    n: '狂戰士', pro: '狂暴領主', model: 'Barbarian', dmg: 'melee', arm: 'light',
    hp: 30, atk: 14, def: 4, mov: 4, rng: 1,
    show: { 1: ['1H_Axe', 'Barbarian_Hat'], 2: ['2H_Axe', 'Barbarian_Hat'] },
    pass: '嗜血：生命每少 10%，攻擊 +1'
  }
};
const CLS_ORDER = ['KN', 'RG', 'MG', 'CL', 'BB'];
const TEAM_SIZE = 3;                     // 開局五選三

// ── 怪物 ──
//   整體比英雄弱一截，靠數量和地利取勝；等級成長也比英雄平緩（MON_GAIN）
const MON = {
  minion: {
    n: '骷髏小兵', model: 'Skeleton_Minion', dmg: 'melee', arm: 'light',
    hp: 14, atk: 6, def: 1, mov: 4, rng: 1, exp: 30, scale: 0.9, drop: 0.18
  },
  warrior: {
    n: '骷髏戰士', model: 'Skeleton_Warrior', dmg: 'melee', arm: 'heavy',
    hp: 26, atk: 9, def: 5, mov: 4, rng: 1, exp: 55, scale: 1.0, drop: 0.34,
    weapon: 'ske_blade', offhand: 'ske_shield'
  },
  rogue: {
    n: '骷髏獵手', model: 'Skeleton_Rogue', dmg: 'ranged', arm: 'light',
    hp: 19, atk: 8, def: 2, mov: 5, rng: 2, exp: 50, scale: 1.0, drop: 0.30,
    weapon: 'ske_bow'
  },
  mage: {
    n: '骷髏術士', model: 'Skeleton_Mage', dmg: 'magic', arm: 'cloth',
    hp: 17, atk: 10, def: 1, mov: 4, rng: 3, exp: 60, scale: 1.0, drop: 0.36,
    weapon: 'ske_staff'
  },
  boss: {
    n: '骨王', model: 'Skeleton_Warrior', dmg: 'melee', arm: 'heavy',
    hp: 58, atk: 14, def: 8, mov: 4, rng: 1, exp: 200, scale: 1.45, drop: 1,
    weapon: 'ske_axe', offhand: 'ske_shield', tint: 0xffd98a, boss: 1
  }
};

// ── 經驗與升級 ──
const LV_MAX = 10;
const XP_NEED = lv => 55 + (lv - 1) * 25;         // Lv1→2 需 55，之後遞增
const XP_HIT = 12, XP_KILL_PC = 55, XP_HEAL = 14, XP_CNT = 8;
const XP_SHARE = 0.4, XP_SHARE_R = 3;             // 幾格內的隊友分多少經驗
const LV_GAIN = { hp: 5, atk: 2, def: 1 };
const FREE_PTS = 2;                               // 每升一級可自由分配的點數
// 一點自由屬性點換到的東西
const PT_GAIN = { atk: 1, def: 1, hp: 4 };
const PT_N = { atk: '攻擊', def: '防禦', hp: '生命' };
const MON_GAIN = { hp: 4, atk: 1, def: 1 };      // 怪物的等級成長，刻意比英雄慢
const PROMO_LV = 5, PROMO = { hp: 12, atk: 4, def: 3, mov: 1 };

// ── 裝備 ──
// 裝備品質跟技能一樣分五階，倍率就是使用者定的 0.6 / 1 / 1.4 / 2 / 2.5
const RARITY = [
  { n: '普通', col: '#c9d2e0', mult: 0.6 },
  { n: '常見', col: '#5fd39a', mult: 1.0 },
  { n: '稀有', col: '#5aa2ff', mult: 1.4 },
  { n: '史詩', col: '#c07dff', mult: 2.0 },
  { n: '傳說', col: '#e8c168', mult: 2.5 }
];
const AFFIX = [
  { id: 'vamp', n: '吸血', d: '造成傷害時回復 30%' },
  { id: 'rend', n: '破甲', d: '無視目標一半的防禦' },
  { id: 'first', n: '先制', d: '主動攻擊時不會被反擊' },
  { id: 'thorn', n: '反傷', d: '被近戰攻擊時反彈 25% 傷害' },
  { id: 'swift', n: '疾風', d: '移動力 +2' },
  { id: 'guard', n: '守護', d: '受到的傷害 −2' }
];
const GEAR = {
  weapon: [
    { n: '短劍', atk: 3, use: ['KN', 'RG', 'MG', 'CL', 'BB'] },
    { n: '闊劍', atk: 5, use: ['KN', 'BB'] },
    { n: '戰斧', atk: 6, def: -1, use: ['BB', 'KN'] },
    { n: '長弓', atk: 4, rng: 1, use: ['RG'] },
    { n: '法杖', atk: 5, use: ['MG', 'CL'] },
    { n: '權杖', atk: 3, hp: 6, use: ['CL', 'MG'] }
  ],
  armor: [
    { n: '皮甲', def: 3 }, { n: '鎖子甲', def: 5 }, { n: '板甲', def: 7, mov: -1 },
    { n: '法袍', def: 2, hp: 8 }, { n: '鬥篷', def: 3, mov: 1 }
  ],
  trinket: [
    { n: '力量護符', atk: 3 }, { n: '守護石', def: 3 }, { n: '生命寶珠', hp: 12 },
    { n: '疾行靴', mov: 2 }, { n: '鷹眼徽章', rng: 1 }, { n: '戰旗', atk: 2, def: 2 }
  ]
};
const SLOT_N = { weapon: '武器', armor: '防具', trinket: '飾品' };

// ── 動畫名稱 ──
const A = {
  idle: 'Idle', walk: 'Walking_A', melee: '1H_Melee_Attack_Slice_Horizontal',
  chop: '1H_Melee_Attack_Chop', shoot: '1H_Ranged_Shoot', cast: 'Spellcast_Shoot',
  die: 'Death_A', hit: 'Hit_A', cheer: 'Cheer'
};

const SIDE_N = ['藍軍', '紅軍', '魔物'];
const SIDE_COL = [0x4d94ff, 0xff5c47, 0x9b8cff];
const SIDE_CSS = ['#5aa2ff', '#ff6b5a', '#b7abff'];
