import { execSync } from "child_process";
import fs from "fs";

const WG_IFACE = "wg0";
const WG_CONF = "/etc/wireguard/wg0.conf";

function genKeyPair() {
  const privateKey = execSync("wg genkey").toString().trim();
  const publicKey = execSync(`echo ${privateKey} | wg pubkey`)
    .toString()
    .trim();
  return { privateKey, publicKey };
}

function addPeer(publicKey, allowedIP) {
  execSync(`wg set ${WG_IFACE} peer ${publicKey} allowed-ips ${allowedIP}`);
  execSync(`wg-quick save ${WG_IFACE}`);
}

function getPeers() {
  return execSync(`wg show ${WG_IFACE} dump`).toString();
}


module.exports = { genKeyPair, addPeer, getPeers};
