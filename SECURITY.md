# Security policy

## Private reports

Email [itsestrella71@gmail.com](mailto:itsestrella71@gmail.com?subject=Random%20Dice%202%20security%20report) with the affected commit, reproduction steps, a minimal proof of concept, and the impact. Remove credentials, tokens, cookies, and personal data before sending.

## Scope

Random Dice 2 Lab is a public, read-only static site. It has no account, payment, or user-data service. The security scope covers the repository, build scripts, published assets, and Pages workflow.

JSON that enters a rendered view passes schema checks and the relevant escaping or allowlist path. Local test servers bind to loopback and serve only the generated site.

Security fixes run the data, staging, and browser checks that cover the affected path. The report records any production or deployment check that still needs manual review.
