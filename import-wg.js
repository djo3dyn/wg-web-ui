const { execSync } = require("child_process");
const fs = require("fs");

const out = execSync("wg show wg0 dump").toString().trim().split("\n");

const peers = [];

out.slice(1).forEach(line=>{
  const parts = line.split("\t");
  peers.push({
    name: "imported-" + parts[0].slice(0,6),
    publicKey: parts[0],
    ips: parts[3].split(","),
    disabled: false,
    createdAt: new Date().toISOString()
  });
});

fs.writeFileSync("./data/peers.json", JSON.stringify(peers,null,2));
console.log("Imported", peers.length, "peers");
