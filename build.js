const fs = require('fs'), p = require('path');
const R = __dirname;

// raw/ 底下所有的 glb 都嵌進去，檔名（去掉副檔名）就是 ASSETS 的 key
const glbs = fs.readdirSync(p.join(R, 'raw')).filter(f => f.endsWith('.glb')).sort();
const assets = {};
let raw = 0;
for (const f of glbs) {
  const b = fs.readFileSync(p.join(R, 'raw', f));
  raw += b.length;
  assets[f.replace(/\.glb$/, '')] = b.toString('base64');
}
// 打包後的模型仍指向外部貼圖，改成 data URI
const tex = {};
for (const f of fs.readdirSync(p.join(R, 'raw/tex'))) {
  const b = fs.readFileSync(p.join(R, 'raw/tex', f));
  raw += b.length;
  tex[f] = 'data:image/png;base64,' + b.toString('base64');
}

const SRC = ['data.js', 'settings.js', 'skills.js', 'world.js', 'vfx.js', 'status.js', 'rules.js', 'arena.js', 'shop.js', 'bagphase.js', 'inv.js', 'ui.js', 'ai.js', 'net.js', 'main.js'];
const game = '(function(){\n"use strict";\n' +
  SRC.map(f => '/* ───── ' + f + ' ───── */\n' + fs.readFileSync(p.join(R, 'src', f), 'utf8')).join('\n') +
  '\n})();';

const parts = {
  __CSS__: fs.readFileSync(p.join(R, 'src/style.css'), 'utf8'),
  __THREE__: fs.readFileSync(p.join(R, 'lib/three.min.js'), 'utf8'),
  __GLTF__: fs.readFileSync(p.join(R, 'lib/GLTFLoader.js'), 'utf8'),
  __SKEL__: fs.readFileSync(p.join(R, 'lib/SkeletonUtils.js'), 'utf8'),
  __PEER__: fs.readFileSync(p.join(R, 'lib/peerjs.min.js'), 'utf8'),
  __ASSETS__: 'const ASSETS = ' + JSON.stringify(assets) + ';\nconst TEX = ' + JSON.stringify(tex) + ';',
  __GAME__: game
};

let html = fs.readFileSync(p.join(R, 'src/index.html'), 'utf8');
for (const k in parts) {
  const tag = '/*' + k + '*/';
  if (!html.includes(tag)) throw new Error('缺少佔位符 ' + tag);
  html = html.replace(tag, () => parts[k]);
}

const out = p.join(R, 'porkguy.html');
fs.writeFileSync(out, html, 'utf8');

// GitHub Pages 進站要看 index.html，這裡放一個轉址頁指到真正的遊戲檔，
// 這樣線上網址和本機雙擊的 porkguy.html 是同一份，不用把 6.5 MB 存兩次
const REDIRECT = [
  '<!doctype html>',
  '<html lang="zh-Hant"><head><meta charset="utf-8">',
  '<title>豬肉戰士 — PORKGUY</title>',
  '<meta http-equiv="refresh" content="0; url=porkguy.html">',
  '<link rel="canonical" href="porkguy.html">',
  '<style>html,body{height:100%;margin:0;background:#0e131c;color:#e8c168;',
  'font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}</style>',
  '</head><body>載入中… 沒有自動跳轉的話請點 <a href="porkguy.html" style="color:#e8c168">這裡</a>。',
  '<' + 'script>location.replace("porkguy.html");</' + 'script>',
  '</body></html>', ''
].join('\n');
fs.writeFileSync(p.join(R, 'index.html'), REDIRECT, 'utf8');

const kb = n => (n / 1024).toFixed(0).padStart(5) + ' KB';
console.log('模型 ' + glbs.length + ' 個  ' + kb(raw) + ' → base64' + kb(parts.__ASSETS__.length));
console.log('three + loaders + peerjs' + kb(parts.__THREE__.length + parts.__GLTF__.length +
  parts.__SKEL__.length + parts.__PEER__.length));
console.log('遊戲程式            ' + kb(game.length + parts.__CSS__.length));
console.log('→ ' + out + '  ' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB');
