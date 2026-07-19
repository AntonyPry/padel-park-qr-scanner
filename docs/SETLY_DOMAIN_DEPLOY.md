# Setly Domain Deployment

Production domain: `setly.tech`. The dedicated installation-operator hostname is
`ops.setly.tech`.

## DNS

Verified public DNS on July 19, 2026:

- `setly.tech A 155.212.163.43`
- `www.setly.tech A 155.212.163.43`
- authoritative NS: `ns1.firstvds.ru`, `ns2.firstvds.ru`
- explicit FirstVDS record `ops.setly.tech A 155.212.163.43`, TTL `3600`;
  Google Public DNS resolves it to the expected address;
- random subdomains still resolve to `155.212.163.43` through the existing
  wildcard record.

FirstVDS is the active DNS zone owner while these NS are authoritative. Do not
edit REG.RU DNS records or change NS delegation. DNS work for `ops.setly.tech`
is complete; production day only re-verifies NS, A and the absence of
conflicting AAAA/CNAME records.

Current public baseline on July 19, 2026 is intentionally **not** a ready state:
`http://ops.setly.tech` returns Nginx `200` and silently serves the ordinary CRM
default SPA, while normal verification of `https://ops.setly.tech` fails because
the installed certificate SAN does not include `ops.setly.tech`. The next
separately authorized production change must install the dedicated Nginx vhost,
stop the default CRM fallback and issue a certificate containing this hostname.

## Nginx

The frontend is served from `/opt/padel-park-qr-scanner/client/dist`. API and Socket.IO are proxied to the Node process on `127.0.0.1:3000`.

The initial HTTP bootstrap configurations are `deploy/nginx/setly.tech.conf`
and `deploy/nginx/ops.setly.tech.conf`. The operator vhost exposes only the
installation UI, the required operator provisioning API paths and `/api/health`;
it does not expose ordinary CRM, Socket.IO or `/activate-owner`. The product
vhost denies `/installation` and operator API paths while keeping public owner
activation available.

For a fresh installation, install both bootstrap files only during a separately
authorized production change:

```bash
install -m 0644 deploy/nginx/setly.tech.conf /etc/nginx/sites-available/setly.tech
install -m 0644 deploy/nginx/ops.setly.tech.conf /etc/nginx/sites-available/ops.setly.tech
ln -sfn /etc/nginx/sites-available/setly.tech /etc/nginx/sites-enabled/setly.tech
ln -sfn /etc/nginx/sites-available/ops.setly.tech /etc/nginx/sites-enabled/ops.setly.tech
nginx -t
systemctl reload nginx
```

For an existing Certbot-managed production vhost, do not reinstall
`deploy/nginx/setly.tech.conf`. Back up the installed file and merge only its
new `/installation` and operator-API deny locations. Install
`ops.setly.tech.conf` as a new vhost, then run `nginx -t` before reload.

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

    location = /installation { return 404; }
    location ^~ /installation/ { return 404; }
    location ~ ^/api/installation/provisioning/(status|session|snapshot|organizations(?:/|$)) {
        return 404;
    }

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
HOST=127.0.0.1
BEELINE_CALLBACK_URL=https://setly.tech/api/integrations/beeline/events
PUBLIC_APP_URL=https://setly.tech
INSTALLATION_ACTIVATION_BASE_URL=https://setly.tech
```

`ops.setly.tech` does not use Socket.IO and its operator API is same-origin, so
do not add it to `CLIENT_ORIGIN` merely because the hostname exists. The
operator token remains in browser `sessionStorage`, which scopes it to the
`https://ops.setly.tech` origin; the operator vhost removes backend CORS response
headers so another browser origin cannot read provisioning responses.
The Node process must listen on `127.0.0.1:3000`; do not expose its port through
the public firewall, because direct backend access would bypass Nginx host/path
separation.

After changing `BEELINE_CALLBACK_URL`, restart the server and update the XSI subscription from the Beeline integration modal so the provider starts sending events to HTTPS.

## Verification

Verify DNS, both Nginx vhosts, HTTPS, API, SPA fallback and Socket.IO after
deployment. Issue the operator certificate through the existing contour with
`certbot --nginx -d ops.setly.tech`, then verify renewal with
`certbot renew --dry-run`. Keep the old IP available only as an emergency
diagnostic endpoint; normal users use `https://setly.tech`, and authorized
installation operators use `https://ops.setly.tech`.

Do not treat DNS resolution alone as operator-host readiness. Readiness requires
that the current ordinary-CRM HTTP fallback is gone and normal TLS verification
succeeds with `ops.setly.tech` present in the certificate SAN.
