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
  fear:   { n: '恐懼', ctrl: 1, d: '強制遠離施術者，且不能攻擊' }
};

const s = (id, pct, turns, val) => ({ id, pct, turns, val });

const SK = {
  /* ───────── 騎士 ───────── */
  kn_smite:   { n:'猛擊', q:0, c:'KN', k:'single', pct:1.5, cd:2, rng:1, fx:'slash',
                d:'單體重擊。' },
  kn_bash:    { n:'盾牆突擊', q:0, c:'KN', k:'single', pct:1.1, cd:2, rng:1, noCounter:1, fx:'bash',
                d:'撞上去，攻擊後不會被反擊。' },
  kn_sweep:   { n:'掃腿', q:0, c:'KN', k:'fan', pct:0.75, cd:3, fx:'slash',
                d:'掃過面向的三格扇形。' },
  kn_cross:   { n:'十字斬', q:1, c:'KN', k:'cross', pct:1.0, cd:3, fx:'slash',
                d:'砍向上下左右四格。' },
  kn_heavy:   { n:'重擊', q:1, c:'KN', k:'single', pct:1.8, cd:3, rng:1, push:1, fx:'slash',
                d:'一記重擊把目標打退一格。' },
  kn_plate:   { n:'重甲精通', q:1, c:'KN', k:'passive', p:{ rangedRes:0.15 },
                d:'受到的遠程與法術傷害 −15%。' },
  kn_judge:   { n:'聖裁', q:2, c:'KN', k:'single', pct:2.1, cd:4, rng:1, fx:'holy',
                self:[s('def',0.4,2)], d:'審判一擊，命中後自身防禦提升。' },
  kn_vow:     { n:'守護誓約', q:2, c:'KN', k:'buffAround', r:1, cd:4, fx:'ward',
                give:[s('shield',1.5,3)], self:[s('def',0.3,2)],
                d:'替周圍一格的友軍張開護盾，自己也更硬。' },
  kn_iron:    { n:'鋼鐵之軀', q:2, c:'KN', k:'passive', p:{ defPct:0.15, noPush:1 },
                d:'防禦 +15%，且免疫擊退與拉扯。' },
  kn_sunder:  { n:'破甲重擊', q:3, c:'KN', k:'single', pct:2.5, cd:4, rng:1, fx:'slash',
                st:[s('sunder',0.35,3)], d:'砸開對方的護甲。' },
  kn_whirl:   { n:'迴旋斬', q:3, c:'KN', k:'around', pct:1.65, cd:5, fx:'whirl',
                d:'橫掃周圍一格的所有敵人。' },
  kn_thorn:   { n:'復仇之盾', q:3, c:'KN', k:'passive', p:{ retaliate:s('bleed',0.2,2) },
                d:'每次被近戰攻擊，讓攻擊者流血。' },
  kn_command: { n:'王者號令', q:4, c:'KN', k:'single', pct:3.2, cd:6, rng:1, fx:'holy',
                st:[s('stun',0,1)], allyR:1, give:[s('atk',0.5,2)],
                d:'一擊震暈目標，同時鼓舞周圍一格的友軍。' },
  kn_bulwark: { n:'聖盾壁壘', q:4, c:'KN', k:'around', pct:2.0, cd:6, fx:'shock',
                st:[s('root',0,1)], d:'盾牆一震，周圍的敵人全部被定住。' },
  kn_undying: { n:'不倒之軀', q:4, c:'KN', k:'passive', p:{ lastStand:1 },
                d:'生命歸零時保留 1 點並獲得堅甲，每場一次。' },

  /* ───────── 遊俠 ───────── */
  rg_quick:   { n:'快射', q:0, c:'RG', k:'single', rng:0, pct:1.5, cd:2, freeMove:1, fx:'arrow',
                d:'快速一箭，不消耗移動。' },
  rg_pierce:  { n:'貫穿射擊', q:0, c:'RG', k:'line', rng:0, pct:0.9, len:3, cd:3, fx:'arrow',
                d:'射穿一直線上的敵人。' },
  rg_snare:   { n:'絆索', q:0, c:'RG', k:'trap', pct:1.1, cd:3, rng:3, fx:'trap',
                d:'在空地放一個絆索，踩到會受傷並停下。' },
  rg_double:  { n:'雙連射', q:1, c:'RG', k:'multi', pct:1.15, hits:2, cd:3, rng:0, fx:'arrow',
                d:'對同一個目標連射兩箭。' },
  rg_spread:  { n:'散射', q:1, c:'RG', k:'pick', pct:1.0, pick:3, r:1, cd:3, rng:0, fx:'arrow',
                d:'一次射向目標附近最多三個敵人。' },
  rg_wind:    { n:'疾風步', q:1, c:'RG', k:'passive', p:{ mov:1, forest:1 },
                d:'移動 +1，穿越森林不加成移動消耗。' },
  rg_focus:   { n:'鷹眼專注', q:2, c:'RG', k:'buffSelf', cd:4, fx:'buff',
                self:[s('crit',0.6,2), s('atk',0.3,2)], d:'凝神，暴擊率與攻擊大幅提升。' },
  rg_ap:      { n:'穿甲箭', q:2, c:'RG', k:'line', rng:0, pct:1.45, len:4, cd:4, ignoreTer:1, fx:'arrow',
                d:'無視地形防禦的穿甲一箭。' },
  rg_instinct:{ n:'獵人本能', q:2, c:'RG', k:'passive', p:{ firstNoCounter:1 },
                d:'每回合第一次攻擊必定不會被反擊。' },
  rg_poison:  { n:'毒箭', q:3, c:'RG', k:'single', rng:0, pct:2.5, cd:4, fx:'poison',
                st:[s('poison',0.25,3)], d:'淬毒的一箭，持續掉血且治療減半。' },
  rg_bramble: { n:'荊棘陷阱', q:3, c:'RG', k:'trapN', pct:1.85, n:3, cd:5, rng:3, fx:'trap',
                st:[s('bleed',0.25,2)], d:'在目標周圍佈下三個荊棘陷阱。' },
  rg_weak:    { n:'致命弱點', q:3, c:'RG', k:'passive', p:{ vsDebuff:0.3 },
                d:'對身上有負面狀態的目標傷害 +30%。' },
  rg_rain:    { n:'箭雨', q:4, c:'RG', k:'aoe', pct:2.0, r:1, cd:6, rng:4, fx:'rain',
                st:[s('root',0,1)], d:'一輪箭雨落下，命中的敵人被釘在原地。' },
  rg_mark:    { n:'死亡標記', q:4, c:'RG', k:'single', rng:0, pct:3.2, cd:6, fx:'mark',
                st:[s('curse',0.3,2)], resetOnKill:1,
                d:'標記獵物；若它在本回合內死亡，冷卻立刻重置。' },
  rg_eye:     { n:'千里之瞳', q:4, c:'RG', k:'passive', p:{ rng:1, farNoCounter:3 },
                d:'射程 +1（山地再 +1）；對 3 格外的目標永不被反擊。' },

  /* ───────── 法師 ───────── */
  mg_bolt:    { n:'奧術飛彈', q:0, c:'MG', k:'single', rng:0, pct:1.5, cd:2, ignoreTer:1, fx:'arcane',
                d:'無視地形防禦的一發飛彈。' },
  mg_fire:    { n:'火球', q:0, c:'MG', k:'aoe', pct:0.75, r:1, cd:3, rng:4, fx:'fire',
                d:'在目標周圍一格炸開。' },
  mg_shard:   { n:'冰錐', q:0, c:'MG', k:'line', rng:0, pct:0.9, len:3, cd:3, fx:'ice',
                d:'一排冰錐刺穿直線。' },
  mg_burst:   { n:'烈焰噴發', q:1, c:'MG', k:'aoe', pct:1.0, r:1, cd:3, rng:4, fx:'fire',
                d:'更猛的一次火焰噴發。' },
  mg_blink:   { n:'閃現', q:1, c:'MG', k:'teleport', cd:5, rng:5, fx:'blink',
                d:'瞬移到 5 格內的空地。' },
  mg_affinity:{ n:'元素親和', q:1, c:'MG', k:'passive', p:{ magicPct:0.1, cdCut:1 },
                d:'法術傷害 +10%，所有技能冷卻 −1。' },
  mg_tsunami: { n:'海嘯', q:2, c:'MG', k:'wave', pct:1.45, cd:4, rng:4, push:2, fx:'water',
                d:'三格寬的水牆推過去，把命中的敵人隨機推開 1～2 格。' },
  mg_ward:    { n:'秘法護盾', q:2, c:'MG', k:'buffSelf', cd:4, fx:'ward',
                self:[s('shield',2.0,3), s('def',0.5,2)], d:'替自己張開秘法護盾。' },
  mg_insight: { n:'奧術洞察', q:2, c:'MG', k:'passive', p:{ crit:0.15, splash:0.2 },
                d:'暴擊率 +15%，暴擊時對相鄰敵人濺射 20%。' },
  mg_storm:   { n:'烈焰風暴', q:3, c:'MG', k:'aoe', pct:1.65, r:1, cd:4, rng:4, fx:'fire',
                st:[s('burn',0.25,3)], d:'燃起火風暴，留下持續灼燒。' },
  mg_thunder: { n:'雷霆貫穿', q:3, c:'MG', k:'line', rng:0, pct:1.85, len:5, cd:5, fx:'bolt',
                st:[s('sunder',0.25,2)], d:'一道雷貫穿五格並震裂護甲。' },
  mg_echo:    { n:'熵能迴響', q:3, c:'MG', k:'passive', p:{ aoeDebuff:s('weaken',0.2,2) },
                d:'你的範圍傷害額外讓目標虛弱。' },
  mg_meteor:  { n:'隕石術', q:4, c:'MG', k:'delayed', pct:2.0, r:2, cd:6, rng:5, fx:'meteor',
                d:'指定一點，下回合開始隕石落下 —— 有一回合可以躲。' },
  mg_zero:    { n:'絕對零度', q:4, c:'MG', k:'aoe', pct:2.0, r:1, cd:6, rng:4, fx:'ice',
                st:[s('freeze',0,2)], d:'凍結目標周圍一格的所有敵人。' },
  mg_warp:    { n:'時間錯位', q:4, c:'MG', k:'passive', p:{ cdCut:1, freeCast:0.3 },
                d:'每回合開始冷卻額外 −1；使用技能後 30% 不進冷卻。' },

  /* ───────── 牧師 ───────── */
  cl_heal:    { n:'治癒之光', q:0, c:'CL', k:'heal', rng:0, pct:1.6, cd:2, fx:'heal',
                d:'治療單一友軍。' },
  cl_first:   { n:'急救', q:0, c:'CL', k:'heal', rng:0, pct:0.9, cd:3, freeAct:1, fx:'heal',
                d:'快速治療，不消耗行動。' },
  cl_smite:   { n:'審判之光', q:0, c:'CL', k:'single', rng:0, pct:1.3, cd:3, fx:'holy',
                d:'降下一道審判之光。' },
  cl_mass:    { n:'群體治療', q:1, c:'CL', k:'healAoe', pct:1.1, r:1, cd:3, rng:3, fx:'heal',
                d:'治療目標周圍一格的所有友軍。' },
  cl_aura:    { n:'治療光環', q:1, c:'CL', k:'aura', pct:0.25, r:2, turns:4, cd:5, fx:'aura',
                d:'展開光環，自身兩格內的友軍每回合回復。' },
  cl_piety:   { n:'虔誠', q:1, c:'CL', k:'passive', p:{ healBack:0.3 },
                d:'治療時自己回復該次治療量的 30%。' },
  cl_guard:   { n:'加護', q:2, c:'CL', k:'shield', pct:1.9, cd:3, rng:3, fx:'ward',
                d:'給友軍一層能吸收傷害的護盾。' },
  cl_bless:   { n:'神聖祝福', q:2, c:'CL', k:'buffAlly', cd:4, rng:3, fx:'buff',
                give:[s('regen',0.45,3), s('def',0.3,3)], d:'讓友軍持續回復並更加堅韌。' },
  cl_drain:   { n:'生命汲取', q:2, c:'CL', k:'passive', p:{ dmgToHeal:0.5 },
                d:'你造成傷害時，生命最低的友軍回復該傷害的 50%。' },
  cl_revive:  { n:'復甦禱言', q:3, c:'CL', k:'healAoe', pct:2.0, r:1, cd:5, rng:3, cleanse:1, fx:'heal',
                d:'大範圍治療，並清除所有負面狀態。' },
  cl_punish:  { n:'制裁', q:3, c:'CL', k:'single', rng:0, pct:2.5, cd:4, fx:'holy',
                st:[s('weaken',0.35,3)], d:'制裁一擊，大幅削弱目標的攻擊。' },
  cl_link:    { n:'生命鏈結', q:3, c:'CL', k:'passive', p:{ linkShare:0.25 },
                d:'你治療過的目標，下一回合受到的傷害 25% 轉到你身上。' },
  cl_domain:  { n:'神聖領域', q:4, c:'CL', k:'domain', pct:2.9, r:2, cd:6, fx:'domain',
                give:[s('atk',0.4,2)], st:[s('silence',0,2)],
                d:'展開領域：兩格內友軍大量回復並強化，敵人被沉默。' },
  cl_breath:  { n:'重生之息', q:4, c:'CL', k:'raise', cd:8, uses:2, fx:'raise',
                d:'讓一個倒下的隊友立刻在你身邊站起來，生命回到 60%。' },
  cl_martyr:  { n:'殉道', q:4, c:'CL', k:'passive', p:{ martyr:0.4 },
                d:'你倒下時全隊回復最大生命 40% 並獲得強化。' },

  /* ───────── 狂戰士 ───────── */
  bb_brutal:  { n:'蠻力一擊', q:0, c:'BB', k:'single', pct:1.5, cd:2, rng:1, fx:'slash',
                d:'一記蠻力猛砍。' },
  bb_sweep:   { n:'橫掃', q:0, c:'BB', k:'around', pct:0.75, cd:3, fx:'whirl',
                d:'橫掃周圍一格的所有敵人。' },
  bb_stomp:   { n:'猛踏', q:0, c:'BB', k:'single', pct:1.1, cd:3, rng:1, push:1, fx:'shock',
                d:'一腳把面前的敵人踏退一格。' },
  bb_charge:  { n:'衝鋒', q:1, c:'BB', k:'charge', pct:1.8, len:4, rng:4, cd:4, push:1, fx:'charge',
                d:'直線衝鋒撞向敵人並把它撞退。' },
  bb_cyclone: { n:'旋風斬', q:1, c:'BB', k:'around', pct:1.0, cd:3, fx:'whirl',
                d:'更狠的一次旋風。' },
  bb_blood:   { n:'嗜血', q:1, c:'BB', k:'passive', p:{ lowHpAtk:1 },
                d:'生命每少 10%，攻擊 +1。' },
  bb_rage:    { n:'狂暴', q:2, c:'BB', k:'buffSelf', cd:5, fx:'buff',
                self:[s('atk',0.6,2), s('mov',0,2,2)], d:'進入狂暴，攻擊和移動大幅提升。' },
  bb_shout:   { n:'戰吼', q:2, c:'BB', k:'buffAround', r:2, cd:5, fx:'shout',
                give:[s('atk',0.35,2)], self:[s('def',0.3,2)],
                d:'一聲怒吼鼓舞兩格內的同伴。' },
  bb_fervor:  { n:'戰鬥狂熱', q:2, c:'BB', k:'passive', p:{ stackOnHurt:0.12 },
                d:'每被攻擊一次，下次攻擊 +12%（最多五層）。' },
  bb_rend:    { n:'撕裂', q:3, c:'BB', k:'single', pct:2.5, cd:3, rng:1, fx:'slash',
                st:[s('bleed',0.3,3)], d:'撕開傷口，持續流血。' },
  bb_gore:    { n:'血腥旋風', q:3, c:'BB', k:'around', pct:1.65, cd:5, fx:'whirl',
                st:[s('bleed',0.2,2)], d:'血肉橫飛的一輪旋風。' },
  bb_fury:    { n:'血怒', q:3, c:'BB', k:'passive', p:{ lifesteal:0.3 },
                d:'造成傷害的 30% 轉為生命；生命低於 50% 時翻倍。' },
  bb_exec:    { n:'斷頭台', q:4, c:'BB', k:'single', pct:3.2, cd:6, rng:1, exec:[0.4, 5.0], fx:'exec',
                st:[s('fear',0,2)], d:'目標生命低於 40% 時傷害暴增並使其恐懼。' },
  bb_slay:    { n:'屠戮', q:4, c:'BB', k:'around', pct:2.0, cd:6, fx:'whirl',
                st:[s('stun',0,1)], d:'一輪屠戮把周圍的敵人全部打暈。' },
  bb_deathless:{ n:'不死狂戰', q:4, c:'BB', k:'passive', p:{ killRefresh:2 },
                d:'每擊殺一個敵人立刻恢復移動和行動（每回合最多兩次）。' },

  /* ───────── 通用 ───────── */
  //  melee = 騎士／狂戰士   range = 遊俠／法師   sup = 牧師／法師   all = 全部
  u_dash:     { n:'疾行', q:0, u:'all', k:'refreshSelf', cd:4, fx:'buff',
                d:'立刻恢復本回合的移動。' },
  u_kit:      { n:'急救包', q:0, u:'all', k:'heal', pct:0.8, cd:4, rng:1, fx:'heal',
                d:'替自己或身邊的友軍包紮。' },
  u_feint:    { n:'佯攻', q:0, u:'melee', k:'single', pct:1.1, cd:3, rng:1, spendTurn:1, fx:'bash',
                d:'虛晃一招，消耗掉目標本回合的轉頭機會，方便繞背。' },
  u_retreat:  { n:'撤退', q:1, u:'all', k:'retreat', len:3, cd:4, fx:'buff',
                d:'往遠離敵人的方向撤三格，不會觸發反擊。' },
  u_aim:      { n:'集中射擊', q:1, u:'range', k:'single', rng:0, pct:1.8, cd:3, rooted:1, fx:'arrow',
                d:'瞄準射擊，但本回合不能再移動。' },
  u_vet:      { n:'老兵', q:1, u:'all', k:'passive', p:{ hpPct:0.12 },
                d:'最大生命 +12%。' },
  u_order:    { n:'戰術指揮', q:2, u:'sup', k:'refreshAlly', cd:5, rng:3, fx:'shout',
                d:'讓一個友軍立刻恢復本回合的移動和行動。' },
  u_break:    { n:'破陣', q:2, u:'melee', k:'single', pct:2.1, cd:4, rng:1, ignoreTer:1, fx:'slash',
                d:'無視目標所有地形加成的一擊。' },
  u_tough:    { n:'堅毅', q:2, u:'all', k:'passive', p:{ dotRes:0.5 },
                d:'受到的持續傷害減半。' },
  u_curse:    { n:'詛咒之觸', q:3, u:'range,sup', k:'single', rng:0, pct:2.5, cd:4, fx:'arcane',
                st:[s('curse',0.3,3)], d:'讓目標受到的所有傷害都增加。' },
  u_daunt:    { n:'破膽一擊', q:3, u:'melee', k:'single', pct:2.5, cd:4, rng:1, fx:'slash',
                st:[s('weaken',0.4,2)], d:'打掉對方的氣勢。' },
  u_riposte:  { n:'反擊大師', q:3, u:'melee', k:'passive', p:{ counterPct:0.5, backCounter:1 },
                d:'反擊傷害 +50%，且被背擊時仍可反擊。' },
  u_cage:     { n:'力場牢籠', q:4, u:'range,sup', k:'aoe', pct:0, r:1, cd:6, rng:3, fx:'cage',
                st:[s('root',0,2)], d:'指定一個敵人，把它和周圍的敵人一起定住兩回合。' },
  u_solo:     { n:'一騎當千', q:4, u:'melee', k:'buffSelf', cd:7, fx:'buff',
                self:[s('atk',0.4,1)], killRefresh:9,
                d:'本回合每擊殺一個敵人就恢復行動。' },
  u_will:     { n:'不屈意志', q:4, u:'all', k:'passive', p:{ ctrlImmune:1 },
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
