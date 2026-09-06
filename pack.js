// 把 .gltf + .bin 打包成單一 .glb，並把地城包的 glb 複製過來改個好記的名字
const fs = require('fs'), p = require('path');

function writeGLB(json, bin) {
  const js = Buffer.from(JSON.stringify(json), 'utf8');
  const jsPad = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsPad.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsPad.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([head, jh, jsPad, bh, binPad]);
}

const HEX = {
  tree_a: 'tree_single_A', tree_b: 'tree_single_B',
  trees_a: 'trees_A_medium', trees_b: 'trees_B_medium',
  rock_a: 'rock_single_A', rock_b: 'rock_single_B', rock_c: 'rock_single_C',
  waterplant: 'waterplant_A', waterlily: 'waterlily_A',
  castle_blue: 'building_castle_blue', castle_red: 'building_castle_red'
};
const ADV_W = { staff: 'staff' };
 const SKE_W = {
  ske_blade: 'Skeleton_Blade', ske_axe: 'Skeleton_Axe',
  ske_bow: 'Skeleton_Crossbow', ske_staff: 'Skeleton_Staff', ske_shield: 'Skeleton_Shield_Small_A'
};
const DUN = {
  chest: 'chest.glb', chest_gold: 'chest_gold.glb', coins: 'coin_stack_medium.gltf.glb',
  torch: 'torch_lit.gltf.glb', pillar: 'pillar.gltf.glb',
  banner_blue: 'banner_blue.gltf.glb', banner_red: 'banner_red.gltf.glb'
};

const dst = p.join(__dirname, 'raw2');
fs.mkdirSync(dst, { recursive: true });
let n = 0, bytes = 0;

for (const [group, table] of [['hex', HEX], ['ske', SKE_W], ['adv', ADV_W]]) {
  for (const key in table) {
    const base = p.join(__dirname, 'kk', group, table[key]);
    const j = JSON.parse(fs.readFileSync(base + '.gltf', 'utf8'));
    const bin = fs.readFileSync(base + '.bin');
    delete j.buffers[0].uri;
    j.buffers[0].byteLength = bin.length;
    const out = writeGLB(j, bin);
    fs.writeFileSync(p.join(dst, key + '.glb'), out);
    n++; bytes += out.length;
  }
}
for (const key in DUN) {
  const b = fs.readFileSync(p.join(__dirname, 'kk/dun', DUN[key]));
  fs.writeFileSync(p.join(dst, key + '.glb'), b);
  n++; bytes += b.length;
}
// 共用貼圖（打包後的 gltf 仍然指向外部 png）
fs.mkdirSync(p.join(dst, 'tex'), { recursive: true });
for (const [src, name] of [['hex/hexagons_medieval.png', 'hexagons_medieval.png'],
                           ['ske/skeleton_texture.png', 'skeleton_texture.png'],
                           ['adv/mage_texture.png', 'mage_texture.png']]) {
  fs.copyFileSync(p.join(__dirname, 'kk', src), p.join(dst, 'tex', name));
}
console.log('打包', n, '個模型，共', (bytes / 1024).toFixed(0), 'KB');
const all = fs.readdirSync(dst).filter(f => f.endsWith('.glb'));
console.log('raw2 共', all.length, '個 glb，',
  (all.reduce((s, f) => s + fs.statSync(p.join(dst, f)).size, 0) / 1024 / 1024).toFixed(2), 'MB');
