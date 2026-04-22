# VPS Deployment Guide

## Architecture

```
VPS (Ubuntu 22.04)
  ├── Nginx  (:80/:443)
  │   ├── /          → serves frontend/dist (static files)
  │   └── /api/*     → proxies to Express backend on :4000
  └── PM2
      └── pipeline-backend  → backend/dist/server.js
```

## 1. Server Setup

```bash
ssh root@YOUR_VPS_IP

apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx
npm install -g pm2
mkdir -p /var/www/pipeline-ai
```

## 2. Upload Project

```bash
# From your local machine:
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  ./ root@YOUR_VPS_IP:/var/www/pipeline-ai/
```

## 3. Build Frontend

```bash
cd /var/www/pipeline-ai/frontend
# Create frontend/.env.production
echo "VITE_SUPABASE_URL=https://txrpnyhugurcfpfycqnq.supabase.co" > .env.production
echo "VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY" >> .env.production
echo "VITE_API_URL=" >> .env.production   # empty = use Nginx proxy

npm install
npm run build   # output: frontend/dist/
```

## 4. Build Backend

```bash
cd /var/www/pipeline-ai/backend
cp .env .env.production  # edit APP_URL and BACKEND_URL to your domain

npm install
npm run build   # output: backend/dist/
mkdir -p logs
```

## 5. Configure Nginx

```bash
cp /var/www/pipeline-ai/nginx.conf /etc/nginx/sites-available/pipeline-ai
# Edit: replace "your-domain.com" with your actual domain
nano /etc/nginx/sites-available/pipeline-ai

ln -sf /etc/nginx/sites-available/pipeline-ai /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 6. Start Backend with PM2

```bash
cd /var/www/pipeline-ai
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run the printed command to enable auto-start on reboot
```

## 7. SSL (optional but recommended)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

## 8. Update Azure for Outlook OAuth

In Azure portal → App registrations → your app → Authentication:
- Add Redirect URI: `https://your-domain.com/api/outlook/callback`
- Update `BACKEND_URL=https://your-domain.com` in backend `.env`

## Updating the App

```bash
cd /var/www/pipeline-ai
git pull
cd frontend && npm install && npm run build && cd ..
cd backend && npm install && npm run build && cd ..
pm2 restart pipeline-backend
```

## Useful Commands

```bash
pm2 logs pipeline-backend   # live logs
pm2 status
systemctl status nginx
nginx -t
```

## Environment Variables

### frontend/.env.production
| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_API_URL` | Leave empty (Nginx proxies /api) |

### backend/.env
| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `NVIDIA_API_KEY` + `NVIDIA_API_KEY_*` | Per-agent NVIDIA NIM keys |
| `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` | Outlook OAuth |
| `APP_URL` | Frontend origin e.g. `https://your-domain.com` |
| `BACKEND_URL` | Backend origin (same as APP_URL when using Nginx) |
| `PORT` | Express port (default `4000`) |
