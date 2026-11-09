# Development

## Dev server

`pnpm dev` listens on `127.0.0.1` only. To reach it from another device on a trusted network, opt in explicitly. This also exposes the `/api/drive-auth/*` routes to that network:

```sh
pnpm exec vite --host 0.0.0.0
```

## Adding public pages

Add a standalone HTML file, such as `about.html` or `about/index.html`. Vite discovers HTML pages at startup and builds each one, so restart `pnpm dev` after adding one. Don't create both forms for the same URL; duplicate routes stop the build.

- Clean URLs work everywhere: `about.html` and `about/index.html` both serve `/about`.
- Each page gets a canonical link generated from `PUBLIC_APP_URL`. Don't add your own.
- Discovery skips hidden paths, `node_modules`, `dist`, `coverage`, `public`, `src`, `server`, `api`, and `scripts`. Files in `public` are copied unchanged instead.

## Browser tests

`pnpm test` runs Vitest with jsdom. Workflows that depend on IndexedDB, downloads, canvas or layout run in a real browser with [Playwright](https://playwright.dev) under `e2e/`:

```sh
pnpm exec playwright install chromium
pnpm e2e
```

- Install the browser once per Playwright version. Install scripts are disabled, so `pnpm install` doesn't download it. On Linux, add `--with-deps` to install system libraries.
- `pnpm e2e` builds the app and serves it with `vite preview` on port 4173. It never reuses a server already running there, so stop any other preview on that port first. The build it starts leaves Drive unconfigured, even if `.env` sets a client ID.
- Specs run on desktop Chromium and a mobile Chromium project (`mobile.spec.ts` only).
- Debug with `pnpm e2e --ui` or `pnpm e2e --headed`. CI uploads `playwright-report/` and `test-results/` when the job fails, with a trace for each failed test; open a trace with `pnpm exec playwright show-trace <trace.zip>`.

## Linting and formatting

- `pnpm lint` allows warnings locally, but CI runs `eslint . --max-warnings 0`, so warnings fail pull requests.
- ESLint uses the recommended JavaScript, TypeScript, and React Refresh rules, the two core React Hooks rules (`rules-of-hooks`, `exhaustive-deps`), and `react/no-multi-comp` (one component per file). React Compiler rules and type-aware lint rules are off; `tsc -b` checks types.
- Prettier is pinned to an exact version. `.prettierrc.json` sets single quotes, a 100-column width, and CRLF line endings. Use the project's Prettier in your editor.
- `.gitattributes` checks out text files with CRLF on every platform; Git stores LF.

## Dependencies

Use `pnpm add` or `pnpm update`, and commit the updated `pnpm-lock.yaml`.

`pnpm-workspace.yaml` enforces [pnpm's supply chain protections](https://pnpm.io/supply-chain-security): a seven-day minimum release age, no exotic transitive dependencies, no trust downgrades, and no install scripts except for packages approved in `allowBuilds`. CI installs with `--ignore-scripts`.

- `trustPolicyExclude` lists exact versions without provenance; its comment records when they were verified and when to review them.

If a dependency is blocked, review its release metadata, provenance, and install scripts before adding an exception. Limit exceptions to exact versions with a comment giving the reason, never disable a protection globally, and commit policy and lockfile changes together.

Run `pnpm audit` before releases; the supply chain policy doesn't check for known vulnerabilities.
