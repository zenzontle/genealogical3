import {
  ArrowRight,
  Check,
  Download,
  Home,
  Link2,
  Plus,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import type { Tree } from './model';

export function HomeScreen({
  library,
  onCreateTree,
  onImportTree,
  onOpenTree,
  onRenameTree,
  onRemoveTree,
}: {
  library: Tree[];
  onCreateTree: () => void;
  onImportTree: () => void;
  onOpenTree: (id: string) => void;
  onRenameTree: (tree: Tree) => void;
  onRemoveTree: (tree: Tree) => void;
}) {
  return (
    <div className="home">
      <header className="site-header">
        <div className="brand">
          <BrandMark />
          <span>
            GENEalogical<span className="brand-three">3</span>
          </span>
        </div>
        <nav>
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <button className="button light" onClick={onImportTree}>
            <Upload size={15} /> Import a tree
          </button>
        </nav>
      </header>
      <main>
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow with-line">A PLACE FOR YOUR PEOPLE</div>
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
              <span>No account needed. Your story stays yours.</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-leaf leaf-one">✻</div>
            <div className="hero-leaf leaf-two">✻</div>
            <div className="art-line line-one" />
            <div className="art-line line-two" />
            <div className="art-card art-one">
              <span className="art-avatar sage">E</span>
              <div>
                <b>Eleanor</b>
                <small>1924 — 2008</small>
              </div>
            </div>
            <div className="art-card art-two">
              <span className="art-avatar peach">J</span>
              <div>
                <b>James</b>
                <small>1920 — 1996</small>
              </div>
            </div>
            <div className="art-card art-three">
              <span className="art-avatar cream">M</span>
              <div>
                <b>Margaret</b>
                <small>1952 —</small>
              </div>
            </div>
            <div className="art-card art-four">
              <span className="art-avatar blue">S</span>
              <div>
                <b>Samuel</b>
                <small>1981 —</small>
              </div>
            </div>
            <div className="art-caption">One connection at a time.</div>
          </div>
        </div>
        <section className="library-section">
          <div className="section-intro">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h2>Your family trees</h2>
            </div>
            <button className="button outline" onClick={onCreateTree}>
              <Plus size={17} /> New tree
            </button>
          </div>
          {library.length ? (
            <div className="tree-grid">
              {library.map((item) => (
                <div className="tree-tile" key={item.id}>
                  <button className="tree-open" onClick={() => onOpenTree(item.id)}>
                    <div className="tree-tile-icon">
                      <Users size={27} />
                    </div>
                    <strong>{item.name}</strong>
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
          <p className="eyebrow">MADE FOR REAL FAMILIES</p>
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
        <section id="privacy" className="privacy-section">
          <div className="privacy-intro">
            <span className="privacy-icon">
              <ShieldCheck size={27} />
            </span>
            <div>
              <p className="eyebrow">YOUR FAMILY STORY STAYS YOURS</p>
              <h2>
                Private by default.
                <br />
                <span>Clear about every connection.</span>
              </h2>
              <p>
                Your tree is saved in this browser. GENEalogical3 has no account system or app
                database, so we can’t view or retrieve your family details.
              </p>
            </div>
          </div>
          <div className="privacy-steps">
            <div className="privacy-card">
              <div className="privacy-card-heading">
                <span>01</span>
                <h3>Your device</h3>
              </div>
              <p>Edit people and photos. Autosave keeps the tree in this browser’s storage.</p>
              <small>
                <Check size={17} /> GENEalogical3 can’t see it
              </small>
            </div>
            <div className="privacy-card">
              <div className="privacy-card-heading">
                <span>02</span>
                <h3>Your choice</h3>
              </div>
              <p>
                Export an editable JSON backup or a PNG image, or connect Google Drive when you want
                a cloud copy.
              </p>
              <small>
                <Check size={17} /> Nothing uploads by default
              </small>
            </div>
            <div className="privacy-card">
              <div className="privacy-card-heading">
                <span>03</span>
                <h3>Google Drive, if connected</h3>
              </div>
              <p>
                GENEalogical3 sends the tree only when you choose Drive save. Google stores that
                copy under your account.
              </p>
              <small>
                <ShieldCheck size={17} /> App-created files only
              </small>
            </div>
          </div>
          <p className="privacy-note">
            <ShieldCheck size={20} /> GENEalogical3 does not store family trees, portraits, or
            profile data on its own servers. Browser storage stays on this device; clearing browser
            data removes that local copy.
          </p>
        </section>
      </main>
      <footer>
        <div className="footer-brand">
          <BrandMark small />
          <span>GENEalogical3</span>
        </div>
        <span>Made for the stories that connect us.</span>
      </footer>
    </div>
  );
}
