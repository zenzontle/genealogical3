import {
  ArrowRight,
  ArrowUp,
  Check,
  Cloud,
  Download,
  FileDown,
  Github,
  Globe,
  Heart,
  Link2,
  Monitor,
  Plus,
  Server,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { HeroBranches } from './HeroBranches';
import { SexIcon } from './SexIcon';
import { WorkspaceCard } from './WorkspaceCard';
import { workspaceEntries, type WorkspaceEntry } from './workspaceEntries';
import type { DriveFile } from './drive';
import type { DriveLink } from './storage';
import type { Tree } from './model';
import type { ReactNode } from 'react';
import type { SyncView } from './driveSync';

const heroPeople = [
  { name: 'Eleanor', dates: '1924 — 2008', sex: 'female', position: 'art-one' },
  { name: 'James', dates: '1920 — 1996', sex: 'male', position: 'art-two' },
  { name: 'Margaret', dates: '1952 —', sex: 'female', position: 'art-three' },
  { name: 'Samuel', dates: '1981 —', sex: 'male', position: 'art-four' },
] as const;

export function HomeScreen({
  library,
  libraryState,
  onRetryLibrary,
  duplicatingTreeId,
  onDuplicateTree,
  onCreateTree,
  onImportTree,
  onOpenTree,
  onRenameTree,
  onRemoveTree,
  importBusy = false,
  driveFiles = [],
  driveLinks = [],
  driveLoading = false,
  driveError = '',
  driveConfigured = false,
  driveConnected = false,
  driveBusy = false,
  driveControls,
  onRetryDrive = () => {},
  onRestoreDrive = () => {},
  syncViews,
  onReviewConflict,
  onRetrySync,
}: {
  library: Tree[];
  libraryState: 'loading' | 'ready' | 'error';
  onRetryLibrary: () => void;
  duplicatingTreeId: string | null;
  onDuplicateTree: (tree: Tree) => void;
  onCreateTree: () => void;
  onImportTree: () => void;
  onOpenTree: (id: string) => void;
  onRenameTree: (tree: Tree) => void;
  onRemoveTree: (entry: WorkspaceEntry) => void;
  importBusy?: boolean;
  driveFiles?: DriveFile[];
  driveLinks?: DriveLink[];
  driveLoading?: boolean;
  driveError?: string;
  driveConfigured?: boolean;
  driveConnected?: boolean;
  driveBusy?: boolean;
  driveControls?: ReactNode;
  onRetryDrive?: () => void;
  onRestoreDrive?: (file: DriveFile) => void;
  syncViews?: Record<string, SyncView>;
  onReviewConflict?: (id: string) => void;
  onRetrySync?: (id: string) => void;
}) {
  const entries = workspaceEntries(library, driveLinks, driveFiles);
  const showHero = libraryState === 'ready' && entries.length === 0 && !driveLoading && !driveError;
  return (
    <div className={`home${showHero ? '' : ' home-workspace'}`}>
      <header id="top" className="site-header" tabIndex={-1}>
        <div className="brand">
          <BrandMark />
          <span>
            GENEalogical<span className="brand-three">3</span>
          </span>
        </div>
        <div className="site-header-actions">
          <nav>
            <a href="#how-it-works">How it works</a>
            <a href="#privacy">Privacy</a>
          </nav>
          {showHero && driveControls && <div className="header-drive-controls">{driveControls}</div>}
        </div>
      </header>
      <main>
        {showHero && (
          <div className="hero">
            <div className="hero-copy">
              <h1>
                Every family has
                <br />
                a story worth
                <br />
                <em>keeping.</em>
              </h1>
              <p>
                Gather the names, faces, and connections that make your family yours. Build at your
                own pace, right here in your browser.
              </p>
              <div className="hero-actions">
                <div className="hero-buttons">
                  <button
                    className="button primary large"
                    data-dialog-fallback
                    disabled={importBusy}
                    onClick={onCreateTree}
                  >
                    Start a family tree <ArrowRight size={18} />
                  </button>
                  <button
                    className="button outline large"
                    disabled={importBusy}
                    onClick={onImportTree}
                  >
                    <Upload size={18} aria-hidden="true" /> Import a tree
                  </button>
                </div>
                <span>No account needed.</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <HeroBranches />
              <div className="hero-leaf leaf-one">✻</div>
              <div className="hero-leaf leaf-two">✻</div>
              <div className="hero-tree">
                <svg className="hero-connectors" width="440" height="540" viewBox="0 0 440 540">
                  <path className="hero-parent-line" d="M220 88V206M220 342V390" />
                  <path className="hero-partner-line" d="M200 88H240" />
                  <Heart className="hero-partner-heart" x={211} y={79} size={18} />
                </svg>
                {heroPeople.map(({ name, dates, sex, position }) => (
                  <div className={`person-card art-card ${position}`} key={name}>
                    <div className="person-avatar">
                      <span>{name[0]}</span>
                    </div>
                    <div className="person-info">
                      <strong>{name}</strong>
                      <span>{dates}</span>
                    </div>
                    <span className={`person-sex sex-${sex}`}>
                      <SexIcon sex={sex} size={16} />
                    </span>
                  </div>
                ))}
              </div>
              <div className="art-caption">One connection at a time.</div>
            </div>
          </div>
        )}
        {!showHero && (
          <section className="library-section" aria-labelledby="library-heading">
            <div className="section-intro">
              <div>
                {entries.length > 0 && <p className="eyebrow">YOUR WORKSPACE</p>}
                <h1 id="library-heading" tabIndex={-1} data-dialog-fallback>
                  Your family trees
                </h1>
              </div>
              <div className="library-actions">
                <button className="button outline" disabled={importBusy} onClick={onImportTree}>
                  <Upload size={17} /> Import
                </button>
                <button className="button primary" disabled={importBusy} onClick={onCreateTree}>
                  <Plus size={17} /> New tree
                </button>
              </div>
            </div>
            {driveConfigured && driveControls}
            {driveError && (
              <div className="workspace-drive-status" role="alert">
                <p>{driveError}</p>
                <button className="button outline" onClick={onRetryDrive}>
                  Retry
                </button>
              </div>
            )}
            {libraryState === 'loading' ? (
              <div className="library-status" role="status" aria-busy="true">
                Loading your family trees…
              </div>
            ) : libraryState === 'error' ? (
              <div className="library-status" role="alert">
                <p>Your family trees could not be loaded from this browser.</p>
                <button className="button outline" onClick={onRetryLibrary}>
                  Retry
                </button>
              </div>
            ) : null}
            <div className="tree-grid">
              {entries.map((entry) => (
                <WorkspaceCard
                  key={entry.kind === 'local' ? `local-${entry.tree.id}` : `drive-${entry.file.id}`}
                  entry={entry}
                  busy={importBusy || (entry.kind === 'drive' && driveBusy)}
                  duplicatingTreeId={duplicatingTreeId}
                  driveConnected={driveConnected}
                  onOpenTree={onOpenTree}
                  onRestore={onRestoreDrive}
                  onDuplicateTree={onDuplicateTree}
                  onRenameTree={onRenameTree}
                  onRemoveTree={onRemoveTree}
                  syncView={entry.kind === 'local' ? syncViews?.[entry.tree.id] : undefined}
                  onReviewConflict={onReviewConflict}
                  onRetrySync={onRetrySync}
                />
              ))}
            </div>
          </section>
        )}
        <section id="how-it-works" className="how-section">
          <h2>Simple to start. Yours to keep.</h2>
          <div className="how-grid">
            <div>
              <span className="how-icon how-icon-peach">
                <Users size={27} />
              </span>
              <h3>Make it yours</h3>
              <p>
                Add names, dates, photos, and the little notes that make a person more than a name
                on a page.
              </p>
            </div>
            <div>
              <span className="how-icon how-icon-sage">
                <Link2 size={27} />
              </span>
              <h3>See how you connect</h3>
              <p>
                Draw the lines between generations. Move things around until your family story feels
                right.
              </p>
            </div>
            <div>
              <span className="how-icon how-icon-lilac">
                <Download size={27} />
              </span>
              <h3>Save and share</h3>
              <p>
                Your edits save in this browser. Download a JSON backup, export a PNG to share with
                family, or choose Save to Drive for a cloud copy.
              </p>
            </div>
          </div>
        </section>
        <section id="privacy" className="privacy-section" aria-labelledby="privacy-heading">
          <div className="privacy-content">
            <div className="privacy-intro">
              <span className="privacy-icon" aria-hidden="true">
                <ShieldCheck size={27} />
              </span>
              <div>
                <h2 id="privacy-heading">
                  Private by default.
                  <br />
                  <span>Your family history on your device.</span>
                </h2>
                <p>
                  Build your tree, add portraits, and connect generations right in your browser.
                  Your work is saved here, with no GENEalogical3 account and no family tree database
                  on our servers.
                </p>
              </div>
            </div>
            <div className="privacy-details">
              <div className="privacy-details-intro">
                <h3>Where your data lives.</h3>
                <p>Local by default, with optional connections you control.</p>
              </div>
              <div className="privacy-flow">
                <div className="privacy-endpoint privacy-detail">
                  <Monitor size={28} aria-hidden="true" />
                  <h4>This browser</h4>
                  <p>Editing, portraits, and autosave all happen on your device.</p>
                  <ul>
                    <li>
                      <Check size={17} aria-hidden="true" />
                      <div>
                        <strong>Your family details</strong>
                        <p>
                          Names, dates, relationships, notes, and portraits stay in this browser's
                          storage unless you export or save to Drive.
                        </p>
                      </div>
                    </li>
                    <li>
                      <Check size={17} aria-hidden="true" />
                      <div>
                        <strong>Your downloaded backups</strong>
                        <p>
                          The app doesn't upload or sync your downloads. Where you keep them and who
                          you share them with is up to you.
                        </p>
                      </div>
                    </li>
                  </ul>
                </div>
                <div className="privacy-connection">
                  <div className="privacy-connection-line" aria-hidden="true">
                    <ArrowRight size={20} />
                  </div>
                  <strong>Only when you choose</strong>
                  <p>
                    Connect to see Drive trees in Workspace. Linked backups sync after data edits.
                    Opening a Drive-only card or choosing Use Drive version downloads its contents.
                    Older links are compared with their backups before sync begins.
                  </p>
                </div>
                <div className="privacy-endpoint privacy-endpoint-optional privacy-detail privacy-detail-connections">
                  <Cloud size={28} aria-hidden="true" />
                  <h4>Outside this browser</h4>
                  <p>
                    Cloud backups are optional. Linked trees sync automatically after data edits.
                  </p>
                  <ul>
                    <li>
                      <Cloud size={17} aria-hidden="true" />
                      <div>
                        <strong>Your Google Drive, if you use it</strong>
                        <p>
                          Connect Google Drive to see its trees in Workspace. Opening a linked tree
                          resumes your local edits. To download again, duplicate local edits for
                          safekeeping, delete the linked local copy, and reopen the remaining Drive
                          card. Access is limited to files used with this app. A secure cookie
                          remembers this browser's connection for up to 30 days, including refreshes
                          and browser restarts. Google may require you to reconnect sooner.
                        </p>
                        <p>
                          Disconnect Drive forgets this browser's connection without deleting files
                          or revoking Google's permission.
                        </p>
                      </div>
                    </li>
                    <li>
                      <Globe size={17} aria-hidden="true" />
                      <div>
                        <strong>Loading the website and fonts</strong>
                        <p>
                          The site host and Google Fonts receive ordinary web requests, including
                          your IP address. These requests don't include your family tree.
                        </p>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="privacy-server-note">
              <Server size={22} aria-hidden="true" />
              <div>
                <h3>Your tree stays with you.</h3>
                <p>
                  Our servers deliver the app and renew your Google Drive access. Family details and
                  tree files aren't sent to our servers. We can't look up your tree or recover a
                  lost local copy.
                </p>
              </div>
            </div>
            <div className="privacy-backup">
              <div className="privacy-backup-copy">
                <FileDown size={27} aria-hidden="true" />
                <div>
                  <h3>A backup you can hold on to.</h3>
                  <p>
                    Clearing browser data can remove your local tree. Download a JSON backup before
                    clearing data or moving to another browser or device.
                  </p>
                </div>
              </div>
              <dl className="privacy-export-types">
                <div>
                  <dt>JSON backup</dt>
                  <dd>Your editable tree, notes, and portraits.</dd>
                </div>
                <div>
                  <dt>PNG snapshot</dt>
                  <dd>A picture to share, not an editable backup.</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </main>
      <footer>
        <div className="footer-brand">
          <BrandMark small />
          <span>GENEalogical3</span>
        </div>
        <span>&copy; 2026 {import.meta.env.PUBLIC_DEVELOPER_NAME}</span>
        <a className="repository-link" href="/privacy-policy">
          Privacy policy
        </a>
        <a className="repository-link" href="/terms-of-service">
          Terms of service
        </a>
        <a
          className="repository-link"
          href={import.meta.env.PUBLIC_REPOSITORY_URL}
          aria-label="GitHub repository"
        >
          <Github size={17} aria-hidden="true" /> GitHub
        </a>
        <a className="back-to-top" href="#top">
          Back to top <ArrowUp size={14} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
