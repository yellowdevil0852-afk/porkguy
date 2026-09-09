/* ══════════════ 地圖生成 + 3D 場景 ══════════════ */

// ── 亂數（同一個種子產生同一張地圖，連線時只要傳種子）──
let rng = mulberry32(1);
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const ri = n => Math.floor(rng() * n);
const pick = a => a[ri(a.length)];

// ── 地圖狀態 ──
let MAP = [];                  // MAP[y][x] = 地形代號
let CHESTS = [], TRAPS = [], CAMPS = [];
let SEED = 1;
let CAMP = [[3, 23], [23, 3]];

// 換地圖大小：王座在正中央，兩個營地在對角，其餘都是按比例算出來的
function setSize(n) {
  W = H = n;
  THRONE = [n >> 1, n >> 1];
  const m = Math.max(2, Math.round(n * 0.11));
  CAMP = [[m, n - 1 - m], [n - 1 - m, m]];
}

const tileAt = (x, y) => MAP[y][x];
const ter = (x, y) => TER[MAP[y][x]];
const inBoard = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const wx = x => (x - (W - 1) / 2) * TILE;
const wz = y => (y - (H - 1) / 2) * TILE;
const key = (x, y) => y * W + x;

// 平滑雜訊：粗網格 + 雙線性內插
function noise(cells) {
  const g = [];
  for (let j = 0; j <= cells; j++) { g[j] = []; for (let i = 0; i <= cells; i++) g[j][i] = rng(); }
  return (x, y) => {
    const fx = x / (W - 1) * cells, fy = y / (H - 1) * cells;
    const i = Math.min(cells - 1, Math.floor(fx)), j = Math.min(cells - 1, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (g[j][i] * (1 - sx) + g[j][i + 1] * sx) * (1 - sy) +
           (g[j + 1][i] * (1 - sx) + g[j + 1][i + 1] * sx) * sy;
  };
}

function genMap(seed) {
  SEED = seed;
  rng = mulberry32(seed);
  // 雜訊格數跟著地圖放大，不然大地圖上地形會變成幾塊巨大色塊
  const k = Math.max(1, W / 27);
  const elev = noise(Math.round(5 * k)), wet = noise(Math.round(4 * k)), rough = noise(Math.round(7 * k));

  MAP = [];
  for (let y = 0; y < H; y++) {
    MAP[y] = [];
    for (let x = 0; x < W; x++) {
      const e = elev(x, y), w = wet(x, y), r = rough(x, y);
      let t = 'P';
      if (e > 0.72 && r > 0.45) t = 'M';
      else if (w > 0.70 && e < 0.42) t = 'W';
      else if (w > 0.60 && e < 0.52) t = 'S';
      else if (w > 0.48 && r > 0.40) t = 'F';
      MAP[y][x] = t;
    }
  }
  // 180 度旋轉對稱：後半張直接抄前半張
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y * W + x > (H * W - 1) / 2) MAP[y][x] = MAP[H - 1 - y][W - 1 - x];
  }

  // 王座周邊淨空成平原
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = THRONE[0] + dx, y = THRONE[1] + dy;
    if (inBoard(x, y) && Math.abs(dx) + Math.abs(dy) <= 3) MAP[y][x] = 'P';
  }
  MAP[THRONE[1]][THRONE[0]] = 'T';

  // 營地
  for (const [cx, cy] of CAMP) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (inBoard(x, y)) MAP[y][x] = 'P';
    }
    MAP[cy][cx] = 'C';
  }

  // 道路：兩個營地各自連到王座，再互相連通
  road(CAMP[0], THRONE); road(CAMP[1], THRONE);
  const spur = Math.round(W * 0.33);
  road(CAMP[0], [CAMP[0][0] + spur, CAMP[0][1] - Math.round(spur / 3)]);
  road(CAMP[1], [CAMP[1][0] - spur, CAMP[1][1] + Math.round(spur / 3)]);

  placeRocks();
  placeCamps();
  placeChests();
  TRAPS = [];
}

// 主地圖的石頭：純障礙物，不可通行、擋遠程/魔法視線、沒有任何加成，
// 跟競技場那套完全同一種地形（見 data.js 的 TER.K），只是這裡地圖比較大、
// 用主地圖自己的 rng（不是戰鬥用的 grng）灑幾叢，兩邊算出來的地圖才會一致。
// 只灑在還是平原的格子上，避開營地/王座/道路/水——freeNear() 本來就會跳過
// cost>90 的地形，所以怪物、英雄、寶箱都不會生成到石頭上，這裡不用額外處理。
function placeRocks() {
  const near = (x, y, cx, cy, r) => Math.abs(x - cx) + Math.abs(y - cy) <= r;
  const nearSpawn = (x, y) => CAMP.some(([cx, cy]) => near(x, y, cx, cy, 3));
  const clusters = Math.max(3, Math.round(W * H / 120));
  for (let i = 0; i < clusters; i++) {
    const x = 2 + Math.floor(rng() * (W - 4)), y = 2 + Math.floor(rng() * (H - 4));
    if (nearSpawn(x, y) || MAP[y][x] !== 'P') continue;
    const mx = W - 1 - x, my = H - 1 - y;
    MAP[y][x] = 'K';
    if (inBoard(mx, my) && MAP[my][mx] === 'P') MAP[my][mx] = 'K';
    // 偶爾黏一格，看起來像一叢石頭而不是孤零零一格（跟競技場那套一樣的手法）
    if (rng() < 0.4) {
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)];
      const nx = x + dx, ny = y + dy;
      if (inBoard(nx, ny) && !nearSpawn(nx, ny) && MAP[ny][nx] === 'P') {
        MAP[ny][nx] = 'K';
        const nmx = W - 1 - nx, nmy = H - 1 - ny;
        if (inBoard(nmx, nmy) && MAP[nmy][nmx] === 'P') MAP[nmy][nmx] = 'K';
      }
    }
  }
}

// 用貪心 + 抖動畫一條路，會避開水
function road(from, to) {
  let [x, y] = from;
  let guard = 0;
  while ((x !== to[0] || y !== to[1]) && guard++ < W * 8) {
    const dx = Math.sign(to[0] - x), dy = Math.sign(to[1] - y);
    if (dx && dy) { if (rng() < 0.5) x += dx; else y += dy; }
    else if (dx) x += dx; else if (dy) y += dy;
    if (!inBoard(x, y)) break;
    if (MAP[y][x] !== 'T' && MAP[y][x] !== 'C') MAP[y][x] = 'R';
    // 對稱的另一半也鋪一條
    const mx = W - 1 - x, my = H - 1 - y;
    if (inBoard(mx, my) && MAP[my][mx] !== 'T' && MAP[my][mx] !== 'C') MAP[my][mx] = 'R';
  }
}

// 怪物營地：改成「網格抖動」撒點——把地圖切成一格一格的方塊，每格裡挑一個
// 隨機位置當候選點，等級（tier）不是看「你在哪一圈」，是看候選點離王座的
// 距離落在哪個級距。這樣完全沒有固定半徑或固定角度，視覺上不會有任何
// 圓弧或放射狀的規律，同時還是「越靠近王座等級越高」。
// 只在半張地圖跑，另一半直接鏡射，跟 road()/placeRocks() 同一套做法。
const CAMP_TIER_FRAC = [0.85, 0.5, 0.25, 0];  // 距離比例門檻，由外而內對到 tier1～tier4
// 格子邊長依地圖大小查表，數字是實測調出來的——不是單純跟 W 成正比，
// 小地圖（16）如果套跟大地圖一樣的比例，格子會小到密度爆炸。
const CAMP_CELL_BY_SIZE = { 16: 5, 32: 8, 64: 8, 96: 8, 128: 9 };
function placeCamps() {
  CAMPS = [];
  const cell = CAMP_CELL_BY_SIZE[W] || Math.max(2, Math.round(W / 14));
  const half = Math.ceil(W / 2);
  const halfDiag = Math.sqrt(2) * (W / 2);    // 中心到角落的距離，拿來把距離換算成 0~1 的比例
  for (let gy = 0; gy < H; gy += cell) {
    for (let gx = 0; gx < half; gx += cell) {
      const x = Math.min(W - 1, gx + Math.floor(rng() * cell));
      const y = Math.min(H - 1, gy + Math.floor(rng() * cell));
      if (!inBoard(x, y)) continue;
      const t = MAP[y][x];
      if (t === 'W' || t === 'T' || t === 'C' || t === 'K') continue;
      if (CAMP.some(p => Math.abs(p[0] - x) + Math.abs(p[1] - y) < 4)) continue;
      if (CAMPS.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) < 3)) continue;

      const dx0 = x - THRONE[0], dy0 = y - THRONE[1];
      const frac = Math.sqrt(dx0 * dx0 + dy0 * dy0) / halfDiag;
      let tier = 1;
      for (let i = 0; i < CAMP_TIER_FRAC.length; i++) if (frac >= CAMP_TIER_FRAC[i]) { tier = i + 1; break; }
      const d = Math.abs(x - THRONE[0]) + Math.abs(y - THRONE[1]);
      CAMPS.push({ id: CAMPS.length, x, y, tier, frac, revive: d > NO_REVIVE_R });

      // 鏡射到地圖另一半，跟正排一樣要過同一輪檢查（正中央附近可能跟自己重疊，跳過）
      // 鏡射點離王座的距離跟原點完全一樣（王座就是旋轉中心），frac 直接沿用不用重算
      const mx = W - 1 - x, my = H - 1 - y;
      if (mx === x && my === y) continue;
      const mt = MAP[my] ? MAP[my][mx] : undefined;
      if (mt === undefined || mt === 'W' || mt === 'T' || mt === 'C' || mt === 'K') continue;
      if (CAMP.some(p => Math.abs(p[0] - mx) + Math.abs(p[1] - my) < 4)) continue;
      if (CAMPS.some(p => Math.abs(p.x - mx) + Math.abs(p.y - my) < 3)) continue;
      const md = Math.abs(mx - THRONE[0]) + Math.abs(my - THRONE[1]);
      CAMPS.push({ id: CAMPS.length, x: mx, y: my, tier, frac, revive: md > NO_REVIVE_R });
    }
  }
}

function placeChests() {
  CHESTS = [];
  const add = (x, y, gold) => {
    if (!inBoard(x, y)) return;
    if (MAP[y][x] === 'W' || MAP[y][x] === 'T' || MAP[y][x] === 'C' || MAP[y][x] === 'K') return;
    if (CHESTS.some(c => c.x === x && c.y === y)) return;
    CHESTS.push({ x, y, gold, opened: false });
  };
  const pairs = Math.max(4, Math.round(W * W / 95));
  for (let i = 0; i < pairs; i++) {
    const x = 2 + Math.floor(rng() * (W - 4)), y = 2 + Math.floor(rng() * (H - 4));
    add(x, y, false); add(W - 1 - x, H - 1 - y, false);       // 鏡像成對，才公平
  }
  // 散在地圖上的金寶箱，一樣鏡像成對，值得為它繞路
  const gp = Math.max(1, Math.round(W * W / 340));
  for (let i = 0; i < gp; i++) {
    const x = 3 + Math.floor(rng() * (W - 6)), y = 3 + Math.floor(rng() * (H - 6));
    if (Math.abs(x - THRONE[0]) + Math.abs(y - THRONE[1]) < 4) continue;   // 別跟中央那圈擠在一起
    add(x, y, true); add(W - 1 - x, H - 1 - y, true);
  }
  // 王座旁邊四個金寶箱
  const d = Math.max(2, Math.round(W * 0.07));
  add(THRONE[0] - d, THRONE[1], true); add(THRONE[0] + d, THRONE[1], true);
  add(THRONE[0], THRONE[1] - d, true); add(THRONE[0], THRONE[1] + d, true);
}

/* ══════════════ 3D ══════════════ */

let scene, camera, renderer, clock, raycaster;
let groundGroup, propGroup, unitGroup, fxGroup, overlayGroup;
let sun, tilePick = [];                  // InstancedMesh -> 每個 instance 對應的格子
const MODELS = {}, CLIPS = [];
let camAz = Math.PI * 0.25, camEl = 0.85, camDist = 34;
const camTarget = new THREE.Vector3(0, 0, 0);

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e131c);
  scene.fog = new THREE.Fog(0x0e131c, 45, 95);

  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 300);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = SET.shadow;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  scene.add(new THREE.HemisphereLight(0x9fbdf0, 0x2e3448, 0.55));
  sun = new THREE.DirectionalLight(0xffeed4, 1.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 22;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 90 });
  sun.shadow.bias = -0.0016;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  groundGroup = new THREE.Group(); propGroup = new THREE.Group();
  unitGroup = new THREE.Group(); fxGroup = new THREE.Group(); overlayGroup = new THREE.Group();
  scene.add(groundGroup, propGroup, unitGroup, fxGroup, overlayGroup);

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  updCam();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function updCam() {
  camera.position.set(
    camTarget.x + camDist * Math.cos(camEl) * Math.sin(camAz),
    camDist * Math.sin(camEl),
    camTarget.z + camDist * Math.cos(camEl) * Math.cos(camAz)
  );
  camera.lookAt(camTarget);
  // 陰影跟著鏡頭焦點跑，否則大地圖上解析度不夠
  sun.position.set(camTarget.x + 16, 34, camTarget.z + 20);
  sun.target.position.copy(camTarget);
  sun.target.updateMatrixWorld();
}

// 從模型取出所有網格（含各自的區域矩陣），用來做 InstancedMesh
function partsOf(name) {
  const root = MODELS[name].scene;
  root.updateMatrixWorld(true);
  const out = [];
  root.traverse(c => {
    if (c.isMesh) {
      const m = c.material.clone();
      m.metalness = 0; m.roughness = 0.92;
      out.push({ g: c.geometry, m, mx: c.matrixWorld.clone() });
    }
  });
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
      _v = new THREE.Vector3(), _s = new THREE.Vector3();
function trs(x, y, z, ry, sc) {
  _v.set(x, y, z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); _s.setScalar(sc);
  return _m.compose(_v, _q, _s).clone();
}

function addInstances(name, list, group) {
  if (!list.length) return;
  for (const part of partsOf(name)) {
    const im = new THREE.InstancedMesh(part.g, part.m, list.length);
    im.castShadow = true; im.receiveShadow = true;
    list.forEach((mx, i) => im.setMatrixAt(i, mx.clone().multiply(part.mx)));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    (group || propGroup).add(im);
  }
}

function buildWorld() {
  [groundGroup, propGroup].forEach(g => {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry && c.userData.own) c.geometry.dispose();
    }
  });
  tilePick = [];

  // ── 地格（每種地形一個 InstancedMesh）──
  for (const t of ORDER) {
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP[y][x] === t) cells.push([x, y]);
    if (!cells.length) continue;
    const info = TER[t], th = info.h + 1.4;
    const geo = new THREE.BoxGeometry(TILE * 0.985, th, TILE * 0.985);
    geo.translate(0, -th / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ color: info.col });
    const im = new THREE.InstancedMesh(geo, mat, cells.length);
    im.receiveShadow = true;
    im.userData.own = true;
    cells.forEach(([x, y], i) => im.setMatrixAt(i, trs(wx(x), info.h, wz(y), 0, 1)));
    im.instanceMatrix.needsUpdate = true;
    im.userData.cells = cells;
    groundGroup.add(im);
    tilePick.push(im);
  }

  // ── 底座 ──
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W * TILE + 2.4, 1.2, H * TILE + 2.4),
    new THREE.MeshLambertMaterial({ color: 0x161d29 })
  );
  base.position.y = -2.0;
  base.userData.own = true;
  groundGroup.add(base);

  // ── 地形裝飾 ──
  // 各模型的原始尺寸差很多（樹約 0.6 寬、石頭只有 0.3），倍率是量過的
  const treeA = [], treeB = [], rocks = [], smallRocks = [], plants = [], lilies = [], peaks = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = MAP[y][x], h = TER[t].h;
    const jx = (rng() - 0.5) * 0.9, jz = (rng() - 0.5) * 0.9, ry = rng() * 6.28;
    if (t === 'F') {
      (rng() < 0.5 ? treeA : treeB).push(trs(wx(x) + jx, h, wz(y) + jz, ry, 1.7 + rng() * 0.6));
      if (rng() < 0.55)
        (rng() < 0.5 ? treeA : treeB).push(trs(wx(x) - jx, h, wz(y) - jz, rng() * 6.28, 1.2 + rng() * 0.4));
    } else if (t === 'M') {
      // 山地跟石頭障礙（K）之前共用同一顆 rock_c，長得一模一樣分不出來。
      // 改用 rock_a（之前完全沒用到的第三種素材）疊一顆很大的主峰，配一兩棵樹，
      // 「一大顆＋有樹」跟 K 那種「矮胖一叢好幾顆、光禿禿」的輪廓差很多，一眼就分得出。
      peaks.push(trs(wx(x), h - 0.15, wz(y), ry, 7.5 + rng() * 2.2));
      if (rng() < 0.5) (rng() < 0.5 ? treeA : treeB).push(trs(wx(x) + jx, h, wz(y) + jz, rng() * 6.28, 1.0 + rng() * 0.3));
    } else if (t === 'K') {
      // 石頭障礙：故意疊高疊密一點，一眼就看得出這格不能走、也擋視線
      rocks.push(trs(wx(x), h - 0.1, wz(y), ry, 6.4 + rng() * 2.0));
      rocks.push(trs(wx(x) + jx * 0.5, h - 0.1, wz(y) + jz * 0.5, rng() * 6.28, 4.2 + rng() * 1.4));
      smallRocks.push(trs(wx(x) - jx, h, wz(y) - jz, rng() * 6.28, 3.4));
    } else if (t === 'W') {
      if (rng() < 0.3) lilies.push(trs(wx(x) + jx, h + 0.02, wz(y) + jz, ry, 4 + rng() * 2));
    } else if (t === 'S') {
      if (rng() < 0.7) plants.push(trs(wx(x) + jx, h, wz(y) + jz, ry, 3.5 + rng()));
    } else if (t === 'P' && rng() < 0.06) {
      smallRocks.push(trs(wx(x) + jx, h, wz(y) + jz, ry, 2.2));
    }
  }
  addInstances('tree_a', treeA);
  addInstances('tree_b', treeB);
  addInstances('rock_a', peaks);
  addInstances('rock_c', rocks);
  addInstances('rock_b', smallRocks);
  addInstances('waterplant', plants);
  addInstances('waterlily', lilies);

  // ── 王座、營地、寶箱 ──
  const th = TER.T.h;
  addInstances('pillar', [
    trs(wx(THRONE[0]) - TILE, th, wz(THRONE[1]) - TILE, 0, 0.5),
    trs(wx(THRONE[0]) + TILE, th, wz(THRONE[1]) - TILE, 0, 0.5),
    trs(wx(THRONE[0]) - TILE, th, wz(THRONE[1]) + TILE, 0, 0.5),
    trs(wx(THRONE[0]) + TILE, th, wz(THRONE[1]) + TILE, 0, 0.5)
  ]);
  addInstances('torch', [
    trs(wx(THRONE[0]) - TILE, th + 1.9, wz(THRONE[1]) - TILE, 0, 0.9),
    trs(wx(THRONE[0]) + TILE, th + 1.9, wz(THRONE[1]) - TILE, 0, 0.9),
    trs(wx(THRONE[0]) - TILE, th + 1.9, wz(THRONE[1]) + TILE, 0, 0.9),
    trs(wx(THRONE[0]) + TILE, th + 1.9, wz(THRONE[1]) + TILE, 0, 0.9)
  ]);
  // 競技場的 CAMP 座標其實是英雄的出生點，不是真的營地——蓋一座城堡在
  // 那格上會直接把剛傳送過去的單位蓋住，所以競技場裡不放城堡跟旗子
  if (!G.arena) {
    addInstances('castle_blue', [trs(wx(CAMP[0][0]), TER.C.h, wz(CAMP[0][1]), Math.PI * 0.75, 1.15)]);
    addInstances('castle_red', [trs(wx(CAMP[1][0]), TER.C.h, wz(CAMP[1][1]), -Math.PI * 0.25, 1.15)]);
    addInstances('banner_blue', [trs(wx(CAMP[0][0]) - 2.4, TER.C.h, wz(CAMP[0][1]) + 1.6, 0, 0.55)]);
    addInstances('banner_red', [trs(wx(CAMP[1][0]) + 2.4, TER.C.h, wz(CAMP[1][1]) - 1.6, Math.PI, 0.55)]);
  }

  refreshChests();
}

let chestGroup = null;
function refreshChests() {
  if (chestGroup) propGroup.remove(chestGroup);
  chestGroup = new THREE.Group();
  propGroup.add(chestGroup);
  const norm = [], gold = [];
  for (const c of CHESTS) {
    if (c.opened) continue;
    (c.gold ? gold : norm).push(trs(wx(c.x), ter(c.x, c.y).h, wz(c.y), (c.x + c.y) * 0.7, 0.62));
  }
  addInstances('chest', norm, chestGroup);
  addInstances('chest_gold', gold, chestGroup);

  // 金寶箱遠遠就要看得出來：一道金光柱 + 一圈會轉的光環
  goldMarks = [];
  for (const c of CHESTS) {
    if (c.opened || !c.gold) continue;
    const h = ter(c.x, c.y).h;
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(TILE * 0.18, TILE * 0.38, 4.6, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.26,
        side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
    );
    col.position.set(wx(c.x), h + 2.4, wz(c.y));
    chestGroup.add(col);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(TILE * 0.06, TILE * 0.15, 4.6, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })
    );
    core.position.copy(col.position);
    chestGroup.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(TILE * 0.45, 0.075, 6, 22),
      new THREE.MeshBasicMaterial({ color: 0xffe58a, transparent: true, opacity: 0.95,
        depthWrite: false, fog: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(wx(c.x), h + 0.9, wz(c.y));
    chestGroup.add(ring);
    goldMarks.push(ring);
  }
}
let goldMarks = [];
// 光環慢慢轉、上下浮，animate() 每幀呼叫
function spinGold(t) {
  for (let i = 0; i < goldMarks.length; i++) {
    const m = goldMarks[i];
    m.rotation.z = t * 1.2 + i;
    m.position.y = m.userData.y0 !== undefined
      ? m.userData.y0 + Math.sin(t * 2 + i) * 0.18
      : (m.userData.y0 = m.position.y);
  }
}

// 等著重生的怪：地上一圈紅環，中間的倒數由 DOM 標籤顯示
let respGroup = null;
// 倒下的怪物在原本的營地重生，倒下的英雄回自家營地 —— 兩種都在地上畫一圈
// 倒數，玩家才看得出「這傢伙什麼時候會回來」，不用點開名冊猜。
const RESPAWN_OFFSET = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];   // 同一營地一次倒好幾個時錯開位置
function respawnSpot(u) {
  if (u.spawnAt) return u.spawnAt;
  let cx, cy, siblings;
  if (u.side === 2) {
    const c = CAMPS[u.camp] || { x: u.home[0], y: u.home[1] };
    cx = c.x; cy = c.y;
    siblings = G.units.filter(o => o.side === 2 && o.camp === u.camp && !o.alive && o.down > 0);
  } else {
    [cx, cy] = CAMP[u.side];
    siblings = G.units.filter(o => o.side === u.side && isHero(o) && !o.alive && o.down > 0);
  }
  const i = siblings.indexOf(u);
  const off = RESPAWN_OFFSET[i % RESPAWN_OFFSET.length];
  return (u.spawnAt = [cx + off[0], cy + off[1]]);
}
function refreshRespawn() {
  if (respGroup) fxGroup.remove(respGroup);
  respGroup = new THREE.Group();
  fxGroup.add(respGroup);
  for (const u of G.units) {
    if (u.alive || !u.down || u.paused) continue;   // 凍結中的（例如競技場開打時留在主戰場的）不畫
    const spot = respawnSpot(u);
    if (!inBoard(spot[0], spot[1])) continue;
    const m = new THREE.Mesh(
      new THREE.RingGeometry(TILE * 0.30, TILE * 0.44, 26),
      new THREE.MeshBasicMaterial({ color: u.side === 2 ? 0xff4433 : SIDE_COL[u.side], transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(spot[0]), ter(spot[0], spot[1]).h + 0.06, wz(spot[1]));
    m.userData.uid = u.id;
    respGroup.add(m);
  }
  refreshRespawnTags();
}

let trapGroup = null;
function refreshTraps() {
  if (trapGroup) fxGroup.remove(trapGroup);
  trapGroup = new THREE.Group();
  fxGroup.add(trapGroup);
  for (const t of TRAPS) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(TILE * 0.3, 0.06, 6, 14),
      new THREE.MeshBasicMaterial({ color: SIDE_COL[t.side], transparent: true, opacity: 0.75 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(t.x), ter(t.x, t.y).h + 0.06, wz(t.y));
    trapGroup.add(m);
  }
}

// 隕石之類「下回合才落下」的技能，先在地上留一圈紅色警示
let pendGroup = null;
function refreshPending() {
  if (pendGroup) fxGroup.remove(pendGroup);
  pendGroup = new THREE.Group();
  fxGroup.add(pendGroup);
  for (const p of PENDING) {
    for (let dx = -p.r; dx <= p.r; dx++) for (let dy = -p.r; dy <= p.r; dy++) {
      const x = p.x + dx, y = p.y + dy;
      if (!inBoard(x, y)) continue;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE * 0.9, TILE * 0.9),
        new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.3,
          depthWrite: false, fog: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(wx(x), ter(x, y).h + 0.05, wz(y));
      pendGroup.add(m);
    }
  }
}

// 競技場的一次性增益地塊：金色是力量增幅、紫色是蓄力，撿走就從畫面上消失
let arenaBuffGroup = null;
function refreshArenaBuffTiles() {
  if (arenaBuffGroup) fxGroup.remove(arenaBuffGroup);
  arenaBuffGroup = new THREE.Group();
  fxGroup.add(arenaBuffGroup);
  for (const key in ARENA_BUFFS) {
    const [x, y] = key.split(',').map(Number);
    const col = ARENA_BUFFS[key] === 'power' ? 0xffcf5c : 0xb07dff;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(TILE * 0.28, TILE * 0.4, 20),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false, fog: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(wx(x), ter(x, y).h + 0.07, wz(y));
    arenaBuffGroup.add(ring);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 0.55, TILE * 0.55),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28,
        depthWrite: false, fog: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(wx(x), ter(x, y).h + 0.04, wz(y));
    arenaBuffGroup.add(glow);
  }
}

/* ── 單位模型 ── */

/* ── 角色頭像 ──
   開場時把每個職業的模型丟進一個 128×128 的離屏 renderer 拍一張，存成 dataURL。
   一個職業拍一次就好，之後背包直接貼圖。 */
const PORTRAIT = {};
function makePortraits() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(128, 128);
  r.outputEncoding = THREE.sRGBEncoding;
  const sc = new THREE.Scene();
  sc.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xfff2dd, 1.5);
  key.position.set(2, 4, 3);
  sc.add(key);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 40);

  for (const cls of CLS_ORDER) {
    const def = CLS[cls];
    const root = THREE.SkeletonUtils.clone(MODELS[def.model].scene);
    const show = def.show ? def.show[1] : null;
    root.traverse(c => {
      if (!c.isMesh && !c.isSkinnedMesh) return;
      if (show && /^(1H_|2H_|Knife|Round_Shield|Spellbook|Throwable|Mug|Badge_|Rectangle_|Spike_)/.test(c.name)
          && !show.includes(c.name)) c.visible = false;
      c.material = c.material.clone();
      c.material.metalness = 0; c.material.roughness = 0.92;
    });
    if (def.weapon) attachWeapon(root, def.weapon, 'handslot.r');
    sc.add(root);
    // 對準頭跟胸口，稍微側一點角度比較有精神
    root.rotation.y = -0.45;
    const box = new THREE.Box3().setFromObject(root);
    const top = box.max.y;
    cam.position.set(0.9, top * 0.86, 2.5);
    cam.lookAt(0, top * 0.74, 0);
    r.render(sc, cam);
    PORTRAIT[cls] = r.domElement.toDataURL('image/png');
    sc.remove(root);
  }
  r.dispose();
}

function buildUnitView(u) {
  const def = u.side === 2 ? MON[u.kind] : CLS[u.cls];
  const root = THREE.SkeletonUtils.clone(MODELS[def.model].scene);
  // 精英變種跟首領共用「換色＋放大」，一眼就看得出這隻不太一樣
  const scale = (def.scale || 1) * 0.75 * (u.elite ? 1.15 : 1);
  root.scale.setScalar(scale);

  const tint = new THREE.Color(u.elite ? MON_ELITE.tint : (def.tint || 0xffffff));
  if (u.side === 0) tint.multiply(new THREE.Color(0xcfe0ff));
  else if (u.side === 1) tint.multiply(new THREE.Color(0xffcdbd));

  // 只顯示這個職業該拿的武器
  const show = def.show ? def.show[1] : null;
  root.traverse(c => {
    if (!c.isMesh && !c.isSkinnedMesh) return;
    c.castShadow = true;
    // 綁定姿勢的包圍球撐大一點，動畫幅度才不會被誤判為出畫面
    // （幾何體是所有複製體共用的，所以只能撐一次）
    if (c.geometry && !c.geometry.userData.inflated) {
      if (!c.geometry.boundingSphere) c.geometry.computeBoundingSphere();
      c.geometry.boundingSphere.radius *= 2.2;
      c.geometry.userData.inflated = true;
    }
    if (show && /^(1H_|2H_|Knife|Round_Shield|Spellbook|Throwable|Mug|Badge_|Rectangle_|Spike_)/.test(c.name)
        && !show.includes(c.name)) { c.visible = false; return; }
    if (def.show && /_Hat$|_Helmet$/.test(c.name) && show && !show.includes(c.name)) { c.visible = false; return; }
    c.material = c.material.clone();
    c.material.color.multiply(tint);
    c.material.metalness = 0; c.material.roughness = 0.92;
    c.userData.base = c.material.color.clone();
  });

  // 怪物的武器要另外掛上去
  if (def.weapon) attachWeapon(root, def.weapon, 'handslot.r');
  if (def.offhand) attachWeapon(root, def.offhand, 'handslot.l');

  const g = new THREE.Group();
  g.add(root);

  const ringGeo = new THREE.RingGeometry(TILE * 0.31, TILE * 0.39, 26);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: SIDE_COL[u.side], transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  g.add(ring);

  const mixer = new THREE.AnimationMixer(root);
  const acts = {};
  for (const c of CLIPS) acts[c.name] = mixer.clipAction(c);

  g.traverse(c => { c.userData.uid = u.id; });
  unitGroup.add(g);
  u.view = { g, root, ring, mixer, acts, cur: null, scale };
  placeUnit(u);
  play(u, A.idle);
}

function attachWeapon(root, name, slot) {
  // GLTFLoader 會把節點名稱裡的 . : / [ ] 去掉，所以 handslot.r 進來之後叫 handslotr
  const s = root.getObjectByName(slot) || root.getObjectByName(slot.replace(/[.:/[\]\s]/g, ''));
  if (!s || !MODELS[name]) return;
  const w = MODELS[name].scene.clone(true);
  w.traverse(c => { if (c.isMesh) { c.castShadow = true; c.material = c.material.clone(); } });
  s.add(w);
}

function play(u, name, once) {
  const v = u.view; if (!v || !v.acts[name]) return null;
  const a = v.acts[name];
  if (v.cur === a && !once) return a;
  a.reset();
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  a.clampWhenFinished = !!once;
  a.fadeIn(0.15).play();
  v.lastPlay = performance.now();
  if (v.cur && v.cur !== a) v.cur.fadeOut(0.15);
  if (!once) v.cur = a;
  return a;
}

// 尋路用的四方向
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
// 「周圍一格」是正方形，範圍類效果一律用這八格 / 切比雪夫距離
const NB8 = [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
// 單位朝向是八方向（只影響外觀和側背判定）：FACE[i] = [sin(i·45°), cos(i·45°)]
const D8 = Math.SQRT1_2;
const FACE = [[0, 1], [D8, D8], [1, 0], [D8, -D8], [0, -1], [-D8, -D8], [-1, 0], [-D8, D8]];
const dirOf = (dx, dy) => ((Math.round(Math.atan2(dx, dy) / (Math.PI / 4)) % 8) + 8) % 8;

function placeUnit(u) {
  u.view.g.position.set(wx(u.x), ter(u.x, u.y).h, wz(u.y));
  u.view.g.rotation.y = u.dir * Math.PI / 4;
}
function setDir(u, dx, dy) {
  if (!dx && !dy) return;
  u.dir = dirOf(dx, dy);
  if (u.view) u.view.g.rotation.y = u.dir * Math.PI / 4;
}
function faceTile(u, tx, ty) { setDir(u, tx - u.x, ty - u.y); }

function removeView(u) {
  if (u.view) { unitGroup.remove(u.view.g); u.view = null; }
  if (u.tag) { u.tag.remove(); u.tag = null; }
}
