# Third-party notices

This project installs test tooling through the root `package-lock.json` and browser UI dependencies through `svelte-frontend/package-lock.json`; their own licenses govern those packages.

- Playwright Core is used only by the isolated local recording-preflight command and is Apache-2.0-licensed. It is not bundled into the deployed browser artifact.
- Svelte, SvelteKit, and Vite are MIT-licensed.
- Lucide is distributed under the ISC License.
- The `@wornpage/*` UI packages used here are public MIT-licensed repositories. Their GitHub archive URLs are pinned to immutable 40-character commits in `svelte-frontend/package.json` and locked with integrity metadata in `svelte-frontend/package-lock.json`.

No third-party package source is copied into this repository. A clean install retrieves the declared versions, and `node_modules` is excluded from publication.

The complete Lucide/Feather, Svelte/SvelteKit, and Wornpage notices required by the bundled browser artifact are in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). The build copies that file into `dist/static-publish`.
