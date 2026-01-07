# WireGuard Web UI – API Documentation

Base URL:
```
http://<server-ip>:<port>/api
```

All endpoints require authentication (login).

---

## 🔐 Authentication

### Login
**POST** `/api/login`

```json
{
  "username": "admin",
  "password": "password"
}
```

Response:
```json
{ "success": true }
```

---

### Logout
**POST** `/api/logout`

Response:
```json
{ "success": true }
```

---

### Change Password
**POST** `/api/change-password`

```json
{
  "oldPassword": "oldpass",
  "newPassword": "newpass"
}
```

---

## 🧑‍💻 Peers

### List Peers
**GET** `/api/peers`

Response:
```json
[
  {
    "name": "client1",
    "publicKey": "PUBKEY",
    "ips": ["10.10.0.2/32"],
    "disabled": false
  }
]
```

---

### Add Peer
**POST** `/api/peers`

```json
{
  "name": "client2",
  "publicKey": "PUBKEY",
  "privateKey": "PRIVKEY",
  "ips": ["10.10.0.3/32"]
}
```

---

### Edit Peer
**PUT** `/api/peers/:publicKey`

```json
{
  "name": "new-name",
  "ips": ["10.10.0.4/32"],
  "disabled": false
}
```

---

### Delete Peer
**DELETE** `/api/peers/:publicKey`

Response:
```json
{ "success": true }
```

---

### Enable / Disable Peer
**POST** `/api/peers/:publicKey/disable`

```json
{ "disabled": true }
```

---

## 📡 Peer Status

### Get WireGuard Status
**GET** `/api/peers/status`

Response:
```json
[
  {
    "publicKey": "PUBKEY",
    "endpoint": "1.2.3.4:54321",
    "handshake": "30 seconds ago",
    "transferRx": "1.2 MiB",
    "transferTx": "800 KiB"
  }
]
```

---

## 🖥️ Server

### Get Server Info
**GET** `/api/server`

Response:
```json
{
  "interface": "wg0",
  "publicKey": "SERVER_PUBKEY",
  "listeningPort": 50000,
  "address": "10.10.0.1/24"
}
```

---

### Update Server Settings
**PUT** `/api/server`

```json
{
  "listeningPort": 51820
}
```

---

### Restart WireGuard
**POST** `/api/server/restart`

Response:
```json
{ "success": true }
```

---

## 📁 Backup & Restore

### Backup Peers
**GET** `/api/backup`

Downloads:
```
peers.json
```

---

### Restore Peers
**POST** `/api/restore`

Form-data:
```
file = peers.json
```

Response:
```json
{ "success": true }
```

Peers are automatically synced using:
```
wg set <iface> peer <pubkey> allowed-ips <ips>
wg save
```

---

## 🧪 Utility

### Generate Key Pair
**GET** `/api/generate-key`

Response:
```json
{
  "privateKey": "PRIVKEY",
  "publicKey": "PUBKEY"
}
```

---

## ⚠️ Notes

- Private keys are hidden by default in UI
- API does not expose private keys unless explicitly requested
- Designed to work with native WireGuard
- No direct editing of wg0.conf

---

## 📄 License
MIT
