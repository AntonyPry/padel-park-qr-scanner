# Setly browser and HTTP containment

Status: SEC-A8 application contract. Production Nginx, certificates, firewall,
DNS and rollout remain outside this capability.

## Exact product-origin policy

Express and Socket.IO consume one parsed policy. The policy reads the existing
`CLIENT_ORIGIN` and `CORS_ORIGIN` variables:

- production requires at least one non-empty variable;
- when both are set, they must contain the same exact set (order may differ);
- entries are comma-separated canonical `https://host[:port]` origins with no
  path, query, fragment or credentials;
- empty entries, duplicates, wildcard `*`, non-HTTP(S), non-canonical values,
  insecure production origins and mismatched variables fail startup;
- the `ops.setly.tech` host is rejected as a product origin at any scheme/port.

The production values are:

```dotenv
CLIENT_ORIGIN=https://setly.tech,https://www.setly.tech
CORS_ORIGIN=https://setly.tech,https://www.setly.tech
```

Unset non-production configuration has one bounded fallback for the current
development and preview harness only: ports `4173`, `4174`, `5173` and `5174`
on `127.0.0.1` and `localhost`. Any other local port requires an explicit exact
configuration. Production never uses this fallback.

Requests without `Origin` remain available to same-origin/non-browser callers
and receive no CORS headers. An exact configured product origin receives its
matching `Access-Control-Allow-Origin`, never `*`, and no
`Access-Control-Allow-Credentials`. Current methods remain
`GET, HEAD, PUT, PATCH, POST, DELETE`; preflight continues to echo the browser's
requested header set. Both onboarding response headers remain exposed:

- `X-Onboarding-Completed-Task-Keys`;
- `X-Onboarding-Progressed-Task-Keys`.

An untrusted, `null` or star origin receives one generic `403
CORS_ORIGIN_DENIED` before request timing, body parsing, provider/auth/tenant
logic or application diagnostics. The response contains no submitted origin,
route, query, body, token or identity. This is browser containment, not the A6
cookie/CSRF contract: missing-origin, Referer and anti-CSRF enforcement are not
added here.

The operator API stays same-origin behind the exact `ops.setly.tech` Host. A
request whose canonical Origin host equals the preserved HTTP Host passes
without CORS headers. This preserves the dedicated operator vhost without
putting `ops.setly.tech` in the product allowlist. The ops vhost does not proxy
Socket.IO.

Socket.IO uses the same exact product-origin decision, keeps `GET`/`POST`, and
allows an absent Origin for non-browser clients. Untrusted, operator and star
origins fail the Engine.IO CORS handshake before Socket authentication or tenant
middleware; token, account, tenant and room behavior are unchanged.

## Application response headers

The application adds these headers before CORS, provider ingress, parsers,
static files and API routing, so they remain present on allowed/denied API,
static, parser-error and 404 responses:

| Header | Application value / intent |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY`; immediate framing enforcement |
| `Referrer-Policy` | `no-referrer`; capability paths and queries do not leave the origin through browser referrers |
| `Permissions-Policy` | denies camera, capture, location, sensors, microphone and payment; keeps same-origin autoplay/fullscreen and the existing Web Serial scanner |
| `Content-Security-Policy-Report-Only` | restrictive report-only baseline with `frame-ancestors 'none'` and a bounded discard receiver |

The report-only CSP allows current browser requirements:

- scripts, styles, fonts and normal assets from self; inline styles remain
  report-only-compatible with current React component styling;
- self/data/blob images, self/data fonts, self/blob media and workers;
- product API plus `ws:`/`wss:` equivalents of the exact allowed origins for
  Socket.IO; production API and `/socket.io/` remain same-origin;
- no frames, objects or third-party browser assets were found in the current
  SPA contract. Provider/bot/telephony upstream calls remain server-side.

The policy uses `report-uri /__csp-report`. This non-API application endpoint
buffers at most 16 KiB, discards the body and returns `204`; malformed/oversized
input receives a fixed `400`/`413`. It runs before request timing and has no raw
report, URL, query, token, sample or PII logging/echo. There is no `report-to`,
`Report-To`, persistence, audit row or metric in SEC-A8. Raw CSP reports can
contain a document URL, blocked URL, source location and samples, so browser
DevTools remains the diagnostic surface. A future central collector belongs to
A10/I4 and must accept only a redacted allowlisted event envelope, never a raw
report. Existing full-stop maintenance still returns its generic `503` before
the report body is read.

## HSTS gate

The HTTP bootstrap emits no HSTS by default:

```dotenv
SECURITY_HSTS_ENABLED=false
SECURITY_HSTS_TLS_READY=false
```

`Strict-Transport-Security: max-age=31536000` is emitted only when all of these
are true at startup:

1. `NODE_ENV=production`;
2. `SECURITY_HSTS_ENABLED=true`;
3. `SECURITY_HSTS_TLS_READY=true`;
4. every configured product origin is HTTPS.

Ambiguous boolean values or a partial gate fail startup. The first application
policy intentionally omits `includeSubDomains` and `preload`: the separate ops
certificate/vhost and wildcard DNS must be verified before either can be
considered. Roll back by setting `SECURITY_HSTS_ENABLED=false`; do not remove
TLS or return CORS to wildcard.

## Application-to-infrastructure contract

The tracked HTTP bootstrap Nginx files are not production evidence and are not
changed by SEC-A8. Before production enablement, DevOps must provide secret-free
evidence that:

1. `setly.tech` and `www.setly.tech` have valid TLS and redirect HTTP to HTTPS;
2. the dedicated `ops.setly.tech` vhost/certificate is installed, ordinary CRM
   fallback is gone, and that vhost still denies Socket.IO and non-operator API;
3. Node remains reachable only through the intended local proxy boundary and
   receives the original Host;
4. the exact origin variables above are present in every Node process and no
   wildcard or ops origin is configured;
5. application headers survive proxying on API responses;
6. the exact `/__csp-report` path is proxied to Node with an edge body cap at
   or below 16 KiB, a bounded request rate, and no request-body/query logging;
   the same tested CSP report-only policy is added to Nginx-served SPA
   HTML/static responses, because the current Nginx serves `client/dist`
   directly and an API-response CSP does not govern the document;
7. login, API, downloads/uploads, onboarding images, Web Serial scanner and
   `/socket.io/` work without CSP violations that indicate a required asset;
8. only after the complete HTTPS checks, both HSTS gates are enabled and the
   resulting header is verified on product HTTPS responses. Edge HSTS policy
   must stay equivalent and must not add subdomains/preload in this slice.

No CSP report body, callback URL, query string, Authorization/cookie/session
value, operator token or personal data belongs in rollout evidence or logs.

## Scope and rollback

This slice changes no cookie, session, CSRF, Origin-validation, auth, tenant,
provider/worker, schema, OpenAPI, generated-client, dependency or onboarding
contract. The bounded discard receiver is not an OpenAPI/product endpoint.
Rollback returns CSP to the last safe report-only policy or disables the
explicit HSTS gate; it must preserve the exact product-origin allowlist and
framing/referrer/nosniff controls.
