const express = require("express");
const fs = require("fs");
const { execSync } = require("child_process");
const session = require("express-session");
const bcrypt = require("bcrypt");
const AUTH_FILE = "./data/auth.json";
const path = require("path");

const multer = require("multer");
const upload = multer({
  limits:{ fileSize: 1024 * 1024 } // 1MB
});

const app = express();
app.use(express.json());
app.use(express.static("./public"));
app.use(session({
  secret: "0596c4e2b40b60ea468babd6af68e6d094f66f04df8b3a588adb60ad7e7dcbf7",
  resave: false,
  saveUninitialized: false
}));


const CONFIG_FILE = process.env.APP_CONFIG || "./config.json";

const config = JSON.parse(
  fs.readFileSync(CONFIG_FILE)
);

const WG_IFACE = config.wireguard.interface;
const WG_CONF = config.wireguard.configFile;
const PEER_FILE = config.paths.peerFile;
const SERVER_FILE = config.paths.serverFile;
const APP_PORT = config.app.port;

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
   AUTHENTICATION
======================= */

function readAuth(){
  return JSON.parse(fs.readFileSync(AUTH_FILE));
}

function writeAuth(data){
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data,null,2));
}

function requireLogin(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"Unauthorized"});
  next();
}

app.post("/api/login", async (req,res)=>{
  const { username, password } = req.body;
  const auth = readAuth();

  if(username !== auth.username)
    return res.status(401).json({error:"Invalid login"});

  const ok = await bcrypt.compare(password, auth.password);
  if(!ok) return res.status(401).json({error:"Invalid login"});

  req.session.user = username;
  res.json({ success:true });
});

app.post("/api/logout",(req,res)=>{
  req.session.destroy(()=>res.json({success:true}));
});

app.use("/api", requireLogin);

app.post("/api/change-password", async (req,res)=>{
  const { oldPassword, newPassword } = req.body;
  const auth = readAuth();

  const ok = await bcrypt.compare(oldPassword, auth.password);
  if(!ok) return res.status(400).json({error:"Wrong password"});

  auth.password = await bcrypt.hash(newPassword, 10);
  writeAuth(auth);

  res.json({ success:true });
});

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

app.get("/api/server", (req,res)=>{
  const server = JSON.parse(
    fs.readFileSync(SERVER_FILE)
  );

  res.json({
    interface: server.interface,
    address: server.address,
    network: server.network,
    hostname: server.hostname,
    listenPort: server.listenPort,
    publicKey: server.publicKey
  });
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

// Generate WireGuard keypair
app.post("/api/genkey", (req, res) => {
  const { execSync } = require("child_process");

  try {
    const privateKey = execSync("wg genkey").toString().trim();
    const publicKey = execSync(`echo ${privateKey} | wg pubkey`)
      .toString().trim();

    res.json({ privateKey, publicKey });
  } catch (e) {
    res.status(500).json({ error: "Key generation failed" });
  }
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
   BACKUP / RESTORE
======================= */

app.get("/api/peers/backup", (req,res)=>{
  const file = PEER_FILE;

  if(!fs.existsSync(file)){
    return res.status(404).json({error: file + " not found  "});
  }

  const peers = JSON.parse(fs.readFileSync(file));

  const backup = {
    type: "wgui-peer-backup",
    version: 1,
    timestamp: new Date().toISOString(),
    peers
  };

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=wgui-peers-backup.json"
  );
  res.json(backup);
});

app.post(
  "/api/peers/restore",
  upload.single("backup"),
  (req,res)=>{
    let data;

    try{
      data = JSON.parse(req.file.buffer.toString());
    }catch{
      return res.status(400).json({error:"Invalid JSON"});
    }

    if(
      data.type !== "wgui-peer-backup" ||
      !Array.isArray(data.peers)
    ){
      return res.status(400).json({error:"Invalid backup format"});
    }

    // 1️⃣ write peer.json
    fs.writeFileSync(
      PEER_FILE,
      JSON.stringify(data.peers,null,2)
    );

    // 2️⃣ sync live WireGuard
    clearWireGuardPeers();
    syncPeersToWireGuard(data.peers);

    res.json({
      ok:true,
      count:data.peers.length,
      message:"Peers restored and synced to WireGuard"
    });
  }
);

/* SYnc PEERS TO WG INTERFACE */
function clearWireGuardPeers(){
  const out = execSync(`wg show ${WG_IFACE} peers`).toString().trim();
  if(!out) return;

  out.split("\n").forEach(pub=>{
    run(`wg set ${WG_IFACE} peer ${pub} remove`);
  });
}

function syncPeersToWireGuard(peers){
  peers.forEach(p=>{
    if(p.disabled) return;

    run(
      `wg set ${WG_IFACE} peer ${p.publicKey} allowed-ips ${p.ips.join(",")}`
    );
  });

  wgSave();
}


/* =======================
   START SERVER
======================= */

app.listen(APP_PORT, () =>
  console.log("WireGuard UI API running on :" + APP_PORT)
);
