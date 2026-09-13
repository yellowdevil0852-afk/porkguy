/* ══════════════ 線上對戰的 WebSocket 中繼伺服器 ══════════════
   部署在使用者自己的 Oracle Cloud 免費 VM 上，跟遊戲本體完全分開、
   不會被 build.js 打包進 porkguy.html。純粹轉發：不解析、不驗證遊戲
   內容，只認房號（room）跟角色（role: host/guest），把同一個房間裡
   兩邊的訊息互相丟給對方。

   ── 為什麼是 HTTPS/WSS，不是純 WebSocket ──
   遊戲網頁本身是 HTTPS（GitHub Pages 強制），瀏覽器的 Mixed Content
   規則不准 HTTPS 頁面連 `ws://`（未加密），只能連 `wss://`。這個限制
   不管哪種網路都一樣擋，之前用純 `ws://` 測「同 WiFi 能連、換行動網路
   不能連」根本是誤判——同 WiFi 那次其實是退回 PeerJS 直連成功，中繼
   從頭到尾沒被用到過。

   本來想用 Let's Encrypt 拿正式憑證，第一步試 Caddy 自動申請（走
   http-01／tls-alpn-01，需要 80/443 對外連得到），但這個帳號/區域的
   80、443 從外面連不進來（Let's Encrypt 自己的驗證伺服器也連不到，
   不是本機防火牆設定的問題，原因不明）。中間退而求其次用過一版自簽
   憑證頂著（缺點是每個瀏覽器第一次用都要手動點「繼續前往」接受警告），
   後來改用**DNS-01 驗證**徹底解決：申請一個免費的 DuckDNS 網域名字
   指到這台 VM，用 `acme.sh` 的 DuckDNS 外掛拿 Let's Encrypt 憑證——
   DNS-01 完全不需要 80/443 對外連得到，繞開了 Oracle 那個原因不明的
   限制，而且是真正受信任的憑證，瀏覽器不會再跳任何警告。

   部署方式（DNS-01，推薦，需要一個免費 DuckDNS 網域）：
     1. 去 https://duckdns.org 登入、申請一個子網域指向這台 VM 的 IP，
        複製它給的 token。
     2. curl https://get.acme.sh | sh && source ~/.bashrc
     3. export DuckDNS_Token="你的token"（只在這次 SSH session 用，
        不要寫進任何檔案，用完這個 session 結束就自動消失）
     4. ~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
     5. ~/.acme.sh/acme.sh --issue --dns dns_duckdns -d 你的子網域.duckdns.org
     6. mkdir -p ~/certs
        ~/.acme.sh/acme.sh --install-cert -d 你的子網域.duckdns.org \
          --cert-file ~/certs/cert.pem \
          --key-file ~/certs/key.pem \
          --fullchain-file ~/certs/fullchain.pem \
          --reloadcmd "pm2 restart relay"
     acme.sh 會自動裝一個 cron job 定期續期（Let's Encrypt 憑證 90 天
     到期），續期時會自動跑 --reloadcmd 重啟 relay，不用手動維護。

     npm install ws
     node relay-server.js   （預設埠 8080，可用環境變數 PORT 改；
                              憑證路徑預設 ~/certs，可用 SSL_CERT_DIR 改）

   （備案：如果沒有網域、不想弄 DuckDNS，也可以退回自簽憑證——
   `openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout ~/certs/key.pem
   -out ~/certs/cert.pem -subj "/CN=你的VM公網IP"`，缺點是每個瀏覽器第一次
   連線都要手動點過一次「繼續前往」接受警告，之後才會放行 wss:// 連線。）

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

const https = require('https');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;
const certDir = process.env.SSL_CERT_DIR || (os.homedir() + '/certs');

const server = https.createServer({
  // fullchain（葉憑證+中繼 CA）比單一 cert.pem 保險：真正的 CA 簽發憑證
  // 需要瀏覽器能組出完整信任鏈，少數瀏覽器不會自己去抓中繼憑證。
  // 用 openssl 自簽的話沒有 fullchain.pem，改回讀 cert.pem 即可。
  cert: fs.readFileSync(certDir + '/fullchain.pem'),
  key: fs.readFileSync(certDir + '/key.pem')
}, (req, res) => { res.writeHead(200); res.end('porkguy relay ok'); });

const wss = new WebSocketServer({ server });

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
  try { url = new URL(req.url, 'https://relay'); } catch (e) { ws.close(4000, 'bad url'); return; }
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

server.listen(PORT, () => console.log('relay (wss) listening on port', PORT));
