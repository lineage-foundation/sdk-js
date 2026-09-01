# Publishing

`@lineage-foundation/sdk-js` is published to npm when a GitHub Release is
published, via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC) with build provenance. No `NODE_AUTH_TOKEN` is stored in the repository.

- Package: **`@lineage-foundation/sdk-js`** (public, scoped to the
  `lineage-foundation` npm organization)
- Version source of truth: `version` in `package.json`

## One-time npm setup

On npm, under the `lineage-foundation` organization:

1. **Trusted publisher.** Configure a trusted publisher for the package
   (npm → package/org *Settings* → *Trusted Publishing*) pointing at:
   - Repository: `lineage-foundation/sdk-js`
   - Workflow: `.github/workflows/publish.yml`
   - Environment: `npm`

   npm's Trusted Publishing is configured on an existing package. If the
   package does not exist yet, do the **first** publish once with a granular
   automation token (locally: `npm publish --access public`, or temporarily add
   a `NODE_AUTH_TOKEN` secret to the workflow), then register the trusted
   publisher so every subsequent release is tokenless.
2. In GitHub → repo *Settings → Environments*, create an environment named
   `npm` (optionally require a reviewer to approve each publish).

Trusted Publishing requires npm >= 11.5.1; the workflow upgrades npm before
publishing.

## Cutting a release

1. Bump `version` in `package.json` (and update any changelog).
2. Merge to `main`.
3. Create a GitHub Release for that version, e.g. `v2.0.0`.
4. Publishing the Release triggers `.github/workflows/publish.yml`, which runs
   `npm ci`, `npm run build`, and `npm publish --provenance --access public`.

## Local build check (no publish)

```bash
npm ci
npm run build
npm publish --dry-run
```
