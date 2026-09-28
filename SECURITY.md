# Security

## Supported surface

This repository builds one static challenge application. It has no server function, database, authentication system, payment endpoint, secret, or production API.

## Reporting

Please report a suspected vulnerability privately through GitHub's security-advisory interface for this repository. Do not include secrets or personal data in a public issue.

## Deployment posture

- Cloudflare Pages serves only the generated static files.
- Security and crawler headers are defined in `svelte-frontend/static/_headers`.
- Route HTML carries a restrictive Content Security Policy.
- Sample mutations are browser-local and can be reset by clearing site storage.
- Country blocking is intentionally not part of the application: it could block judges and does not protect publicly licensed source.
