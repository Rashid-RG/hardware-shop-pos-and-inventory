# Security policy

RS Nextward — ARS Distributors

## Supported versions

The current 1.0.0 shop-opening pilot is under development. No commercial release or guaranteed security-support window has been declared. Security fixes target the active development branch until an approved release policy exists.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting option if enabled, or contact the repository owner through an established private support channel. Do not publish exploit details, credentials, personal data, database dumps or recovery keys in a public issue. If no private channel is available, request one without including vulnerability details.

Include the affected commit/version, operating system, a concise impact description, sanitized reproduction steps and relevant redacted logs. Use a disposable test environment; do not access another installation or modify operational data without authorization.

The maintainer will assess the report, investigate and coordinate remediation and disclosure. No response-time guarantee is implied.

## Operational safeguards

- Keep database credentials, JWT secrets, SMTP credentials, cloud credentials and signing keys outside Git.
- Use unique administrator credentials and least-privilege staff roles.
- Retain verified backups of PostgreSQL and uploaded files; test restoration in isolation.
- Verify signed update manifests against an independently provisioned trust key.
- Never bypass a maintenance hold or restore over an operational database as a test.
- Do not treat a passing CI run as approval for commercial activation.

See [V1.0 acceptance](docs/v1-shop-opening-acceptance.md) for release gates.
