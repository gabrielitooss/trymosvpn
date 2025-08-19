// proxy3.js — modo transparente TCP/WS
const net = require("net");

const dhost  = process.env.DHOST || "vps1.trymos.com"; // ← tu VPS
const dport  = parseInt(process.env.DPORT || "80", 10); // ← puerto de tu VPS (WS/HTTP)
const lport  = parseInt(process.env.PORT  || "8080", 10); // ← puerto que expone Cloud Run/Render/etc.
const DEBUG  = /^1|true|yes$/i.test(process.env.DEBUG || "");

function dbg(...args) { if (DEBUG) console.log("[DBG]", ...args); }

const server = net.createServer((client) => {
  dbg("Nueva conexión desde", client.remoteAddress + ":" + client.remotePort);

  // Conexión saliente al VPS
  const upstream = net.createConnection({ host: dhost, port: dport }, () => {
    dbg("Conectado a upstream", dhost + ":" + dport);
    // Puente bidireccional
    client.pipe(upstream);
    upstream.pipe(client);
  });

  // Mantener viva la conexión
  client.setKeepAlive(true);
  upstream.setKeepAlive(true);

  // Errores
  client.on("error", (e) => dbg("Error cliente:", e.message));
  upstream.on("error", (e) => dbg("Error upstream:", e.message));

  // Cierres
  client.on("close", () => {
    dbg("Cliente cerró");
    if (!upstream.destroyed) upstream.destroy();
  });
  upstream.on("close", () => {
    dbg("Upstream cerró");
    if (!client.destroyed) client.destroy();
  });
});

server.on("error", (e) => {
  console.error("Error del servidor:", e);
  process.exit(1);
});

server.listen(lport, "0.0.0.0", () => {
  console.log(`Proxy transparente escuchando en 0.0.0.0:${lport} → ${dhost}:${dport}`);
});
