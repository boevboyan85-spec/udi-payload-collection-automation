# Deploy bots-automation on Kasm

## Option A — Pull from GitHub (after push from your Mac)

On your Mac (with a **valid** GitHub PAT):

```bash
cd ~/Documents/GitHub/udi-payload-collection-automation
GITHUB_TOKEN=ghp_YOUR_NEW_TOKEN bash bots-automation/scripts/push-to-github.sh
```

On Kasm:

```bash
cd ~/Documents/git/udi-payload-collection-automation/bots-automation
bash setup-kasm-ubuntu.sh
cp .env.example .env
./run-kasm.sh
```

**`npm: command not found` after setup?** Kasm’s default `apt install nodejs` is often **Node 12 without npm**. Re-run `bash setup-kasm-ubuntu.sh` (disables broken Sublime apt sources, installs **Node 20 + npm** via NodeSource, or **nvm** as fallback). Verify: `node -v` (v18+) and `npm -v`.

**Stuck after `Node v20 … OK` with a spinner `⠙`?** That is **`npm install`** — not frozen. On Kasm/proxy it can take **10–30+ minutes**. You should see `NODE_TLS_REJECT_UNAUTHORIZED` warning (expected). Wait, or run steps manually with visible logs:

```bash
cd ~/Documents/git/udi-payload-collection-automation/bots-automation
export NODE_TLS_REJECT_UNAUTHORIZED=0 PUPPETEER_SKIP_DOWNLOAD=1
npm run install:deps -- --loglevel=info
npm run install:browsers
```

Check progress: `ls -la node_modules 2>/dev/null | wc -l` (grows while install runs).

### `SELF_SIGNED_CERT_IN_CHAIN` on npm fetch

Your network uses a **corporate HTTPS proxy** (custom CA). Fix for test Kasm:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
export NPM_CONFIG_STRICT_SSL=false
npm config set strict-ssl false
export PUPPETEER_SKIP_DOWNLOAD=1

npm run install:deps -- --loglevel=verbose 2>&1 | tee ~/npm-install.log
```

If IT provides a root CA bundle, prefer that over disabling verification:

```bash
npm config set strict-ssl true
npm config set cafile /path/to/corporate-root-ca.pem
```

### npm install debug (see where it hangs)

From `bots-automation`:

```bash
cd ~/Documents/git/udi-payload-collection-automation/bots-automation
export NODE_TLS_REJECT_UNAUTHORIZED=0
export NPM_CONFIG_STRICT_SSL=false
npm config set strict-ssl false
export PUPPETEER_SKIP_DOWNLOAD=1

# Verbose npm + save full log
npm install --loglevel=verbose --timing --no-audit --no-fund 2>&1 | tee ~/npm-install.log

# Maximum detail (very noisy)
# npm install --loglevel=silly --timing 2>&1 | tee ~/npm-install-silly.log

# Show lifecycle scripts (postinstall) on the terminal
# npm install --foreground-scripts --loglevel=verbose 2>&1 | tee ~/npm-install.log
```

If it stops on one package, search the log: `grep -iE 'error|ERR!|ETIMEDOUT|ECONNRESET|certificate' ~/npm-install.log | tail -30`

Registry / proxy checks:

```bash
npm config get registry
npm ping
curl -I https://registry.npmjs.org/
```

Use project helper (skips Puppeteer Chrome download):

```bash
npm run install:deps -- --loglevel=verbose --timing 2>&1 | tee ~/npm-install.log
```

## Option B — Git bundle (no GitHub push needed)

On your Mac (bundle already created if you ran this once):

```bash
cd ~/Documents/GitHub/udi-payload-collection-automation
git bundle create ~/bots-automation-develop.bundle develop
scp ~/bots-automation-develop.bundle YOUR_KASM:~/ 
```

On Kasm:

```bash
export GIT_BUNDLE_PATH=~/bots-automation-develop.bundle
bash setup-kasm-ubuntu.sh
cd ~/Documents/git/udi-payload-collection-automation/bots-automation
cp .env.example .env
npm run collect
```

## Option C — Copy folder directly

```bash
scp -r ~/Documents/GitHub/udi-payload-collection-automation/bots-automation YOUR_KASM:~/Documents/git/udi-payload-collection-automation/
```

Then on Kasm: `cd` that folder, `npm install`, `npm run install:browsers`, `npm run collect`.
