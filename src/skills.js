/* ══════════════ 技能表 ══════════════
   90 個技能：五職業各 15（每品質 3，被動 4 個分佈在綠藍紫金）+ 15 個通用。

   數值全是攻擊力的百分比。多目標技能照「實際常打到幾個」配預算
   （直線抓 2、範圍抓 2.5），所以白色的直線技能每發只有 90%，
   不會出現低品質技能總輸出壓過高品質的情形。

   q  品質 0白 1綠 2藍 3紫 4金
   k  執行類型（見 rules.js 的 runSkill）
   st 附加狀態 [{ id, pct, val, turns }]
*/

const QN = ['普通', '常見', '稀有', '史詩', '傳說'];
const QC = ['#c9d2e0', '#5fd39a', '#5aa2ff', '#c07dff', '#e8c168'];
const QHEX = [0xc9d2e0, 0x5fd39a, 0x5aa2ff, 0xc07dff, 0xe8c168];

// ── 狀態定義 ──
const ST = {
  regen:  { n: '恢復', good: 1, d: '每回合開始回復生命' },
  shield: { n: '護盾', good: 1, d: '吸收傷害' },
  atk:    { n: '強化', good: 1, d: '攻擊提升' },
  def:    { n: '堅甲', good: 1, d: '防禦提升' },
  mov:    { n: '迅捷', good: 1, d: '移動提升' },
  crit:   { n: '銳利', good: 1, d: '暴擊率提升' },
  bleed:  { n: '流血', dot: 1, d: '每回合掉血，移動時再掉一次' },
  burn:   { n: '灼燒', dot: 1, d: '每回合掉血，結束時傳染給相鄰敵人' },
  poison: { n: '劇毒', dot: 1, d: '每回合掉血，受到的治療減半' },
  weaken: { n: '虛弱', d: '攻擊下降' },
  sunder: { n: '破甲', d: '防禦下降' },
  curse:  { n: '詛咒', d: '受到的所有傷害增加' },
  stun:   { n: '暈眩', ctrl: 1, d: '不能移動也不能行動' },
  root:   { n: '定身', ctrl: 1, d: '不能移動' },
  silence:{ n: '沉默', ctrl: 1, d: '不能使用技能' },
  freeze: { n: '冰凍', ctrl: 1, d: '不能行動，且受到的傷害 +50%' },
  fear:   { n: '恐懼', ctrl: 1, d: '強制遠離施術者，且不能攻擊' },
  taunt:  { n: '嘲諷', ctrl: 1, d: '下一回合只能攻擊嘲諷來源' },
  disarm: { n: '繳械', d: '不能使用普通攻擊' },
  slow:   { n: '減速', d: '移動力下降' },
  guarded:{ n: '護衛', good: 1, d: '受到的部分傷害改由守護者承擔' },
  mitig:  { n: '絕對防禦', good: 1, d: '受到的傷害直接減少一個百分比' },
  immune: { n: '無敵', good: 1, d: '免疫所有傷害' },
  rip:    { n: '反擊架式', good: 1, d: '反擊傷害提升' },
  resist: { n: '硬控抗性', good: 1, d: '中硬控（暈眩/定身/冰凍/沉默/恐懼）的時間減半' },
  evade:  { n: '閃避', good: 1, d: '下一次受擊減傷一個百分比，觸發後消失' }
};

const s = (id, pct, turns, val) => ({ id, pct, turns, val });

const SK = {
  /* ───────── 騎士 ───────── */
  kn_smite:   { n:'盾擊', q:0, c:'KN', k:'single', pct:0.9, cd:2, rng:1, fx:'bash',
                self:[s('def',0.2,1)], d:'單體 90% 傷害，命中後自身堅甲 +20%（1 回合）。' },
  kn_bash:    { n:'你過來啊', q:0, c:'KN', k:'single', pct:0.6, cd:2, rng:2, fx:'shock',
                st:[s('taunt',0,1)], d:'60% 傷害並嘲諷目標 1 回合（它下回合只能攻擊你）。' },
  kn_sweep:   { n:'掃腿', q:0, c:'KN', k:'fan', pct:0.5, cd:3, fx:'slash',
                st:[{ id:'slow', val:1, turns:1 }], d:'面向三格各 50% 傷害，並使目標減速 −1 格。' },
  kn_cross:   { n:'護衛', q:1, c:'KN', k:'buffAlly', rng:1, cd:3, fx:'ward',
                give:[s('shield',0.5,2), { id:'guarded', val:0.3, turns:2 }],
                d:'指定一格內友軍獲得護盾，2 回合內它受到的 30% 傷害轉給你。' },
  kn_heavy:   { n:'重甲精通', q:1, c:'KN', k:'passive', p:{ rangedRes:0.15, zocCost:1 },
                d:'受到的遠程與法術傷害 −15%，相鄰敵人的移動消耗額外 +1 格。' },
  kn_plate:   { n:'野蠻衝撞', q:1, c:'KN', k:'charge', pct:1.0, len:3, rng:3, cd:3, push:1, fx:'charge',
                d:'向前衝鋒撞擊首個敵人 100% 傷害並擊退一格，停在它面前。' },
  kn_judge:   { n:'盾牌打擊', q:2, c:'KN', k:'single', pct:1.5, cd:3, rng:1, fx:'bash',
                st:[s('root',0,1)], d:'150% 傷害並定身目標 1 回合。' },
  kn_vow:     { n:'陣地盾牆', q:2, c:'KN', k:'buffAround', r:1, cd:4, fx:'ward',
                give:[s('shield',1.0,2), s('def',0.2,2)], self:[{ id:'rip', val:0.3, turns:2 }],
                d:'周圍一格友軍獲得護盾與堅甲，自身反擊傷害 +30%（2 回合）。' },
  kn_iron:    { n:'鋼鐵之軀', q:2, c:'KN', k:'passive', p:{ defPct:0.15, noPush:1 },
                d:'防禦 +15%，且免疫擊退與拉扯。' },
  kn_sunder:  { n:'咆哮獅吼', q:3, c:'KN', k:'frontbox', pct:0.4, depth:2, cd:5, fx:'shout',
                st:[s('taunt',0,2), s('weaken',0.2,2)],
                d:'前方 3×2 範圍 40% 傷害，並施加嘲諷與虛弱 −20%（2 回合）。' },
  kn_whirl:   { n:'荊棘之盾', q:3, c:'KN', k:'passive', p:{ retalFlat:1.0, retaliate:s('bleed',0.3,2) },
                d:'每次被近戰攻擊，反彈相當於自身防禦的固定傷害，並使攻擊者流血 30%（2 回合）。' },
  kn_thorn:   { n:'破甲重擊', q:3, c:'KN', k:'single', pct:1.8, cd:4, rng:1, fx:'slash',
                st:[s('sunder',0.3,2)], d:'180% 傷害並破甲 −30%（2 回合）。' },
  kn_command: { n:'不朽堡壘', q:4, c:'KN', k:'buffAround', r:3, cd:6, fx:'shock',
                give:[{ id:'shield', hpPct:0.3, turns:2 }], self:[{ id:'mitig', val:0.3, turns:2 }],
                d:'周圍 3 格友軍獲得相當於自身最大生命 30% 的護盾，自身減傷 30%（2 回合）。' },
  kn_bulwark: { n:'聖裁', q:4, c:'KN', k:'single', pct:2.0, cd:4, rng:1, fx:'holy',
                st:[s('stun',0,1)], d:'200% 傷害並暈眩目標 1 回合。' },
  kn_undying: { n:'不倒之軀', q:4, c:'KN', k:'passive', p:{ lastStand:1 },
                d:'生命歸零時保留 1 點並獲得無敵 1 回合，每場一次。' },

  /* ───────── 遊俠 ───────── */
  rg_quick:   { n:'連射', q:0, c:'RG', k:'multi', rng:0, pct:0.6, hits:2, cd:2, fx:'arrow',
                d:'快速射出兩箭，對單體造成 60% × 2 傷害。' },
  rg_pierce:  { n:'貫穿射擊', q:0, c:'RG', k:'line', rng:0, pct:0.6, len:3, cd:3, fx:'arrow',
                d:'對直線 3 格內的敵人各造成 60% 傷害。' },
  rg_snare:   { n:'後撤步', q:0, c:'RG', k:'single', rng:0, pct:0.8, cd:3, retreat:2, fx:'arrow',
                d:'射出一箭 80% 傷害，然後往後退 2 格（無視地形消耗）。' },
  rg_double:  { n:'蓄力箭', q:1, c:'RG', k:'single', pct:1.8, cd:3, rng:0, rooted:1, noAfterMove:1, fx:'arrow',
                d:'犧牲本回合移動，對單體造成 180% 傷害（已移動則不能發動）。' },
  rg_spread:  { n:'散射', q:1, c:'RG', k:'pick', pct:0.6, pick:3, r:1, cd:3, rng:0, fx:'arrow',
                d:'對指定目標周圍一格內最多三個敵人各造成 60% 傷害。' },
  rg_wind:    { n:'疾風步', q:1, c:'RG', k:'passive', p:{ mov:1, forest:1 },
                d:'移動力 +1，穿越森林不消耗額外移動力。' },
  rg_focus:   { n:'鷹眼專注', q:2, c:'RG', k:'single', rng:0, pct:1.0, cd:4, fx:'arrow',
                self:[s('crit',0.2,2), s('atk',0.2,2)],
                d:'100% 傷害，並使自身獲得銳利 +20% 與強化 +20%（2 回合）。' },
  rg_ap:      { n:'穿甲箭', q:2, c:'RG', k:'line', rng:0, pct:1.0, len:4, cd:4, ignoreTer:1, armorPen:0.3, fx:'arrow',
                d:'直線 4 格內各 100% 傷害，無視地形防禦與目標 30% 防禦。' },
  rg_instinct:{ n:'專注', q:2, c:'RG', k:'passive', p:{ singleDmg:0.15 },
                d:'造成的任何單體傷害 +15%。' },
  rg_poison:  { n:'毒箭', q:3, c:'RG', k:'single', rng:0, pct:1.4, cd:4, fx:'poison',
                st:[s('poison',0.2,3)], d:'140% 傷害並附加劇毒 20%（3 回合，治療減半）。' },
  rg_bramble: { n:'蛛絲箭', q:3, c:'RG', k:'single', rng:0, pct:1.2, cd:4, fx:'arrow',
                st:[s('root',0,1)], aoeSt:[{ id:'slow', val:1, turns:2 }],
                d:'120% 傷害並定身目標 1 回合，對其周圍一格敵人施加減速 −1 格（2 回合）。' },
  rg_weak:    { n:'致命弱點', q:3, c:'RG', k:'passive', p:{ vsDebuff:0.25 },
                d:'對帶有任何負面狀態的目標，傷害 +25%。' },
  rg_rain:    { n:'箭雨', q:4, c:'RG', k:'aoe', pct:1.3, r:1, cd:6, rng:4, fx:'rain',
                st:[s('weaken',0.2,2)], d:'目標周圍一格所有敵人各 130% 傷害並虛弱 −20%（2 回合）。' },
  rg_mark:    { n:'死亡標記', q:4, c:'RG', k:'single', rng:0, pct:2.2, cd:6, fx:'mark',
                st:[s('curse',0.25,2)], resetOnKill:1,
                d:'220% 傷害並附加詛咒 +25%（2 回合）；擊殺目標則冷卻立刻重置。' },
  rg_eye:     { n:'千里之瞳', q:4, c:'RG', k:'passive', p:{ rng:1, farNoCounter:3, farDmg:0.2 },
                d:'射程 +1（山地再 +1）；對 3 格外的目標傷害 +20%、永不被反擊。' },

  /* ───────── 法師 ───────── */
  mg_bolt:    { n:'奧術飛彈', q:0, c:'MG', k:'single', rng:0, pct:1.0, cd:2, ignoreTer:1, fx:'arcane',
                d:'對單體造成 100% 傷害，無視地形防禦。' },
  mg_fire:    { n:'火球', q:0, c:'MG', k:'aoe', pct:0.7, edgePct:0.3, r:1, cd:2, rng:4, fx:'fire',
                d:'對目標 70% 傷害，周圍一格 30% 傷害。' },
  mg_shard:   { n:'冰錐', q:0, c:'MG', k:'line', rng:0, pct:0.6, len:3, cd:3, fx:'ice',
                st:[{ id:'slow', val:1, turns:1 }], d:'直線 3 格內各 60% 傷害並減速 −1 格。' },
  mg_burst:   { n:'烈焰噴發', q:1, c:'MG', k:'aoe', pct:0.7, r:1, cd:3, rng:4, fx:'fire',
                st:[s('burn',0.15,2)], d:'目標及周圍一格 70% 傷害，附加灼燒 15%（2 回合）。' },
  mg_blink:   { n:'閃現', q:1, c:'MG', k:'teleport', cd:4, rng:4, fx:'blink',
                self:[s('mov',0,1,1)], d:'瞬移到 4 格內的空地，自身獲得迅捷 +1 格（1 回合）。' },
  mg_affinity:{ n:'元素親和', q:1, c:'MG', k:'passive', p:{ magicPct:0.25 },
                d:'所有法術傷害 +25%。' },
  mg_tsunami: { n:'海嘯', q:2, c:'MG', k:'wave', pct:0.9, cd:4, rng:4, push:1, fx:'water',
                d:'三格寬的水牆推過去 90% 傷害，把命中的敵人隨機推開 1 格。' },
  mg_ward:    { n:'秘法護盾', q:2, c:'MG', k:'buffSelf', cd:4, fx:'ward',
                self:[s('shield',1.5,2), s('def',0.3,2)], d:'自身獲得護盾 150% 與堅甲 +30%（2 回合）。' },
  mg_insight: { n:'奧術洞察', q:2, c:'MG', k:'passive', p:{ crit:0.15, splash:0.2 },
                d:'暴擊率 +15%，暴擊時對相鄰敵人濺射 20%。' },
  mg_storm:   { n:'烈焰風暴', q:3, c:'MG', k:'field', pct:1.0, r:1, turns:2, cd:5, rng:4, fx:'fire',
                st:[s('burn',0.3,3)], d:'指定 3×3 地塊 100% 傷害，火風暴持續 2 回合，範圍內敵人一直被刷新灼燒 30%。' },
  mg_thunder: { n:'冰晶射擊', q:3, c:'MG', k:'rand', rng:4, pct:0.8, pick:3, cd:5, stChance:0.3, fx:'ice',
                st:[s('freeze',0,1)], d:'對射程內三個隨機敵人各 80% 傷害，30% 機率冰凍 1 回合。' },
  mg_echo:    { n:'奧術大師', q:3, c:'MG', k:'passive', p:{ cdCut:1 },
                d:'所有主動技能的初始冷卻時間 −1 回合。' },
  mg_meteor:  { n:'死命毒霧', q:4, c:'MG', k:'field', pct:0.8, r:2, turns:2, cd:6, rng:5, fx:'poison',
                st:[s('poison',0.4,4)], d:'指定 5×5 地塊 80% 傷害，毒霧持續 2 回合，範圍內敵人一直被刷新劇毒 40%。' },
  mg_zero:    { n:'絕對零度', q:4, c:'MG', k:'aoe', pct:1.0, r:2, cd:6, rng:4, fx:'ice',
                st:[s('freeze',0,1)], d:'目標周圍兩格所有敵人 100% 傷害並冰凍 1 回合。' },
  mg_warp:    { n:'時間錯位', q:4, c:'MG', k:'passive', p:{ cdCut:1, freeCast:0.25 },
                d:'每回合開始所有技能冷卻額外 −1；使用技能時 25% 機率不進冷卻。' },

  /* ───────── 牧師 ───────── */
  cl_heal:    { n:'治癒之光', q:0, c:'CL', k:'heal', rng:0, pct:1.0, cd:2, fx:'heal',
                d:'對單體友軍進行 100% 治療。' },
  cl_first:   { n:'急救', q:0, c:'CL', k:'buffAlly', rng:2, cd:3, fx:'heal',
                give:[s('regen',0.3,3)], d:'對單體友軍施加恢復 30%（3 回合）。' },
  cl_smite:   { n:'審視', q:0, c:'CL', k:'aoe', rng:3, pct:0, r:0, cd:2, fx:'holy',
                st:[s('weaken',0.2,2)], d:'對目標附加虛弱 −20%（2 回合）。' },
  cl_mass:    { n:'群體治療', q:1, c:'CL', k:'healAoe', pct:0.7, r:1, cd:3, rng:3, fx:'heal',
                d:'指定目標周圍一格友軍各治療 70%。' },
  cl_aura:    { n:'治療光環', q:1, c:'CL', k:'aura', pct:0.2, r:2, turns:3, cd:4, fx:'aura',
                d:'自身 2 格內友軍獲得恢復 20%/回合（3 回合）。' },
  cl_piety:   { n:'虔誠', q:1, c:'CL', k:'passive', p:{ healBoost:0.2 },
                d:'治療量 +20%。' },
  cl_guard:   { n:'加護', q:2, c:'CL', k:'buffAlly', rng:3, cd:3, fx:'ward',
                give:[s('shield',1.3,2), s('def',0.2,2)],
                d:'為友軍施加護盾 130% 與堅甲 +20%（2 回合）。' },
  cl_bless:   { n:'神聖祝福', q:2, c:'CL', k:'buffAlly', cd:4, rng:3, cleanse:1, fx:'buff',
                give:[s('regen',0.3,2)], d:'清除友軍 1 個負面狀態，並附加恢復 30%/回合（2 回合）。' },
  cl_drain:   { n:'生命汲取', q:2, c:'CL', k:'passive', p:{ healBack:0.1 },
                d:'進行治療時，自身同時回復該次治療量 10% 的生命。' },
  cl_revive:  { n:'復甦禱言', q:3, c:'CL', k:'healAoe', pct:1.2, r:1, cd:5, rng:3, cleanse:1, fx:'heal',
                d:'目標周圍一格友軍各治療 120%，並清除其所有負面狀態。' },
  cl_punish:  { n:'背金句', q:3, c:'CL', k:'single', rng:0, pct:1.5, cd:4, fx:'holy',
                st:[s('weaken',0.3,2), s('silence',0,1)],
                d:'150% 法術傷害，附加虛弱 −30%（2 回合）與沉默 1 回合。' },
  cl_link:    { n:'買一送一', q:3, c:'CL', k:'passive', p:{ healProc:0.25 },
                d:'治療目標有 25% 機率額外獲得強化 +15% 或堅甲 +15%（1 回合）。' },
  cl_domain:  { n:'神聖領域', q:4, c:'CL', k:'field', r:2, turns:2, cd:6, rng:3, heal:1.5, fx:'domain',
                give:[s('atk',0.2,2), s('regen',0.4,2)],
                d:'指定 5×5 地塊，領域內友軍每回合治療 150% 並獲得強化 +20% 與恢復 40%（持續 2 回合）。' },
  cl_breath:  { n:'重生之息', q:4, c:'CL', k:'raise', cd:8, uses:2, raiseHp:0.4, fx:'raise',
                d:'讓一名倒下的隊友立刻在身邊復活，恢復 40% 生命。' },
  cl_martyr:  { n:'殉道', q:4, c:'CL', k:'passive', p:{ martyr:0.3 },
                d:'倒下時，全隊友軍立刻回復 30% 最大生命並獲得護盾 100%。' },

  /* ───────── 狂戰士 ───────── */
  bb_brutal:  { n:'蠻力一擊', q:0, c:'BB', k:'single', pct:1.3, cd:2, rng:1, fx:'slash',
                d:'單體 130% 傷害。' },
  bb_sweep:   { n:'挑飛', q:0, c:'BB', k:'single', pct:0.5, cd:3, rng:1, fx:'shock',
                st:[s('disarm',0,1)], d:'50% 傷害並繳械目標 1 回合（不能用普攻）。' },
  bb_stomp:   { n:'橫掃', q:0, c:'BB', k:'around', pct:0.6, cd:3, fx:'whirl',
                d:'橫掃周圍一格的所有敵人各 60% 傷害。' },
  bb_charge:  { n:'衝鋒', q:1, c:'BB', k:'charge', pct:1.2, len:4, rng:4, cd:3, push:1, fx:'charge',
                d:'向敵人衝鋒最多 4 格，造成 120% 傷害並撞退一格。' },
  bb_cyclone: { n:'旋風斬', q:1, c:'BB', k:'around', pct:0.8, cd:3, fx:'whirl',
                d:'周圍一格所有敵人各 80% 傷害。' },
  bb_blood:   { n:'嗜血', q:1, c:'BB', k:'passive', p:{ lowHpAtkPct:0.02 },
                d:'生命每少 10%，攻擊力 +2%（最多 +20%）。' },
  bb_rage:    { n:'狂暴', q:2, c:'BB', k:'buffSelf', cd:4, fx:'buff', hpCost:0.2,
                self:[s('atk',0.4,2), s('mov',0,2,2)],
                d:'扣除當前生命的 20%，換取強化 +40% 與迅捷 +2 格（2 回合）。' },
  bb_shout:   { n:'亂斬', q:2, c:'BB', k:'multi', pct:0.4, hits:4, cd:3, rng:1, fx:'slash',
                d:'對單體造成 40% × 4 的多段傷害。' },
  bb_fervor:  { n:'戰鬥狂熱', q:2, c:'BB', k:'passive', p:{ stackOnHurt:0.08 },
                d:'每被攻擊一次，下次攻擊 +8%（最多疊加），出手後清空。' },
  bb_rend:    { n:'裂斬', q:3, c:'BB', k:'single', pct:1.8, cd:3, rng:1, fx:'slash',
                st:[s('sunder',0.3,2)], d:'180% 傷害並破甲 −30%（2 回合）。' },
  bb_gore:    { n:'一劍封喉', q:3, c:'BB', k:'single', pct:1.8, cd:4, rng:1, fx:'slash',
                st:[s('silence',0,1)], d:'180% 傷害並沉默目標 1 回合。' },
  bb_fury:    { n:'血怒', q:3, c:'BB', k:'passive', p:{ lifesteal:0.1 },
                d:'造成物理傷害的 10% 轉為生命；生命低於 30% 時翻倍（20%）。' },
  bb_exec:    { n:'血腥旋風', q:4, c:'BB', k:'around', pct:1.2, cd:5, lifesteal:0.1, fx:'whirl',
                d:'旋轉對周圍一格敵人各 120% 傷害，造成的傷害 10% 轉為生命（生命 <30% 翻倍）。' },
  bb_slay:    { n:'屠戮', q:4, c:'BB', k:'single', pct:1.5, cd:6, rng:1, fx:'exec',
                self:[s('atk',0.2,1)], resetOnKill:1, killAct:1,
                d:'強化自身 20%，150% 傷害；若擊殺目標，冷卻清零並恢復本回合行動。' },
  bb_deathless:{ n:'血腥氣息', q:4, c:'BB', k:'passive', p:{ procFear:0.25 },
                d:'每次造成傷害時 25% 機率使目標恐懼 1 回合。' },

  /* ───────── 通用（無限制・位移／自保／輔助，全部 u:'all'）───────── */
  u_dash:     { n:'包紮', q:0, u:'all', k:'heal', pct:0.5, cd:3, rng:1, cleanseIds:['bleed'], fx:'heal',
                d:'對自己或相鄰友軍治療 50%，並解除流血。' },
  u_kit:      { n:'小步後撤', q:0, u:'all', k:'retreat', len:1, cd:2, fx:'buff',
                d:'向後退 1 格，不會觸發反擊、也不受敵人控制區域限制。' },
  u_feint:    { n:'投擲石塊', q:0, u:'all', k:'single', pct:0.5, cd:2, rng:3, stChance:0.3, fx:'bash',
                st:[{ id:'slow', val:1, turns:1 }], d:'3 格內單體 50% 傷害，30% 機率使目標減速 −1 格。' },
  u_retreat:  { n:'戰術滾翻', q:1, u:'all', k:'teleport', rng:3, cd:3, self:[{ id:'evade', val:0.1, turns:1 }], fx:'blink',
                d:'翻滾到 3 格內的空地，本回合下一次受擊減傷 10%（只擋一次）。' },
  u_aim:      { n:'喝一口藥酒', q:1, u:'all', k:'buffSelf', cd:4, cleanse:1, self:[s('regen',0.15,2)], fx:'heal',
                d:'解除自身 1 個負面狀態，並獲得恢復 15%/回合（2 回合）。' },
  u_vet:      { n:'格擋防禦', q:1, u:'all', k:'buffSelf', cd:3, self:[s('shield',0.5,1), s('def',0.15,1)], fx:'ward',
                d:'自身獲得護盾 50% 與堅甲 +15%（1 回合）。' },
  u_order:    { n:'強心劑', q:2, u:'all', k:'buffSelf', cd:4, cleanseIds:['slow','root'], self:[{ id:'mov', val:2, turns:2 }], fx:'buff',
                d:'清除自身減速／定身，並獲得迅捷 +2 格（2 回合）。' },
  u_break:    { n:'煙霧彈', q:2, u:'all', k:'field', r:1, turns:2, cd:5, rng:3, untargetable:1, fx:'poison',
                d:'指定地塊建立 3×3 煙霧（2 回合），範圍內單位無法被遠程普攻／單體技能鎖定（近戰不受影響）。' },
  u_tough:    { n:'求生本能', q:2, u:'all', k:'passive', p:{ lowHpProc:1 },
                d:'生命跌破 30% 時，立刻獲得護盾 50% 與迅捷 +1（每場約每 8 回合觸發一次）。' },
  u_curse:    { n:'極限逃脫', q:3, u:'all', k:'teleport', rng:3, cd:5, cleanseIds:['bleed','poison','burn'], fx:'blink',
                d:'瞬移到 3 格內的空地，並清除自身流血／劇毒／灼燒。' },
  u_daunt:    { n:'興奮劑', q:3, u:'all', k:'buffSelf', cd:5, hpCost:0.15, cdAllCut:1, self:[s('atk',0.2,1)], fx:'buff',
                d:'扣除自身 15% 目前生命，使自己所有技能冷卻 −1，並獲得強化 +20%（1 回合）。' },
  u_riposte:  { n:'百折不撓', q:3, u:'all', k:'passive', p:{ badDurationHalf:1, defWhileDebuffed:0.25 },
                d:'受到的負面狀態時間減半；身上有任何負面狀態時，堅甲 +25%。' },
  u_cage:     { n:'凝霜寶珠', q:4, u:'all', k:'buffSelf', cd:7, noAfterMove:1, selfLock:1, self:[{ id:'immune', turns:1 }], fx:'ice',
                d:'自身獲得無敵 1 回合，期間不能移動或行動（本回合已移動則不能發動）。' },
  u_solo:     { n:'全軍突擊', q:4, u:'all', k:'buffAround', r:3, cd:6, give:[{ id:'mov', val:2, turns:2 }, s('atk',0.15,2)], fx:'shout',
                d:'周圍 3 格內所有友軍獲得迅捷 +2 格與強化 +15%（2 回合）。' },
  u_will:     { n:'潔白之身', q:4, u:'all', k:'passive', p:{ ctrlImmune:1 },
                d:'免疫所有控制；受到的控制改為堅甲。' }
};

const SK_IDS = Object.keys(SK);
const UGROUP = { melee: ['KN', 'BB'], range: ['RG', 'MG'], sup: ['CL', 'MG'], all: CLS_ORDER };

// 這個職業能不能學這個技能
function skCanUse(cls, id) {
  const k = SK[id];
  if (!k) return false;
  if (k.c) return k.c === cls;
  const set = new Set();
  for (const g of k.u.split(',')) UGROUP[g].forEach(c => set.add(c));
  return set.has(cls);
}
const skIsPassive = id => SK[id].k === 'passive';
// 開局送的白色主動
const START_SKILL = { KN: 'kn_smite', RG: 'rg_pierce', MG: 'mg_fire', CL: 'cl_heal', BB: 'bb_sweep' };
