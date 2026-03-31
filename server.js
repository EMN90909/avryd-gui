/**
 * AVRYD UPDATE SERVER
 * Deploy this to Render.com as: ui-avryd.onrender.com
 *
 * Endpoints:
 *   GET  /                    → health check
 *   GET  /api/version         → current published version
 *   POST /api/update          → trigger update check (client side)
 *   GET  /api/bundle          → download latest UI bundle (tar.gz)
 *   GET  /api/wallpapers      → list available wallpapers from avryd-wallpapers repo
 *   POST /api/publish         → (admin) publish new version with bundle upload
 *   GET  /api/changelog       → release notes
 *
 * Environment variables:
 *   ADMIN_SECRET   — secret token for publishing updates
 *   PORT           — port (Render sets this automatically)
 */

const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const { execSync } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── State (in production use a real DB or filesystem; here we use in-memory + disk) ─
const DATA_DIR    = process.env.DATA_DIR || '/tmp/avryd-server';
const BUNDLE_PATH = path.join(DATA_DIR, 'latest.tar.gz');
const META_PATH   = path.join(DATA_DIR, 'meta.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load persisted metadata or set defaults
let meta = {
  version:   '1.0.0',
  published: new Date().toISOString(),
  changelog: 'Initial release of Avryd Desktop Environment.',
  checksum:  '',
  size:      0,
};

if (fs.existsSync(META_PATH)) {
  try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch {}
}

const saveMeta = () => fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));

// ── Auth middleware ───────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  const token = req.headers['authorization']?.replace('Bearer ', '') ||
                req.query.secret;
  const expected = process.env.ADMIN_SECRET || 'change-me-in-production';
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Health / root ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service:     'Avryd Update Server',
    status:      'ok',
    version:     meta.version,
    published:   meta.published,
    bundle_size: meta.size,
    endpoints: [
      'GET  /api/version',
      'GET  /api/bundle',
      'GET  /api/changelog',
      'GET  /api/wallpapers',
      'POST /api/publish   (admin)',
    ],
  });
});

// ── GET /api/version ──────────────────────────────────────────────────────────
// Clients poll this to check if there is a newer version available.
app.get('/api/version', (req, res) => {
  res.json({
    version:   meta.version,
    published: meta.published,
    checksum:  meta.checksum,
    size:      meta.size,
  });
});

// ── GET /api/bundle ───────────────────────────────────────────────────────────
// Download the latest UI bundle as tar.gz.
// Clients: avryd-update script uses this to replace /usr/share/avryd/ui
app.get('/api/bundle', (req, res) => {
  if (!fs.existsSync(BUNDLE_PATH)) {
    return res.status(404).json({ error: 'No bundle available yet. Use POST /api/publish to upload one.' });
  }

  const stat = fs.statSync(BUNDLE_PATH);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="avryd-ui-${meta.version}.tar.gz"`);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('X-Avryd-Version', meta.version);
  res.setHeader('X-Avryd-Checksum', meta.checksum);
  fs.createReadStream(BUNDLE_PATH).pipe(res);
});

// ── GET /api/changelog ────────────────────────────────────────────────────────
app.get('/api/changelog', (req, res) => {
  res.json({
    version:   meta.version,
    published: meta.published,
    notes:     meta.changelog,
  });
});

// ── GET /api/wallpapers ───────────────────────────────────────────────────────
// Proxies the wallpaper index from avryd-wallpapers.git
// or returns a local list if the GitHub repo is unavailable.
app.get('/api/wallpapers', async (req, res) => {
  const REPO_INDEX = 'https://raw.githubusercontent.com/avryd/avryd-wallpapers/main/index.json';
  try {
    const fetch = (await import('node-fetch')).default;
    const r     = await fetch(REPO_INDEX);
    if (!r.ok) throw new Error('repo not reachable');
    const data  = await r.json();
    return res.json(data);
  } catch {
    // Fallback: return stock wallpaper only
    return res.json({
      wallpapers: [
        { file: 'stock.jpg', thumb: 'thumbs/stock.jpg', name: 'Stock Teal', author: 'Pawel Czerwinski' },
      ],
      source: 'fallback',
    });
  }
});

// ── POST /api/publish (admin) ─────────────────────────────────────────────────
// Upload a new UI bundle and set the version.
//
// Body (JSON):
//   { version: "1.2.0", changelog: "...", bundle: "<base64 tar.gz>" }
//
// Or multipart (from CI):
//   form-data with fields: version, changelog, bundle (file)
app.post('/api/publish', requireAdmin, async (req, res) => {
  const { version, changelog, bundle } = req.body;

  if (!version || !bundle) {
    return res.status(400).json({ error: 'version and bundle (base64) required' });
  }

  // Validate semver
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    return res.status(400).json({ error: 'version must be semver (e.g. 1.2.0)' });
  }

  // Decode and write bundle
  let bundleBuffer;
  try { bundleBuffer = Buffer.from(bundle, 'base64'); }
  catch { return res.status(400).json({ error: 'bundle must be base64 encoded tar.gz' }); }

  fs.writeFileSync(BUNDLE_PATH, bundleBuffer);

  // Compute checksum
  const hash = crypto.createHash('sha256').update(bundleBuffer).digest('hex');

  // Update meta
  meta = {
    version,
    published: new Date().toISOString(),
    changelog: changelog || `Update to ${version}`,
    checksum:  hash,
    size:      bundleBuffer.length,
  };
  saveMeta();

  console.log(`Published Avryd UI v${version} (${bundleBuffer.length} bytes, sha256: ${hash})`);

  res.json({
    ok:        true,
    version,
    checksum:  hash,
    size:      bundleBuffer.length,
    published: meta.published,
  });
});

// ── POST /api/update ──────────────────────────────────────────────────────────
// Client calls this to acknowledge it received the update signal.
// Server can log which clients are updating.
app.post('/api/update', (req, res) => {
  const { hostname, current_version } = req.body || {};
  console.log(`Update requested by ${hostname || 'unknown'} from v${current_version || '?'} -> v${meta.version}`);
  res.json({ version: meta.version, bundle_url: '/api/bundle', checksum: meta.checksum });
});

// ── GET /api/import-ui ────────────────────────────────────────────────────────
// Returns a shell script that installs the UI on a fresh machine.
// curl https://ui-avryd.onrender.com/api/import-ui | sudo bash
app.get('/api/import-ui', (req, res) => {
  const script = `#!/usr/bin/env bash
# Avryd UI import script — generated by ui-avryd.onrender.com
# Usage: curl https://ui-avryd.onrender.com/api/import-ui | sudo bash
set -euo pipefail
SERVER="https://ui-avryd.onrender.com"
UI_REPO="https://github.com/avryd/avryd-ui.git"
INSTALL_DIR="/usr/share/avryd"

echo "[avryd] Importing Avryd UI from GitHub..."
[[ $EUID -ne 0 ]] && echo "Run as root" && exit 1

apt-get install -y --no-install-recommends git nodejs npm openbox picom xorg feh 2>/dev/null || true

# Clone UI
mkdir -p "$INSTALL_DIR"
if [[ -d "$INSTALL_DIR/ui/.git" ]]; then
  git -C "$INSTALL_DIR/ui" pull origin main
else
  git clone --depth=1 "$UI_REPO" "$INSTALL_DIR/ui"
fi

# Build
cd "$INSTALL_DIR/ui" && npm install --silent && npm run build --silent 2>/dev/null || true

# Write version
VERSION=$(curl -sf "$SERVER/api/version" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "1.0.0")
echo "$VERSION" > "$INSTALL_DIR/version"

# Lock UI files
find "$INSTALL_DIR/ui" -type f \\( -name "*.js" -o -name "*.jsx" -o -name "*.html" \\) \\
  -exec chattr +i {} \\; 2>/dev/null || true
echo "Avryd UI $VERSION imported and locked." > "$INSTALL_DIR/.ui_locked"

echo "[avryd] Import complete. Run: avryd-session"
`;
  res.setHeader('Content-Type', 'text/plain');
  res.send(script);
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Avryd Update Server — port ${PORT}   ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`  Current version: ${meta.version}`);
  console.log(`  Bundle ready:    ${fs.existsSync(BUNDLE_PATH)}`);
  console.log(`  Deploy to:       ui-avryd.onrender.com\n`);
});
