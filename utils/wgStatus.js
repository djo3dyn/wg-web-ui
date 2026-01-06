const { execSync } = require("child_process");
const fs = require("fs");

const PEER_DB = "./data/peers.json";

function loadPeers() {
  if (!fs.existsSync(PEER_DB)) return [];
  return JSON.parse(fs.readFileSync(PEER_DB));
}

function parseWGShow(output) {
  const blocks = output
    .split("\n\n")
    .map(b => b.trim())
    .filter(Boolean);

  const peers = [];

  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim());

    const peer = {
      publicKey: null,
      endpoint: null,
      allowedIps: [],
      lastHandshake: null,
      rx: null,
      tx: null,
      online: false
    };

    for (const line of lines) {
      if (line.startsWith("peer:")) {
        peer.publicKey = line.replace("peer:", "").trim();
      }

      else if (line.startsWith("endpoint:")) {
        peer.endpoint = line.replace("endpoint:", "").trim();
      }

      else if (line.startsWith("allowed ips:")) {
        peer.allowedIps = line
          .replace("allowed ips:", "")
          .trim()
          .split(",")
          .map(v => v.trim());
      }

      else if (line.startsWith("latest handshake:")) {
        const hs = line.replace("latest handshake:", "").trim();
        peer.lastHandshake = hs;
        peer.online = !hs.includes("never");
      }

      else if (line.startsWith("transfer:")) {
        const t = line.replace("transfer:", "").trim();
        const [rx, tx] = t.split(",");
        peer.rx = rx?.replace("received", "").trim();
        peer.tx = tx?.replace("sent", "").trim();
      }
    }

    if (peer.publicKey) peers.push(peer);
  }

  return peers;
}

function getPeerStatus(iface = "wg0") {
  const savedPeers = loadPeers();

  const output = execSync(`wg show ${iface}`)
    .toString()
    .trim();

  const runtimePeers = parseWGShow(output);

  return runtimePeers.map(p => {
    const saved = savedPeers.find(s => s.publicKey === p.publicKey);

    return {
      name: saved?.name || "unknown",
      ips: saved?.ips || p.allowedIps,
      publicKey: p.publicKey,
      endpoint: p.endpoint || null,
      allowedIps: p.allowedIps,
      lastHandshake: p.lastHandshake || "never",
      rx: p.rx || "0 B",
      tx: p.tx || "0 B",
      online: p.online,
      disabled: saved?.disabled ?? false
    };
  });
}

module.exports = { getPeerStatus };
