// KayKit GLB 瘦身：
//  1. 九隻角色共用同一副 41 骨骼骨架 → 動畫抽成單獨一個 anims.glb，角色檔全部不帶動畫
//  2. 砍掉用不到的武器 / 配件網格
//  3. 重建 accessor / bufferView / buffer，只留還有人引用的資料
const fs = require('fs'), p = require('path');

const KEEP_ANIM = [
  'Idle', 'Walking_A',
  '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop',
  '1H_Ranged_Shoot', 'Spellcast_Shoot',
  'Death_A', 'Hit_A', 'Cheer', 'Taunt'
];

// 每隻角色要保留哪些會顯示的網格節點（身體部位一律保留）
const KEEP_MESH = {
  Knight: ['1H_Sword', '2H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'],
  Rogue: ['1H_Crossbow', 'Knife', 'Rogue_Cape'],
  Rogue_Hooded: ['1H_Crossbow', 'Knife', 'Rogue_Cape'],
  Mage: ['2H_Staff', '1H_Wand', 'Mage_Hat', 'Mage_Cape'],
  Barbarian: ['1H_Axe', '2H_Axe', 'Barbarian_Hat', 'Barbarian_Cape']
};
const BODY = /_(Arm|Body|Head|Leg|Eyes|Jaw|Skull|Hood|Cloak|Helmet|Cape|Hat)(Left|Right)?(_Hooded)?$/i;

function readGLB(file) {
  const b = fs.readFileSync(file);
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004E4942) bin = data;
    off += 8 + len;
    off += (4 - (off % 4)) % 4;
  }
  return { json, bin };
}

function writeGLB(json, bin) {
  const js = Buffer.from(JSON.stringify(json), 'utf8');
  const jsPad = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsPad.length + (binPad.length ? 8 + binPad.length : 0), 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsPad.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  if (!binPad.length) return Buffer.concat([head, jh, jsPad]);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([head, jh, jsPad, bh, binPad]);
}

// 只留還有人引用的 accessor / bufferView，重建 bin
function compact(j, bin) {
  const acc = new Set();
  (j.meshes || []).forEach(m => m.primitives.forEach(pr => {
    Object.values(pr.attributes).forEach(v => acc.add(v));
    if (pr.indices !== undefined) acc.add(pr.indices);
  }));
  (j.skins || []).forEach(s => { if (s.inverseBindMatrices !== undefined) acc.add(s.inverseBindMatrices); });
  (j.animations || []).forEach(a => a.samplers.forEach(s => { acc.add(s.input); acc.add(s.output); }));

  const accMap = {}, newAcc = [];
  j.accessors.forEach((a, i) => { if (acc.has(i)) { accMap[i] = newAcc.length; newAcc.push(a); } });

  const bvUsed = new Set();
  newAcc.forEach(a => { if (a.bufferView !== undefined) bvUsed.add(a.bufferView); });
  (j.images || []).forEach(im => { if (im.bufferView !== undefined) bvUsed.add(im.bufferView); });

  const bvMap = {}, newBV = [], chunks = [];
  let off = 0;
  j.bufferViews.forEach((bv, i) => {
    if (!bvUsed.has(i)) return;
    const start = bv.byteOffset || 0;
    const pad = (4 - (off % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad, 0)); off += pad; }
    bvMap[i] = newBV.length;
    newBV.push(Object.assign({}, bv, { byteOffset: off }));
    chunks.push(bin.slice(start, start + bv.byteLength));
    off += bv.byteLength;
  });

  newAcc.forEach(a => { if (a.bufferView !== undefined) a.bufferView = bvMap[a.bufferView]; });
  (j.images || []).forEach(im => { if (im.bufferView !== undefined) im.bufferView = bvMap[im.bufferView]; });
  (j.meshes || []).forEach(m => m.primitives.forEach(pr => {
    for (const k in pr.attributes) pr.attributes[k] = accMap[pr.attributes[k]];
    if (pr.indices !== undefined) pr.indices = accMap[pr.indices];
  }));
  (j.skins || []).forEach(s => {
    if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap[s.inverseBindMatrices];
  });
  (j.animations || []).forEach(a => a.samplers.forEach(s => {
    s.input = accMap[s.input]; s.output = accMap[s.output];
  }));

  j.accessors = newAcc;
  j.bufferViews = newBV;
  const nb = Buffer.concat(chunks);
  j.buffers = nb.length ? [{ byteLength: nb.length }] : [];
  return nb;
}

// 砍掉指定的網格節點，並重排 mesh 索引
function dropMeshes(j, keepNames) {
  for (const n of j.nodes) {
    if (n.mesh === undefined || !n.name) continue;
    if (BODY.test(n.name) || keepNames.includes(n.name)) continue;
    delete n.mesh; delete n.skin;
  }
  const used = new Set();
  j.nodes.forEach(n => { if (n.mesh !== undefined) used.add(n.mesh); });
  const map = {}, newMeshes = [];
  j.meshes.forEach((m, i) => { if (used.has(i)) { map[i] = newMeshes.length; newMeshes.push(m); } });
  j.nodes.forEach(n => { if (n.mesh !== undefined) n.mesh = map[n.mesh]; });
  j.meshes = newMeshes;
}

function pruneAnims(j, keep) {
  if (!j.animations) return;
  j.animations = j.animations.filter(a => keep.includes(a.name));
  const ik = new Set();
  j.nodes.forEach((n, i) => { if (n.name && /IK|control-/i.test(n.name)) ik.add(i); });
  for (const a of j.animations) {
    a.channels = a.channels.filter(c => !ik.has(c.target.node));
    const seen = new Map();
    const samplers = [];
    a.channels.forEach(c => {
      if (!seen.has(c.sampler)) { seen.set(c.sampler, samplers.length); samplers.push(a.samplers[c.sampler]); }
      c.sampler = seen.get(c.sampler);
    });
    a.samplers = samplers;
  }
}

// ── 主流程 ──
const dst = p.join(__dirname, 'raw2');
fs.mkdirSync(dst, { recursive: true });
const CHARS = [
  ['adv', 'Knight'], ['adv', 'Rogue'], ['adv', 'Rogue_Hooded'], ['adv', 'Mage'], ['adv', 'Barbarian'],
  ['ske', 'Skeleton_Warrior'], ['ske', 'Skeleton_Rogue'], ['ske', 'Skeleton_Mage'], ['ske', 'Skeleton_Minion']
];

let tb = 0, ta = 0;
// 動畫檔：拿 Knight，砍光網格只留骨架和動畫
{
  const { json: j, bin } = readGLB(p.join(__dirname, 'kk/adv/Knight.glb'));
  pruneAnims(j, KEEP_ANIM);
  j.nodes.forEach(n => { delete n.mesh; delete n.skin; });
  delete j.meshes; delete j.skins; delete j.materials;
  delete j.textures; delete j.images; delete j.samplers;
  const nb = compact(j, bin);
  const out = writeGLB(j, nb);
  fs.writeFileSync(p.join(dst, 'anims.glb'), out);
  ta += out.length;
  console.log('anims.glb'.padEnd(22), (out.length / 1024).toFixed(0) + ' KB',
    ' 動畫 ' + j.animations.length + ' 個:', j.animations.map(a => a.name).join(', '));
}

for (const [dir, name] of CHARS) {
  const src = p.join(__dirname, 'kk', dir, name + '.glb');
  const { json: j, bin } = readGLB(src);
  const before = fs.statSync(src).size;
  pruneAnims(j, []);                       // 角色檔完全不帶動畫
  if (KEEP_MESH[name]) dropMeshes(j, KEEP_MESH[name]);
  const nb = compact(j, bin);
  const out = writeGLB(j, nb);
  fs.writeFileSync(p.join(dst, name + '.glb'), out);
  tb += before; ta += out.length;
  console.log(name.padEnd(22), (before / 1024 / 1024).toFixed(2) + ' MB →',
    (out.length / 1024).toFixed(0) + ' KB', ' 網格', j.meshes.length);
}
console.log('\n角色合計', (tb / 1024 / 1024).toFixed(1), 'MB →', (ta / 1024 / 1024).toFixed(2), 'MB');
