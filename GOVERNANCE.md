# Governance

## Branches and reviews

`main` receives reviewed pull requests. Runtime, data, asset, CI, schema, security, and rights changes receive CODEOWNERS review. Documentation and templates use the normal review path. Direct pushes, force pushes, and branch deletion are disabled.

The required CI checks are:

- `Validate project / Static data/docs validation`
- `Validate project / Chromium smoke suite`

The deploy job consumes the artifact produced by those checks. A pull request needs one approving review and both listed checks before it can merge. Stale approvals are dismissed when new commits arrive.

## Releases

Each public release records the data version, source date when available, validation commands, and known coverage boundaries. A release tag and GitHub release note identify a completed release; work in progress stays under `Unreleased`.

## Data decisions

Reviewers compare corrections against the same version of the affected data. Stable IDs, explicit units, and reproducible evidence keep updates easy to audit. A disputed entry remains in its current state until the evidence is resolved.

## Contributor terms

The repository does not currently require a separate DCO or CLA. Contributors are responsible for the code and documentation they submit and for identifying third-party material. Any future change to these terms will update this document and the pull request template together.
