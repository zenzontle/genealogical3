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

### Formatting

Run `pnpm format` to format the project or `pnpm format:check` to check formatting without changing files. Prettier is pinned to an exact version, and `.prettierrc.json` defines single quotes, a 100-column print width, and CRLF line endings. Two-space indentation, semicolons, and trailing commas use Prettier's defaults. Generated output and the pnpm lockfile are excluded via `.prettierignore`.

For editor formatting, enable the Prettier integration in your editor and use the project's local version and configuration.

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

New trees remain temporary until their first edit, such as adding a person or changing the tree name. Panning, zooming, or returning to the library leaves an untouched draft unsaved. After the first edit, trees autosave to IndexedDB on the current browser and origin. Clearing browser data can remove them. Download JSON backups regularly, especially before changing browsers or devices. JSON carries all editable data and processed portraits. PNG is a visual snapshot and does not include notes or editability.

The portable JSON format is versioned (`version: 2`); version 1 backups remain importable. Its document has a tree ID and name, people with stable IDs, optional fields and positions, an optional home designation (`homePersonId`, stored as a person ID or `null`), directed parent relationships, symmetric partner relationships, unassigned connections with their original handles, and viewport coordinates. Older backups and local trees without a home field open with no designation. Drive metadata and authorization stay outside the portable document.

Person details store separate first and last names; cards and exports show the combined name. Older full names open with the first word in First name and the remaining words in Last name, which you can adjust for compound names. Existing display names are preserved until edited. Relationships in the sidebar start collapsed for each person. Expand them to edit links; married partners show Wife, Husband, or Spouse based on recorded sex, with ex qualifiers for former marriages. Choose **Married** under **Union type** to establish a spouse relationship.

**Add person** places the new card in the center of the current canvas view, preserving pan and zoom. Relative buttons place new cards next to the selected relative. Hold Shift and click cards to select a group, then drag any selected card to move the group. Group moves save together and use one undo/redo step. Selecting a card reveals a delete icon beside it; deleting uses the same confirmation and undo history as the sidebar action. Connector dots fade in within 80 screen pixels of a card and become fully visible on hover or keyboard focus; touch devices keep them visible.

Cards stay at 180 × 136 pixels, with a compact portrait, up to two lines for the name, and rows for nickname, life dates, and kinship when available. Longer names end with an ellipsis; hover to read the full name or open person details. Sex appears in the top-right corner, and age is omitted from cards. The home person uses a house icon in the top-left corner, with its label available on hover and to screen readers. PNG snapshots use the same fixed dimensions and truncate long names to two lines. Moving cards automatically connects partners from the facing left/right sides and parents/children from the facing top/bottom sides. Shared sibling bars follow the measured card sizes and support children above or below their parents; children on both sides use separate bars. Unassigned connections retain their chosen handles.

Use the sidebar toggle at the top right of the editor to collapse or expand the details panel and give the canvas more room. Collapsing preserves the current selection and edits. If you leave the sidebar expanded, selecting and unselecting cards keeps it expanded. If you collapse it, selecting a card temporarily expands it, and unselecting restores the collapsed state. Relationship selection follows the same behavior. On mobile, the details menu button opens and closes the panel with the same selection behavior.

## Home person and kinship

Select a person and choose **Set as home person** to mark whom the tree is about. Each tree can have one home person or none. Setting someone else replaces the designation; **Clear home person** removes it. These actions support undo/redo. Deleting home clears the designation along with their relationships, and undo restores both. Setting home leaves the canvas position and selection unchanged; opening a tree keeps the existing viewport behavior.

Cards, person details, and PNG snapshots show each person's relationship to home, including ancestors, descendants, siblings, aunts/uncles, nieces/nephews, and cousins with removals. Terms use recorded sex when known and neutral terms otherwise. Labels are calculated from current links rather than stored, so editing connections, sex, or home refreshes them automatically.

Biological, adoptive, and unspecified parent links establish family kinship. Recorded paths in details disclose every parent type; family labels do not assert biological ancestry or full versus half siblings. Step, guardian, and mixed partner paths remain explicit. Direct partners use spouse terms only when recorded as married, with former/ex qualifiers when recorded. Unassigned links do not establish kinship. People without a typed path show **Relationship not established** only in person details; their cards and PNG snapshots omit the label.

The closest relationship uses the fewest recorded links. Equally short paths can show alternative labels in details; longer ties are not calculated. Up to five representative paths are retained per person, prioritizing distinct labels, and details disclose when additional shortest paths are omitted. This bounds calculation in highly interconnected trees. Home markers and labels are carried through JSON backups, local saves, and Drive copies; PNG exports include the marker, primary labels, and home name.

Choose **Living** or **Deceased** under **Status** in person details. Only Deceased shows the **Died** date options, including Unknown. New people and older records without a death date prompt for status; older records with a death date show Deceased. Deceased people without a known death date show Deceased on cards and PNG snapshots, without a current-age estimate. Choosing Living clears the death date; undo restores the previous status and date. Explicit status is saved in local trees, JSON backups, and Drive copies.

Birth, death, and status edits stay in a temporary draft while dates are incomplete or invalid. A death cannot precede birth; when only a year is known, validation preserves that uncertainty. Valid changes are committed together, while autosave and exports use the last valid values. Drafts survive selecting another person in the current editor session but are not saved or exported.

Top/bottom connector drags infer a Parent / Child relationship, with the bottom-handled person as the parent. Side-to-side drags infer Partner. Other handle combinations create an unassigned link. Selecting a person or a link lets users assign or change its relationship; the combined Parent / Child option has a separate parent selector to set ancestry direction. Ancestry cycles, self-links, and duplicates are still rejected. Canvas and PNG links use a plain line for Parent / Child, a red heart for Partner, or Not set for unassigned links, while relationship details remain editable in the panel.

When a child has two recorded parents and those parents have a Partner link, the canvas and PNG snapshot show one connection from the partner connector to the child. Multiple children of the same couple share a sibling bar. Biological, adoptive, and unspecified parent links qualify; step, guardian, and additional-parent relationships retain individual paths. Cards stay where you place them, and the connector follows dragging. Click a child branch, or focus it and press Enter or Space, to edit that child's individual parent relationships. Removing a qualifying link updates the grouping, including through undo/redo. Partner links and adding a child never imply an unrecorded second parent.
