# WireGuard Web UI (WGUI)

A lightweight self-hosted WireGuard Web UI built with Node.js + HTML, designed to manage native WireGuard servers without replacing existing configurations.

## Features
- Manage peers (add / edit / delete / disable)
- Generate & rotate key pairs
- Multiple Allowed IPs per peer
- Show live peer status (`wg show`)
- Download / copy client config
- Hide private keys by default
- Login & change password
- Backup & restore peer data
- Sync using `wg set` (no direct conf edit)
- Multi-instance support (PM2)
- Works with native WireGuard

## Requirements
- Linux (Ubuntu/Debian)
- Node.js 18+
- WireGuard installed & running
- Root or sudo access

## Installation
```bash
git clone https://github.com/yourusername/wgui.git
cd wgui
npm install
```

## Configuration
Create config file:
```json
{
  "WG_IFACE": "wg0",
  "WG_CONF": "/etc/wireguard/wg0.conf",
  "PEER_FILE": "./data/peers.json",
  "SERVER_FILE": "./data/server.json",
  "APP_PORT": 3000
}
```

## Run (Development)
```bash
APP_CONFIG=./config-wg0.json node app.js
```

## Run with PM2 (Production)
```bash
npm install -g pm2
APP_CONFIG=./config-wg0.json pm2 start app.js --name wgui-wg0
pm2 startup
pm2 save
```

## Multi Instance
```bash
APP_CONFIG=./config-wg1.json pm2 start app.js --name wgui-wg1
```

## Sudo Permission
```bash
visudo
```
Add:
```
youruser ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick
```

## Backup & Restore
- Backup exports `data/peers.json`
- Restore re-syncs peers to WireGuard runtime

## Security
```bash
chmod 600 data/peers.json
```

## License
MIT
