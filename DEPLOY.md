# VPS Deployment Guide

Your production bundle is ready at `deploy.tar.gz` (5.6 MB).

## What's inside
- `server.js` — Next.js standalone server
- `node_modules/` — only the runtime deps (no devDeps)
- `.next/static/`, `.next/server/`, `public/` — compiled assets
- `.env` — your Supabase / Groq / NVIDIA keys

## 1. Provision a fresh Ubuntu 22.04 or 24.04 VPS

On the VPS, install Node 20 + PM2 + Nginx:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm install -g pm2
```

(Optional) Install Ollama for local LLM fallback:
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b-instruct-q4_K_M
```

## 2. Upload the bundle

From your local Windows machine:

```bash
scp deploy.tar.gz user@YOUR_VPS_IP:~/
scp ecosystem.config.js nginx.conf.sample user@YOUR_VPS_IP:~/
```

## 3. Install on the VPS

```bash
ssh user@YOUR_VPS_IP
mkdir -p ~/deal-pipeline/logs
cd ~/deal-pipeline
tar -xzf ~/deploy.tar.gz
mv ~/ecosystem.config.js .
```

Edit `.env` if any secrets need adjusting (e.g. set `USE_LOCAL_LLM=false` if VPS has no GPU):
```bash
nano .env
```

## 4. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # run the command it prints
```

App is now live on `http://YOUR_VPS_IP:3000`.

## 5. Reverse proxy with Nginx + HTTPS

```bash
sudo cp ~/nginx.conf.sample /etc/nginx/sites-available/deal-pipeline
sudo nano /etc/nginx/sites-available/deal-pipeline   # replace server_name with your domain
sudo ln -s /etc/nginx/sites-available/deal-pipeline /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d deals.yourdomain.com
```

## 6. Common ops

```bash
pm2 logs deal-pipeline       # live logs
pm2 restart deal-pipeline    # after a redeploy
pm2 monit                    # resource dashboard
pm2 stop deal-pipeline       # stop
```

## Redeploying updates

Locally:
```bash
npm run build
rm -rf deploy deploy.tar.gz
mkdir -p deploy
cp -r .next/standalone/. deploy/
mkdir -p deploy/.next && cp -r .next/static deploy/.next/
cp -r public deploy/
cp .env.local deploy/.env
tar -czf deploy.tar.gz -C deploy .
scp deploy.tar.gz user@YOUR_VPS_IP:~/
```

On the VPS:
```bash
cd ~/deal-pipeline
tar -xzf ~/deploy.tar.gz
pm2 restart deal-pipeline
```

## Troubleshooting

**Upload too large?** The Nginx sample sets `client_max_body_size 200M`. Raise if you upload bigger folders.

**SSE stream cuts off?** `proxy_read_timeout 600s` and `proxy_buffering off` are already in the Nginx sample. Check those lines exist.

**Out of memory?** Node defaults to ~2GB heap. For large folders, bump it:
```
NODE_OPTIONS=--max-old-space-size=4096 pm2 restart deal-pipeline
```

**Ollama on the VPS is slow?** Without GPU it's ~30-60s per agent. Set `USE_LOCAL_LLM=false` in `.env` to route everything through Groq cloud instead.
