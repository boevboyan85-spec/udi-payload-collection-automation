# Deploy bots-automation on Kasm

## Option A — Pull from GitHub (after push from your Mac)

On your Mac (with a **valid** GitHub PAT):

```bash
cd ~/Documents/GitHub/udi-payload-collection-automation
GITHUB_TOKEN=ghp_YOUR_NEW_TOKEN bash bots-automation/scripts/push-to-github.sh
```

On Kasm:

```bash
bash setup-kasm-ubuntu.sh
cd ~/Documents/git/udi-payload-collection-automation/bots-automation
cp .env.example .env
./run-kasm.sh
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
