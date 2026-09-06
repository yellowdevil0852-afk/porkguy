// 從 KayKit 官方 GitHub 抓需要的 CC0 素材
const fs = require('fs'), p = require('path'), https = require('https');

const ORG = 'KayKit-Game-Assets';
const REPOS = {
  adv: 'KayKit-Character-Pack-Adventures-1.0',
  ske: 'KayKit-Character-Pack-Skeletons-1.0',
  dun: 'KayKit-Dungeon-Remastered-1.0',
  hex: 'KayKit-Medieval-Hexagon-Pack-1.0'
};

// 每個 repo 要哪些檔案（用檔名比對，不管路徑）
const WANT = {
  adv: [/Characters\/gltf\/(Knight|Mage|Rogue|Rogue_Hooded|Barbarian)\.glb$/i,
        /Characters\/gltf\/\w+_texture\.png$/i,
        /Assets\/gltf\/(sword_1handed|axe_1handed|crossbow_1handed|dagger|staff|shield_round|quiver)\.(gltf|bin)$/i],
  ske: [/Characters\/gltf\/Skeleton_(Mage|Minion|Rogue|Warrior)\.glb$/i,
        /Characters\/gltf\/skeleton_texture\.png$/i],
  dun: [/\/(chest|chest_gold|coin_stack_medium\.gltf|torch_lit\.gltf|pillar\.gltf|banner_red\.gltf|banner_blue\.gltf)\.glb$/i,
        /\/dungeon_texture\.png$/i],
  hex: [/decoration\/nature\/(tree_single_A|tree_single_B|trees_A_medium|trees_B_medium|rock_single_A|rock_single_B|rock_single_C|waterplant_A|waterlily_A)\.(gltf|bin)$/i,
        /buildings\/(blue|red)\/building_castle_(blue|red)\.(gltf|bin)$/i,
        /\/hexagons_medieval\.png$/i]
};

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, r => {
      if (r.statusCode === 302 || r.statusCode === 301) return get(r.headers.location).then(res, rej);
      if (r.statusCode !== 200) return rej(new Error(r.statusCode + ' ' + url));
      const c = [];
      r.on('data', d => c.push(d));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  });
}

(async () => {
  const out = p.join(__dirname, 'kk');
  fs.mkdirSync(out, { recursive: true });
  let total = 0;
  for (const key in REPOS) {
    const repo = REPOS[key];
    const tree = JSON.parse(await get(`https://api.github.com/repos/${ORG}/${repo}/git/trees/main?recursive=1`));
    const paths = tree.tree.map(t => t.path).filter(x => WANT[key].some(re => re.test(x)));
    fs.mkdirSync(p.join(out, key), { recursive: true });
    for (const path of paths) {
      const buf = await get(`https://raw.githubusercontent.com/${ORG}/${repo}/main/${encodeURI(path)}`);
      const name = path.replace(/.*\//, '');
      fs.writeFileSync(p.join(out, key, name), buf);
      total += buf.length;
      console.log(key.padEnd(4), name.padEnd(34), (buf.length / 1024).toFixed(0) + ' KB');
    }
    // 授權書
    try {
      fs.writeFileSync(p.join(out, key, 'LICENSE.txt'),
        await get(`https://raw.githubusercontent.com/${ORG}/${repo}/main/LICENSE.txt`));
    } catch (e) {}
  }
  console.log('\n合計', (total / 1024 / 1024).toFixed(2), 'MB');
})();
