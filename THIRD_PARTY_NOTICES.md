# Third-party notices

This project installs Worker runtime dependencies and test tooling through the root `package-lock.json` and browser UI dependencies through `svelte-frontend/package-lock.json`; their own licenses govern those packages.

- Playwright Core is Apache-2.0-licensed and is used by local browser smoke tests and verification checks. It is not bundled into the deployed browser artifact.
- Acorn 8.19.0 is MIT-licensed and parses generated JavaScript in the Worker before source admission. Its complete notice is retained in `THIRD_PARTY_LICENSES.txt`.
- parse5 8.0.1 is MIT-licensed and parses generated HTML in the Worker. Its bundled entities 8.0.0 dependency is BSD-2-Clause-licensed. Both complete notices are retained in `THIRD_PARTY_LICENSES.txt`.
- clsx 2.1.1 is MIT-licensed and included through the Svelte client runtime. Its complete notice is retained in `THIRD_PARTY_LICENSES.txt`.
- jsdiff (`diff`) 9.0.0 is BSD-3-Clause-licensed and provides bounded, local request text comparisons in the browser. Its complete license is retained in `THIRD_PARTY_LICENSES.txt`.
- Svelte, SvelteKit, and Vite are MIT-licensed.
- SvelteKit's `devalue` and `esm-env` dependencies are MIT-licensed; their notices are retained with the browser distribution.
- Lucide is distributed under the ISC License.
- The `@wornpage/*` UI packages declare MIT in their package metadata. Their GitHub archive URLs are pinned to immutable 40-character commits in `svelte-frontend/package.json` and locked with integrity metadata in `svelte-frontend/package-lock.json`. The pinned `@wornpage/button` archive has no license file; its seven `src/` files match the public components monorepo commit identified in `THIRD_PARTY_LICENSES.txt`, whose root MIT notice is retained there. Verify the final built artifact uses only those matched source files.

No third-party package source is copied into this repository. A clean install retrieves the declared versions, and `node_modules` is excluded from publication.

The retained Lucide/Feather, Svelte/SvelteKit, Wornpage, and other dependency notices are in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). The build copies that file into `dist/static-publish`.
