import {
  ArrowRight,
  ArrowUp,
  Check,
  Cloud,
  Download,
  FileDown,
  Globe,
  Heart,
  Home,
  Link2,
  Monitor,
  Plus,
  Server,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { SexIcon } from './SexIcon';
import { TreePreview } from './TreePreview';
import type { Tree } from './model';

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
  onRemoveTree: (tree: Tree) => void;
}) {
  const showHero = libraryState === 'ready' && library.length === 0;
  const LibraryHeading = showHero ? 'h2' : 'h1';
  return (
    <div className={`home${showHero ? '' : ' home-workspace'}`}>
      <header id="top" className="site-header" tabIndex={-1}>
        <div className="brand">
          <BrandMark />
          <span>
            GENEalogical<span className="brand-three">3</span>
          </span>
        </div>
        <nav>
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <button className="button light" aria-label="Import a tree" onClick={onImportTree}>
            <Upload size={15} /> Import a tree
          </button>
        </nav>
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
                <button className="button primary large" onClick={onCreateTree}>
                  Start a family tree <ArrowRight size={18} />
                </button>
                <span>No account needed.</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
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
        <section className="library-section" aria-labelledby="library-heading">
          <div className="section-intro">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <LibraryHeading id="library-heading">Your family trees</LibraryHeading>
            </div>
            <div className="library-actions">
              {!showHero && (
                <button className="button outline" onClick={onImportTree}>
                  <Upload size={17} /> Import
                </button>
              )}
              <button
                className={`button ${showHero ? 'outline' : 'primary'}`}
                onClick={onCreateTree}
              >
                <Plus size={17} /> New tree
              </button>
            </div>
          </div>
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
          ) : library.length ? (
            <div className="tree-grid">
              {library.map((item) => (
                <div className="tree-tile" key={item.id}>
                  <button
                    className="tree-open"
                    aria-label={`Open ${item.name}`}
                    onClick={() => onOpenTree(item.id)}
                  >
                    <TreePreview tree={item} />
                    <strong title={item.name}>{item.name}</strong>
                    {item.homePersonId !== null && (
                      <span className="library-home">
                        <Home size={13} aria-hidden="true" />
                        <span>
                          Home:{' '}
                          {item.people.find((p) => p.id === item.homePersonId)?.name ||
                            'Unnamed person'}
                        </span>
                      </span>
                    )}
                    <span>
                      {item.people.length} {item.people.length === 1 ? 'person' : 'people'} · Edited{' '}
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                    <span className="open-cue">
                      Open tree <ArrowRight size={15} />
                    </span>
                  </button>
                  <div className="tree-tile-tools">
                    <button
                      aria-label={`Duplicate ${item.name}`}
                      title="Duplicate"
                      disabled={duplicatingTreeId !== null}
                      onClick={() => onDuplicateTree(item)}
                    >
                      {duplicatingTreeId === item.id ? 'Duplicating…' : 'Duplicate'}
                    </button>
                    <button
                      aria-label={`Rename ${item.name}`}
                      title="Rename"
                      onClick={() => onRenameTree(item)}
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete ${item.name}`}
                      title="Delete"
                      onClick={() => onRemoveTree(item)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-library">
              <div className="empty-icon">
                <Users size={31} />
              </div>
              <div>
                <strong>Your first story starts here.</strong>
                <p>Create a tree to start adding the people who matter.</p>
              </div>
              <button className="button primary" onClick={onCreateTree}>
                Create your first tree <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
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
                Your tree stays in this browser. Download a JSON backup or export a PNG to share
                with family.
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
                  <p>Save or open a tree directly with Google Drive.</p>
                </div>
                <div className="privacy-endpoint privacy-endpoint-optional privacy-detail privacy-detail-connections">
                  <Cloud size={28} aria-hidden="true" />
                  <h4>Outside this browser</h4>
                  <p>Cloud copies are optional. Nothing uploads automatically.</p>
                  <ul>
                    <li>
                      <Cloud size={17} aria-hidden="true" />
                      <div>
                        <strong>Your Google Drive, if you use it</strong>
                        <p>
                          Sign in with Google. Access is limited to files used with this app.
                          Authorization stays in browser memory; Google stores any tree you choose
                          to save.
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
                <h3>Our servers deliver the app. Your tree stays with you.</h3>
                <p>
                  Family details and Drive transfers aren't sent to a GENEalogical3 backend. We
                  can't look up your tree or recover a lost local copy.
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
        <span>&copy; 2026 Jorge Hernandez</span>
        <a className="back-to-top" href="#top">
          Back to top <ArrowUp size={14} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
