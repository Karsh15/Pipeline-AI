# VPS Deployment Guide

## 1. Provision the server

Ubuntu 22.04 / 24.04 VPS. Install Node 20, PM2, and Nginx:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx
sudo npm install -g pm2
sudo mkdir -p /var/log/pipeline-ai
```

## 2. Build locally

```bash
npm install
npm run build
```

This produces `dist/` with the full standalone server.

## 3. Pack for upload

On Windows (PowerShell):
```powershell
Compress-Archive -Path dist/standalone/* -DestinationPath pipeline-ai.zip
```

On Mac/Linux:
```bash
tar -czf pipeline-ai.tar.gz -C dist/standalone .
```

## 4. Upload to VPS

```bash
scp pipeline-ai.tar.gz        user@YOUR_VPS_IP:~/
scp -r dist/static            user@YOUR_VPS_IP:/tmp/next-static
scp -r public                 user@YOUR_VPS_IP:/tmp/public
scp infra/ecosystem.config.js user@YOUR_VPS_IP:~/
scp infra/nginx.conf          user@YOUR_VPS_IP:~/
```

## 5. Extract and configure

```bash
ssh user@YOUR_VPS_IP
mkdir -p /var/www/pipeline-ai/.next
cd /var/www/pipeline-ai
tar -xzf ~/pipeline-ai.tar.gz
cp -r /tmp/next-static .next/static
cp -r /tmp/public      public
cp ~/ecosystem.config.js .
```

Create `/var/www/pipeline-ai/.env`:
```env
NODE_ENV=production
PORT=3000

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

NVIDIA_API_KEY=nvapi-...
GROQ_API_KEY=gsk_...

USE_LOCAL_LLM=false
```

## 6. Start with PM2

```bash
cd /var/www/pipeline-ai
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # run the printed command to enable auto-start on reboot
```

App is now running on `http://YOUR_VPS_IP:3000`.

## 7. Nginx reverse proxy + HTTPS

```bash
sudo cp ~/nginx.conf /etc/nginx/sites-available/pipeline-ai
sudo nano /etc/nginx/sites-available/pipeline-ai   # set your domain in server_name
sudo ln -s /etc/nginx/sites-available/pipeline-ai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

`infra/nginx.conf` is pre-configured with SSE streaming settings (`proxy_buffering off`, 600s timeouts).

## 8. Redeploying updates

```bash
# Local: rebuild and repack (steps 2–4 above), then on VPS:
cd /var/www/pipeline-ai
tar -xzf ~/pipeline-ai.tar.gz
cp -r /tmp/next-static .next/static
pm2 restart pipeline-ai
```

## Common ops

```bash
pm2 logs pipeline-ai           # live logs
pm2 monit                      # resource dashboard
pm2 restart pipeline-ai        # restart after deploy
tail -f /var/log/pipeline-ai/err.log
```

## Troubleshooting

**SSE stream cuts off** — verify `proxy_buffering off` and `proxy_read_timeout 600s` in nginx.conf.

**Out of memory** — ecosystem config sets `--max-old-space-size=2048`. Set to 4096 on a larger VPS.

**LLM timeouts** — set `USE_LOCAL_LLM=false` in `.env` to route everything to NVIDIA/Groq cloud.
