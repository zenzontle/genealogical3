# GENEalogical3

A private, browser-first family tree editor built with React, TypeScript, Vite, and XYFlow. Trees are stored in your browser, with optional backup and automatic sync to Google Drive.

## Your data

- Trees autosave to IndexedDB in the current browser. Clearing site data removes them, so download JSON backups regularly. JSON backups contain all editable data and portraits; PNG exports are only a picture.
- The JSON format is versioned. Version 1, 2, and 3 backups all import.
- Drive backups live in a `genealogical3` folder in My Drive, one document plus a `.photos` folder per tree. Don't put personal files in `.photos` folders: deleting a backup permanently deletes its photos folder, including files you added manually.

## Run locally

Requires Node.js 22.13 or newer. pnpm is pinned in `package.json` and enabled through Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The editor works without any configuration. Google Drive needs OAuth credentials; see [deployment](docs/deployment.md).

| Script                              | What it does                                  |
| ----------------------------------- | --------------------------------------------- |
| `pnpm dev`                          | Start the Vite development server             |
| `pnpm build`                        | Typecheck (`tsc -b`) and build for production |
| `pnpm test`                         | Run the Vitest suite                          |
| `pnpm lint` / `pnpm lint:fix`       | Check or fix ESLint rules                     |
| `pnpm format` / `pnpm format:check` | Format or check formatting with Prettier      |

## Project structure

```text
src/
  app/          Application composition and integration tests
  components/   React UI components and their tests
  hooks/        React hooks and their tests
  lib/          Tree models, layout, storage, Drive, and other shared logic
  styles/       Application stylesheets
  test/         Shared test helpers
  toaster/      Toast notifications
  main.tsx      Browser entry point
  vite-env.d.ts Vite environment types
server/         Server-side Drive authentication and its tests
api/            Vercel API route entry points
scripts/
  public-pages/ Public HTML discovery, identity rendering, and their tests
public/         Static assets copied unchanged
```

Tests sit beside the code they exercise. Public HTML pages (`index.html`, `privacy-policy/index.html`, `terms-of-service/index.html`) sit at their URL paths.

## More docs

- [Deployment](docs/deployment.md): environment variables, Google Drive OAuth, Vercel, and the public privacy and terms pages.
- [Development](docs/development.md): dev server safety, adding public pages, linting and formatting, and dependency policy.
- [Review guide](REVIEW.md): what reviewers flag on pull requests.
