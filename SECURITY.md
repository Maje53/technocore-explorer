# Security Policy

## Scope

Technocore Explorer is a read-only viewer and verifier. It must never accept, transmit, or store private keys, seed phrases, wallet credentials, passphrases, or service tokens.

## Reporting

Please do not publish exploit details or sensitive data in a public issue. Contact the repository owner privately through their GitHub profile and include a minimal reproduction, impact assessment, and affected version.

## Safe contribution rules

- Never commit `.env` files, PEM files, keys, credentials, captured authorization headers, or real identity material.
- Use synthetic test vectors only.
- Do not add write, signing, wallet, or identity-import features without a dedicated threat model and maintainer review.
- Treat all room names, API responses, DIDs, message text, proof files, URLs, and contribution metadata as untrusted input.
- Keep network destinations allowlisted. The room proxy must contact only the configured Technocore HTTPS origin.
- Run `npm audit --omit=dev` and `npm run build` before submitting a change.

## Supported versions

Only the currently deployed version and the default branch receive security updates.
