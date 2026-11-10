#!/bin/bash
# One-time VM setup for per-account sandboxing. Run with sudo from the repo root.
set -euo pipefail
WORKER_USER=${WORKER_USER:-sid}

groupadd -f tandem
mkdir -p /srv/tandem/workspaces /srv/tandem/homes
chown "$WORKER_USER":tandem /srv/tandem/workspaces
# Group may traverse (to reach workspaces it was granted) but not list or write.
chmod 0710 /srv/tandem/workspaces
setfacl -b /srv/tandem/workspaces
setfacl -d -m g::---,o::---,u:"$WORKER_USER":rwx /srv/tandem/workspaces
chmod 711 /srv/tandem/homes
usermod -aG tandem "$WORKER_USER"

install -m 755 -o root -g root "$JCODE_BIN" /usr/local/bin/jcode
install -m 755 -o root -g root deploy/tandem-as /usr/local/sbin/tandem-as

cat > /etc/sudoers.d/tandem <<EOF
$WORKER_USER ALL=(root) NOPASSWD: /usr/local/sbin/tandem-as
EOF
chmod 440 /etc/sudoers.d/tandem
visudo -cf /etc/sudoers.d/tandem

# Sandboxed users (primary group tandem) may reach the internet but not
# services on this box or the private network. The worker's primary group is
# its own, so it is unaffected.
cat > /etc/tandem-nft.conf <<'EOF'
table inet tandem
flush table inet tandem
table inet tandem {
  chain out {
    type filter hook output priority 0; policy accept;
    meta skgid tandem ip daddr { 127.0.0.53, 127.0.0.54 } udp dport 53 accept
    meta skgid tandem ip daddr { 127.0.0.53, 127.0.0.54 } tcp dport 53 accept
    # Replies on connections someone else opened (e.g. an OAuth callback delivered by the
    # worker to a sandbox's loopback listener). The sandbox still can't open new ones.
    meta skgid tandem ct state established,related accept
    meta skgid tandem oifname "lo" reject
    meta skgid tandem ip daddr { 10.0.0.0/8, 100.64.0.0/10, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16 } reject
    meta skgid tandem ip6 daddr { fc00::/7, fe80::/10 } reject
  }
}
EOF
nft -f /etc/tandem-nft.conf
cat > /etc/systemd/system/tandem-nft.service <<'EOF'
[Unit]
Description=Tandem sandbox egress rules
After=network-pre.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/tandem-nft.conf
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable tandem-nft >/dev/null

# Agent browser: Playwright MCP + its own Chromium, readable by every sandbox.
# Each run launches a fresh in-memory profile, so no agent is ever logged in.
mkdir -p /opt/tandem-browser/bin /srv/tandem/sessions
chmod 700 /srv/tandem/sessions
(cd /opt/tandem-browser && [ -f package.json ] || npm init -y >/dev/null; npm i --silent @playwright/mcp@0.0.85)
PLAYWRIGHT_BROWSERS_PATH=/opt/tandem-browser/browsers npx --yes --prefix /opt/tandem-browser playwright install chromium
install -m 755 "$(dirname "$0")/tandem-browser-mcp.mjs" /opt/tandem-browser/bin/tandem-browser-mcp
chown -R root:root /opt/tandem-browser && chmod -R a+rX /opt/tandem-browser
echo done
