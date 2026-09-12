/* ══════════════ 線上對戰的 WebSocket 中繼伺服器 ══════════════
   部署在使用者自己的 Oracle Cloud 免費 VM 上，跟遊戲本體完全分開、
   不會被 build.js 打包進 porkguy.html。純粹轉發：不解析、不驗證遊戲
   內容，只認房號（room）跟角色（role: host/guest），把同一個房間裡
   兩邊的訊息互相丟給對方。

   啟動：node relay-server.js（預設埠 8080，可用環境變數 PORT 改）
   需要先裝套件：npm install ws

   協定（跟 src/net.js 的 wsTryConnect() 對應）：
   - 連線網址帶兩個 query 參數：?room=房號&role=host 或 role=guest
   - 伺服器收到連線後立刻回一個 {t:'_ready'}，代表「房號已登記成功」
     ——這不代表對方也連上了，純粹是「這台中繼伺服器我連得到」的確認。
   - 同一個房間的 host/guest 兩個角色都連上時，雙方各收到一個
     {t:'_peer_join'}，遊戲端把這個當成「連線建立」的訊號。
   - 其中一邊斷線，另一邊收到 {t:'_peer_left'}。
   - 除了上面這三種控制訊息（`t` 開頭底線），其他訊息原封不動轉給房間
     裡的另一邊，遊戲的訊息格式（{t:'act',...} 之類）伺服器完全不管。
   - 同一個角色重新連線（例如斷線重連）會直接取代舊的連線，不會卡住。 */

const { WebSocketServer, WebSocket } = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// rooms: Map<房號, { host: ws|null, guest: ws|null }>
const rooms = new Map();

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}
function otherRole(role) { return role === 'host' ? 'guest' : 'host'; }

wss.on('connection', (ws, req) => {
  let url;
  try { url = new URL(req.url, 'http://relay'); } catch (e) { ws.close(4000, 'bad url'); return; }
  const code = (url.searchParams.get('room') || '').trim().toUpperCase();
  const role = url.searchParams.get('role') === 'guest' ? 'guest' : 'host';
  if (!code) { ws.close(4001, 'no room'); return; }

  let room = rooms.get(code);
  if (!room) { room = { host: null, guest: null }; rooms.set(code, room); }

  // 同一個角色再連一次（斷線重連、或重新整理頁面）：舊連線直接關掉讓新的接手，
  // 不然舊的殭屍連線會一直占著這個角色，新連線永遠配對不到。
  const old = room[role];
  if (old && old !== ws) { try { old.close(4002, 'replaced'); } catch (e) {} }
  room[role] = ws;
  ws._code = code; ws._role = role;

  send(ws, { t: '_ready' });
  const peer = room[otherRole(role)];
  if (peer && peer.readyState === WebSocket.OPEN) {
    send(peer, { t: '_peer_join' });
    send(ws, { t: '_peer_join' });
  }

  ws.on('message', raw => {
    const peer = room[otherRole(ws._role)];
    if (peer && peer.readyState === WebSocket.OPEN) peer.send(raw.toString());
  });

  ws.on('close', () => {
    if (room[role] !== ws) return;   // 已經被新連線取代掉了，這個是舊的，不用處理
    room[role] = null;
    send(room[otherRole(role)], { t: '_peer_left' });
    if (!room.host && !room.guest) rooms.delete(code);
  });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// 心跳：偵測「TCP 連線還在但對方其實已經斷網」的殭屍連線，
// 不然那種情況伺服器會一直以為房間裡還有人，卡住新的配對。
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 15000);

console.log('relay listening on port', PORT);
