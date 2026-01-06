const express = require("express");
const fs = require("fs");
const { execSync } = require("child_process");

const app = express();
app.use(express.json());
app.use(express.static("./public"));

const WG_IFACE = "wg0";
const WG_CONF = "/etc/wireguard/wg0.conf";
const PEER_FILE = "./data/peers.json";

/* =======================
   UTILITIES
======================= */

function run(cmd) {
  return execSync(cmd, { stdio: "pipe" }).toString().trim();
}

function loadPeers() {
  if (!fs.existsSync(PEER_FILE)) return [];
  return JSON.parse(fs.readFileSync(PEER_FILE));
}

function savePeers(peers) {
  fs.writeFileSync(PEER_FILE, JSON.stringify(peers, null, 2));
}

function genKeyPair() {
  const priv = run("wg genkey");
  const pub = run(`echo ${priv} | wg pubkey`);
  return { privateKey: priv, publicKey: pub };
}

function wgSave() {
  run(`wg-quick save ${WG_IFACE}`);
}

function ipConflict(peers, ips, exclude) {
  return peers.some(p =>
    p.name !== exclude &&
    p.ips?.some(ip => ips.includes(ip))
  );
}

/* =======================
   SERVER STATUS
======================= */

app.get("/api/server/status", (req, res) => {
  try {
    res.json({
      interface: WG_IFACE,
      service: run(`systemctl is-active wg-quick@${WG_IFACE}`),
      publicKey: run(`wg show ${WG_IFACE} public-key`),
      listenPort: Number(run(`wg show ${WG_IFACE} listen-port`)),
      peers: run(`wg show ${WG_IFACE} peers`).split("\n").filter(Boolean).length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   SERVER CONTROL
======================= */

app.put("/api/server/keys", (req, res) => {
  try {
    let privateKey = req.body.privateKey;
    if (req.body.rotate) privateKey = run("wg genkey");
    if (!privateKey) return res.status(400).json({ error: "No key" });

    const publicKey = run(`echo ${privateKey} | wg pubkey`);
    let conf = fs.readFileSync(WG_CONF, "utf8");
    conf = conf.replace(/PrivateKey\s*=.*/, `PrivateKey = ${privateKey}`);
    fs.writeFileSync(WG_CONF, conf);

    run(`systemctl restart wg-quick@${WG_IFACE}`);
    res.json({ status: "ok", publicKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/server/port", (req, res) => {
  const { port } = req.body;
  if (!port || port < 1 || port > 65535)
    return res.status(400).json({ error: "Invalid port" });

  try {
    let conf = fs.readFileSync(WG_CONF, "utf8");
    conf = conf.replace(/ListenPort\s*=.*/, `ListenPort = ${port}`);
    fs.writeFileSync(WG_CONF, conf);
    run(`systemctl restart wg-quick@${WG_IFACE}`);
    res.json({ status: "ok", port });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/server/restart", (req, res) => {
  run(`systemctl restart wg-quick@${WG_IFACE}`);
  res.json({ status: "restarted" });
});

/* =======================
   PEER LIST + STATUS
======================= */

app.get("/api/peers", (req, res) => {
  const peers = loadPeers();
  const status = run(`wg show ${WG_IFACE}`).split("\n");

  const map = {};
  let current = null;

  status.forEach(l => {
    if (l.startsWith("peer:")) {
      current = l.split(" ")[1];
      map[current] = {};
    }
    if (l.includes("latest handshake"))
      map[current].handshake = l.split(": ").pop();
    if (l.includes("transfer"))
      map[current].transfer = l.split(": ").pop();
  });

  res.json(
    peers.map(p => ({
      ...p,
      status: map[p.publicKey] || null
    }))
  );
});

/* =======================
   ADD PEER
======================= */

app.post("/api/peers", (req, res) => {
  const peers = loadPeers();
  const { name, ips } = req.body;

  if (!name || !ips?.length)
    return res.status(400).json({ error: "Missing fields" });

  if (peers.find(p => p.name === name))
    return res.status(409).json({ error: "Name exists" });

  if (ipConflict(peers, ips))
    return res.status(409).json({ error: "IP conflict" });

  const keys = genKeyPair();
  run(`wg set ${WG_IFACE} peer ${keys.publicKey} allowed-ips ${ips.join(",")}`);
  wgSave();

  peers.push({
    name,
    ...keys,
    ips,
    disabled: false
  });

  savePeers(peers);
  res.json({ status: "created" });
});

/* =======================
   EDIT PEER
======================= */

app.put("/api/peers/:name", (req, res) => {
  const peers = loadPeers();
  const peer = peers.find(p => p.name === req.params.name);
  if (!peer) return res.status(404).json({ error: "Not found" });

  const { name, ips, rotateKeys, publicKey, privateKey } = req.body;

  if (name && peers.some(p => p.name === name && p !== peer))
    return res.status(409).json({ error: "Name exists" });

  if (ips && ipConflict(peers, ips, peer.name))
    return res.status(409).json({ error: "IP conflict" });

  run(`wg set ${WG_IFACE} peer ${peer.publicKey} remove`);

  if (name) peer.name = name;
  if (ips) peer.ips = ips;

  if (rotateKeys) Object.assign(peer, genKeyPair());
  if (publicKey && privateKey)
    Object.assign(peer, { publicKey, privateKey });

  if (!peer.disabled)
    run(`wg set ${WG_IFACE} peer ${peer.publicKey} allowed-ips ${peer.ips.join(",")}`);

  wgSave();
  savePeers(peers);

  res.json({ status: "updated" });
});

/* =======================
   DISABLE / ENABLE
======================= */

app.post("/api/peers/:name/disable", (req, res) => {
  const peers = loadPeers();
  const peer = peers.find(p => p.name === req.params.name);
  if (!peer) return res.status(404).json({ error: "Not found" });
  if (peer.disabled) return res.status(200).json({ info : "Already disabled" });

  run(`wg set ${WG_IFACE} peer ${peer.publicKey} remove`);
  peer.disabled = true;
  wgSave();
  savePeers(peers);

  res.json({ status: "disabled" });
});

app.post("/api/peers/:name/enable", (req, res) => {
  const peers = loadPeers();
  const peer = peers.find(p => p.name === req.params.name);
  if (!peer) return res.status(404).json({ error: "Not found" });
  //if (!peer.disabled) return res.status(200).json({ info : "Already enabled" });

  run(`wg set ${WG_IFACE} peer ${peer.publicKey} allowed-ips ${peer.ips.join(",")}`);
  peer.disabled = false;
  wgSave();
  savePeers(peers);

  res.json({ status: "enabled" });
});

/* =======================
   DELETE PEER
======================= */

app.delete("/api/peers/:name", (req, res) => {
  let peers = loadPeers();
  const peer = peers.find(p => p.name === req.params.name);
  if (!peer) return res.status(404).json({ error: "Not found" });

  run(`wg set ${WG_IFACE} peer ${peer.publicKey} remove`);
  peers = peers.filter(p => p !== peer);
  wgSave();
  savePeers(peers);

  res.json({ status: "deleted" });
});

/* =======================
   START SERVER
======================= */

app.listen(3000, () =>
  console.log("WireGuard UI API running on :3000")
);
