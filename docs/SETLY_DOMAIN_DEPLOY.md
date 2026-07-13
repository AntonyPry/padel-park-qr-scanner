# Setly Domain Deployment

Production domain: `setly.tech`.

## DNS

Required records:

- `setly.tech A 155.212.163.43`
- `www.setly.tech A 155.212.163.43` or a wildcard `*.setly.tech A 155.212.163.43`

The wildcard DNS record does not automatically create a wildcard TLS certificate. The production certificate only needs `setly.tech` and `www.setly.tech` for the current deployment.

## Nginx

The frontend is served from `/opt/padel-park-qr-scanner/client/dist`. API and Socket.IO are proxied to the Node process on `127.0.0.1:3000`.

The initial HTTP bootstrap configuration is `deploy/nginx/setly.tech.conf`. Install it once before the first Certbot run with:

```bash
install -m 0644 deploy/nginx/setly.tech.conf /etc/nginx/sites-available/setly.tech
ln -sfn /etc/nginx/sites-available/setly.tech /etc/nginx/sites-enabled/setly.tech
nginx -t
systemctl reload nginx
```

Certbot modifies the installed runtime file when it enables TLS. Do not copy the HTTP bootstrap file over `/etc/nginx/sites-available/setly.tech` after certificate issuance. After the first successful HTTPS setup, capture a sanitized final TLS configuration in infrastructure code without certificate private keys or other secrets.

The installed file contains:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name setly.tech www.setly.tech;

    root /opt/padel-park-qr-scanner/client/dist;
    index index.html;
    client_max_body_size 64m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Server Environment

Set these values in the production server environment without committing secrets:

```dotenv
CLIENT_ORIGIN=https://setly.tech,https://www.setly.tech
CORS_ORIGIN=https://setly.tech,https://www.setly.tech
BEELINE_CALLBACK_URL=https://setly.tech/api/integrations/beeline/events
```

After changing `BEELINE_CALLBACK_URL`, restart the server and update the XSI subscription from the Beeline integration modal so the provider starts sending events to HTTPS.

## Verification

Verify DNS, Nginx, HTTPS, API, SPA fallback and Socket.IO after deployment. Keep the old IP available only as an emergency diagnostic endpoint; normal users should use `https://setly.tech`.
