#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AVRYD DESKTOP INSTALLER
# Repo layout expected at the root:
#   AvrydDesktop.jsx
#   server.js
#   install.sh
#   *your wallpaper image* (.jpg/.jpeg/.png)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[AVRYD]${NC} $*"; }
ok()   { echo -e "${GREEN}[ OK ]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run this as root: sudo bash install.sh"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/usr/share/avryd"
UI_DIR="$INSTALL_DIR/ui"
WALL_DIR="$INSTALL_DIR/wallpapers"
BIN_DIR="/usr/local/bin"
XS_DIR="/usr/share/xsessions"
LOG_DIR="/var/log/avryd"

log "Installing dependencies..."
apt-get update -qq
apt-get install -y --no-install-recommends \
  nodejs npm git curl jq \
  xorg xinit openbox picom feh dbus-x11 \
  || fail "Dependency install failed"

log "Creating directories..."
install -d "$INSTALL_DIR" "$UI_DIR" "$WALL_DIR" "$LOG_DIR" \
  "$UI_DIR/src" "$UI_DIR/electron" "$UI_DIR/public/wallpapers"

log "Finding wallpaper in repo root..."
WALL_SRC="$(find "$ROOT_DIR" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | head -n 1 || true)"
[[ -n "${WALL_SRC}" ]] || fail "No wallpaper image found in repo root. Add your JPEG/PNG there."

log "Installing wallpaper..."
install -m 0644 "$WALL_SRC" "$WALL_DIR/stock.jpg"
install -m 0644 "$WALL_SRC" "$UI_DIR/public/wallpapers/stock.jpg"

log "Installing AvrydDesktop.jsx..."
[[ -f "$ROOT_DIR/AvrydDesktop.jsx" ]] || fail "AvrydDesktop.jsx is missing from the repo root."
cp "$ROOT_DIR/AvrydDesktop.jsx" "$UI_DIR/src/App.jsx"

log "Installing server.js..."
[[ -f "$ROOT_DIR/server.js" ]] && install -m 0644 "$ROOT_DIR/server.js" "$INSTALL_DIR/server.js"

log "Writing React/Vite/Electron app files..."
cat > "$UI_DIR/package.json" <<'EOF'
{
  "name": "avryd-ui",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "electron": "electron electron/main.cjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.3.1",
    "vite": "^5.4.0"
  }
}
EOF

cat > "$UI_DIR/vite.config.js" <<'EOF'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './'
});
EOF

cat > "$UI_DIR/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Avryd</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

cat > "$UI_DIR/src/main.jsx" <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
EOF

cat > "$UI_DIR/src/index.css" <<'EOF'
html, body, #root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  background: #07131a url('/wallpapers/stock.jpg') center center / cover no-repeat fixed;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

* {
  box-sizing: border-box;
}
EOF

cat > "$UI_DIR/src/wallpaper.js" <<'EOF'
export const STOCK_WALLPAPER = '/wallpapers/stock.jpg';
EOF

cat > "$UI_DIR/electron/main.cjs" <<'EOF'
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
EOF

cat > "$UI_DIR/electron/preload.cjs" <<'EOF'
const { contextBridge } = require('electron');
const { execFile } = require('child_process');

function run(file, args = []) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      resolve(stdout);
    });
  });
}

contextBridge.exposeInMainWorld('avryd', {
  shutdown: () => run('systemctl', ['poweroff']),
  reboot: () => run('systemctl', ['reboot']),
  lock: () => run('loginctl', ['lock-session']),
  open: (target) => run('xdg-open', [target]),
  setWallpaper: (file) => run('feh', ['--bg-fill', file])
});
EOF

log "Installing npm dependencies..."
cd "$UI_DIR"
npm install --silent || fail "npm install failed"

log "Building UI..."
npm run build --silent || fail "UI build failed"

log "Writing session launcher..."
cat > "$BIN_DIR/avryd-session" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=Avryd
export DESKTOP_SESSION=Avryd
export DISPLAY=\${DISPLAY:-:0}

LOG_DIR="/var/log/avryd"
mkdir -p "\$LOG_DIR"

picom --config /etc/xdg/picom.conf >/dev/null 2>&1 &
PICOM_PID=\$!

if command -v feh >/dev/null 2>&1; then
  feh --bg-fill /usr/share/avryd/wallpapers/stock.jpg >/dev/null 2>&1 || true
fi

openbox >/dev/null 2>&1 &
OB_PID=\$!

cd /usr/share/avryd/ui
npm run electron

kill "\$OB_PID" "\$PICOM_PID" >/dev/null 2>&1 || true
EOF
chmod +x "$BIN_DIR/avryd-session"

log "Writing X session entry..."
cat > "$XS_DIR/avryd.desktop" <<'EOF'
[Desktop Entry]
Name=Avryd
Comment=Avryd Desktop Environment
Exec=/usr/local/bin/avryd-session
Type=Application
EOF

log "Writing .xinitrc fallback..."
cat > /etc/skel/.xinitrc <<'EOF'
#!/usr/bin/env bash
exec /usr/local/bin/avryd-session
EOF
chmod +x /etc/skel/.xinitrc
[[ -f "$HOME/.xinitrc" ]] || cp /etc/skel/.xinitrc "$HOME/.xinitrc"

log "Locking UI files..."
touch "$INSTALL_DIR/.ui_locked"
find "$UI_DIR/src" "$UI_DIR/electron" -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.cjs' -o -name '*.html' -o -name '*.css' \) \
  -exec chattr +i {} \; 2>/dev/null || true

log "Writing version file..."
echo "1.0.0" > "$INSTALL_DIR/version"

chown -R root:root "$INSTALL_DIR" "$BIN_DIR/avryd-session" "$XS_DIR/avryd.desktop" 2>/dev/null || true
chmod -R 755 "$INSTALL_DIR" "$UI_DIR" 2>/dev/null || true
chmod 644 "$INSTALL_DIR/version" "$INSTALL_DIR/.ui_locked" 2>/dev/null || true

ok "Avryd installed."
echo
echo "Run this on the VM:"
echo "  sudo bash install.sh"
echo "  reboot"
echo "Then choose: Avryd"
echo
echo "UI:        $UI_DIR"
echo "Wallpaper: $WALL_DIR/stock.jpg"
echo "Session:   /usr/local/bin/avryd-session"
