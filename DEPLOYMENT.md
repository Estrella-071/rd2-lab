# Deployment

Random Dice 2 Lab is published at [rd2-lab.pages.dev](https://rd2-lab.pages.dev/) through Cloudflare Pages. Pages Functions and the `rd2-lab-shares` D1 database provide six-character planning links.

## Local preview

Install the locked toolchain, apply the local D1 migrations, and start the Pages runtime:

```bash
npm ci
npm run d1:migrate:local
npm run pages:dev
```

Wrangler serves the generated `.pages/` files together with `functions/`. The `_routes.json` contract sends `/api/*` requests through Pages Functions while static requests stay on the asset path.

## Release flow

1. Run `npm run validate`.
2. Run `npm run generate:locales -- --source <source-table-dir>` and `npm run check:translations`.
3. Run `npm run build:pages`.
4. Run `npm run check:staging`, `npm run check:performance`, and the relevant browser suites.
5. Apply pending D1 migrations with `npm run d1:migrate:remote`.
6. Deploy the verified artifact:

   ```bash
   npm run pages:deploy -- --branch main --commit-hash <commit-sha> --commit-dirty=false
   ```

7. Check the permanent Pages URL and create, open, and remove one test share.

`site/runtime-allowlist.json` defines the deployment files. `runtime-manifest.json` records the generated artifact. Browser and performance evidence stays under the ignored `artifacts/` directory.

The allowlist includes `site/data/locales.json`. A deployment with an invalid
or incomplete four-locale catalog fails application bootstrap and is caught by
the translation and staging checks before publication.

GitHub Actions runs the repository checks and browser suites. A maintainer publishes the validated artifact with the pinned Wrangler version.

## D1 share storage

The D1 binding and migration directory are declared in [`wrangler.jsonc`](wrangler.jsonc). The API accepts Base62 payloads up to 4096 characters and reuses the stored code when the payload already exists. Links use stable numeric node IDs, so data-file ordering can change without redirecting saved ranks or team entries.

## Rollback

Choose the previous healthy production deployment in the Cloudflare Pages dashboard and use its rollback action. Reapply forward migrations before the next release when the target source expects a newer schema.

## Release checks

Confirm the permanent URL, canonical link, D1 binding, `/api/*` route scope, response headers, required GitHub status checks, branch protection, and CODEOWNERS.
