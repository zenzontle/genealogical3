# GENEalogical3

A private, browser-first family tree editor built with React, TypeScript, Vite, and XYFlow. The interface and PNG snapshots use a dark theme with sage and copper accents.

## Run locally

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL Vite prints. `pnpm build` checks TypeScript and creates a production build; `pnpm test` runs document and relationship validation tests.

The project uses pnpm 12.6.0, pinned in `package.json`, and `pnpm-lock.yaml` for reproducible dependency versions. Use Node.js 22.13 or newer and enable Corepack as shown above, or install the pinned pnpm version directly. When adding or updating dependencies, use `pnpm add` or `pnpm update` and commit the updated lockfile. `pnpm-workspace.yaml` allows esbuild's install script, which Vite needs.

### Dependency audit

The October 1, 2026 npm audit reported no high or critical findings. Vitest and its mocker have a moderate [path traversal advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). These are development dependencies; the test command runs in batch mode and does not expose a test server, and they are excluded from the production bundle. A major test-runner upgrade is deferred pending compatibility testing. Review this deferral by November 1, 2026, and do not expose a Vitest server to untrusted networks.

## Google Drive setup

The editor works without Google configuration. To enable explicit Drive save/open:

1. Create a Google Cloud project, enable the Google Drive API, and configure the OAuth consent screen.
2. Create an OAuth **Web application** client and add each served origin to Authorized JavaScript origins, including your local development origin and production origin.
3. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to that web client ID. Restart Vite.
4. Complete Google's consent publishing or test-user setup for the accounts that will use Drive.

The app requests only `https://www.googleapis.com/auth/drive.file`. It uses Google Identity Services in the browser; tokens are kept in memory and no client secret or user data is sent to an app backend. Drive operations are explicit. Opening a Drive tree makes a separate local working copy; saving to the same Drive file requires confirmation.

Google's OAuth project and consent screen cannot be provisioned by this codebase. A live Drive round trip requires that project configuration and credentials.

## Data and backups

Trees are stored in IndexedDB on the current browser and origin. Clearing browser data can remove them. Download JSON backups regularly, especially before changing browsers or devices. JSON carries all editable data and processed portraits. PNG is a visual snapshot and does not include notes or editability.

The portable JSON format is versioned (`version: 2`); version 1 backups remain importable. Its document has a tree ID and name, people with stable IDs, optional fields and positions, an optional home designation (`homePersonId`, stored as a person ID or `null`), directed parent relationships, symmetric partner relationships, unassigned connections with their original handles, and viewport coordinates. Older backups and local trees without a home field open with no designation. Drive metadata and authorization stay outside the portable document.

Person details store separate first and last names; cards and exports show the combined name. Older full names open with the first word in First name and the remaining words in Last name, which you can adjust for compound names. Existing display names are preserved until edited. Relationships in the sidebar start collapsed for each person. Expand them to edit links; married partners show Wife, Husband, or Spouse based on recorded sex, with ex qualifiers for former marriages. Choose **Married** under **Union type** to establish a spouse relationship.

**Add person** places the new card in the center of the current canvas view, preserving pan and zoom. Relative buttons place new cards next to the selected relative. Selecting a card reveals a delete icon beside it; deleting uses the same confirmation and undo history as the sidebar action.

Cards center a compact portrait above the full name, giving each text line the full card width and growing taller as needed. PNG snapshots use the same arrangement and also wrap complete names. Moving cards automatically connects partners from the facing left/right sides and parents/children from the facing top/bottom sides. Shared sibling bars follow the measured card sizes and support children above or below their parents; children on both sides use separate bars. Unassigned connections retain their chosen handles.

## Home person and kinship

Select a person and choose **Set as home person** to mark whom the tree is about. Each tree can have one home person or none. Setting someone else replaces the designation; **Clear home person** removes it. These actions support undo/redo. Deleting home clears the designation along with their relationships, and undo restores both. Setting home leaves the canvas position and selection unchanged; opening a tree keeps the existing viewport behavior.

Cards, person details, and PNG snapshots show each person's relationship to home, including ancestors, descendants, siblings, aunts/uncles, nieces/nephews, and cousins with removals. Terms use recorded sex when known and neutral terms otherwise. Labels are calculated from current links rather than stored, so editing connections, sex, or home refreshes them automatically.

Biological, adoptive, and unspecified parent links establish family kinship. Recorded paths in details disclose every parent type; family labels do not assert biological ancestry or full versus half siblings. Step, guardian, and mixed partner paths remain explicit. Direct partners use spouse terms only when recorded as married, with former/ex qualifiers when recorded. Unassigned links do not establish kinship, and people without a typed path show **Relationship not established**.

The closest relationship uses the fewest recorded links. Equally short paths can show alternative labels in details; longer ties are not calculated. Up to five representative paths are retained per person, prioritizing distinct labels, and details disclose when additional shortest paths are omitted. This bounds calculation in highly interconnected trees. Home markers and labels are carried through JSON backups, local saves, and Drive copies; PNG exports include the marker, primary labels, and home name.

Birth and death edits stay in a temporary draft while incomplete or invalid. A death cannot precede birth; when only a year is known, validation preserves that uncertainty. Valid pairs are committed together, while autosave and exports use the last valid dates. Drafts survive selecting another person in the current editor session but are not saved or exported.

Top/bottom connector drags infer a Parent / Child relationship, with the bottom-handled person as the parent. Side-to-side drags infer Partner. Other handle combinations create an unassigned link. Selecting a person or a link lets users assign or change its relationship; the combined Parent / Child option has a separate parent selector to set ancestry direction. Ancestry cycles, self-links, and duplicates are still rejected. Canvas and PNG links use a plain line for Parent / Child, a red heart for Partner, or Not set for unassigned links, while relationship details remain editable in the panel.

When two or more children have the same two recorded parents and those parents have a Partner link, the canvas and PNG snapshot automatically show a shared sibling bar descending from the partner connector. Biological, adoptive, and unspecified parent links qualify; step, guardian, and additional-parent relationships retain individual paths. Cards stay where you place them, and the bar follows dragging. Click a child branch, or focus it and press Enter or Space, to edit that child's individual parent relationships. Removing a qualifying link updates the grouping, including through undo/redo. Partner links and adding a child never imply an unrecorded second parent.
