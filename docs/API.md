# API

Base path: `/api/v1` · OpenAPI: `/docs`

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | — | Admin login → access + refresh JWT |
| POST | `/auth/refresh` | — | Rotate tokens |
| GET | `/auth/me` | Bearer | Current admin |

Default seed: `admin@example.com` / `admin123!`

## Employees

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/employees` | Bearer |
| PATCH | `/employees/{id}` | Bearer |

## Devices & enrollment

| Method | Path | Auth |
|--------|------|------|
| GET | `/devices` | Bearer |
| PATCH | `/devices/{id}` | Bearer (authorization / employee) |
| POST/GET | `/enrollment-tokens` | Bearer |
| POST | `/devices/enroll` | enrollment token body |
| POST | `/devices/heartbeat` | HTTP Basic `client_id:client_secret` |

## Monitoring

| Method | Path | Auth |
|--------|------|------|
| GET | `/overview` | Bearer |
| POST | `/screenshots` | Device Basic (multipart file) |
| GET | `/screenshots` | Bearer |
| GET | `/screenshots/{id}/image` | Bearer |
| POST | `/activity/events` | Device Basic |
| GET | `/activity/stats` | Bearer |

## Retention & storage

| Method | Path | Auth |
|--------|------|------|
| GET/PUT | `/retention` | Bearer |
| GET | `/retention/cleanup-status` | Bearer |
| POST | `/retention/cleanup` | Bearer |
| GET | `/storage/analytics` | Bearer |

## MFA

| Method | Path | Auth |
|--------|------|------|
| POST | `/auth/mfa/setup` | Bearer |
| POST | `/auth/mfa/enable` | Bearer |
| POST | `/auth/mfa/disable` | Bearer |

Login accepts optional `mfa_code`. If MFA is enabled and code is missing, response is `{ "mfa_required": true }`.

## Health

`GET /health`

Rate limit: ~120 requests/minute per IP. Screenshot image views are audit-logged.
