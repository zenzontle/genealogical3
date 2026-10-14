import { driveContent } from './driveContent';
import {
  DriveConflictError,
  DriveRequestError,
  getDriveConnection,
  getDriveGeneration,
  inspectDriveTreeLocked,
  queueDriveOperation,
  restoreDriveTreeLocked,
  saveDriveTreeLocked,
  subscribeDriveConnection,
  restoreDrive,
  type DriveSaveResult,
  type DriveFile,
  type ProgressCallback,
} from './drive';
import {
  getTree,
  getDriveLink,
  listTrees,
  listDriveLinks,
  updateLinkedTree,
  getLastDriveAttempt,
  setLastDriveAttempt,
  type DriveLink,
  type SyncConflict,
} from './storage';
import type { Tree } from './model';

export type SyncStatus =
  'pending' | 'syncing' | 'synced' | 'waiting for connection' | 'retrying' | 'needs attention';
export type SyncView = {
  status: SyncStatus;
  pending: boolean;
  error?: string;
  warning?: string;
  conflict?: SyncConflict;
  link: DriveLink;
};
export const retryableDriveError = (error: unknown): error is DriveRequestError =>
  error instanceof DriveRequestError && error.retryable;
export const driveRetryDelay = (retry: number, retryAfter = 0, random = Math.random()) =>
  Math.max(Math.min(10_000 * 2 ** retry + random * 1000, 64_000), retryAfter);

const dependencies = {
  getTree,
  getDriveLink,
  listTrees,
  listDriveLinks,
  updateLinkedTree,
  getLastDriveAttempt,
  setLastDriveAttempt,
  connection: getDriveConnection,
  generation: getDriveGeneration,
  lock: queueDriveOperation,
  inspect: inspectDriveTreeLocked,
  restore: restoreDriveTreeLocked,
  save: saveDriveTreeLocked,
  online: () => navigator.onLine,
  now: () => Date.now(),
};
type Dependencies = typeof dependencies;
type Attempt = { wait: number } | { result?: DriveSaveResult };

/** One app-level queue. Durable records are re-read inside the shared Drive operation lock. */
export class DriveSyncCoordinator {
  private views: Record<string, SyncView> = {};
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private activeId?: string;
  private edits = new Map<string, number>();
  private refreshId = 0;
  private disposed = false;
  constructor(private d: Dependencies = dependencies) {}
  snapshot = () => this.views;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.listeners.forEach((listener) => listener());
  }
  noteEdit(id: string, timestamp: number) {
    if (!this.views[id]) return;
    if (this.edits.get(id) === timestamp) return;
    this.edits.set(id, timestamp);
    const view = this.views[id];
    if (view) {
      this.views = {
        ...this.views,
        [id]: {
          ...view,
          pending: true,
          conflict: view.conflict ? { ...view.conflict, localDataUpdatedAt: timestamp } : undefined,
          status: view.conflict || view.error ? 'needs attention' : 'pending',
        },
      };
      this.publish();
    }
  }
  hasPending = () =>
    Object.entries(this.views).some(([id, view]) => view.pending || this.edits.has(id));
  async refresh(bypassDebounce = false) {
    const request = ++this.refreshId;
    const [trees, links] = await Promise.all([this.d.listTrees(), this.d.listDriveLinks()]);
    if (request !== this.refreshId || this.disposed) return;
    const byId = new Map(trees.map((tree) => [tree.id, tree]));
    const next: Record<string, SyncView> = {};
    let earliest = Infinity;
    for (const link of links) {
      const tree = byId.get(link.treeId);
      if (!tree) continue;
      const sync = link.sync;
      if (this.edits.get(tree.id) === tree.dataUpdatedAt) this.edits.delete(tree.id);
      const unacknowledged =
        sync?.pending || sync?.acknowledgedDataUpdatedAt !== tree.dataUpdatedAt;
      const pending = unacknowledged || !sync?.revision;
      const attention =
        sync?.attention ||
        (link.restoreWarnings?.length
          ? 'This local copy has missing portraits. Duplicate it in Workspace for safekeeping and download the backup again.'
          : undefined);
      const available =
        this.d.online() &&
        (this.d.connection() === 'connected' ||
          (this.d.connection() === 'error' && !!sync?.retryAt));
      const status: SyncStatus =
        this.activeId === tree.id
          ? 'syncing'
          : attention || sync?.conflict
            ? 'needs attention'
            : !pending && !this.edits.has(tree.id)
              ? 'synced'
              : !available
                ? 'waiting for connection'
                : sync?.retryAt && sync.retryAt > this.d.now()
                  ? 'retrying'
                  : 'pending';
      next[tree.id] = {
        status,
        pending: !!unacknowledged || this.edits.has(tree.id),
        error: attention,
        warning: link.cleanupWarnings?.join(' '),
        conflict: sync?.conflict
          ? { ...sync.conflict, localDataUpdatedAt: this.edits.get(tree.id) ?? tree.dataUpdatedAt }
          : undefined,
        link,
      };
      if (pending && available && !attention && !sync?.conflict && !this.edits.has(tree.id)) {
        earliest = Math.min(
          earliest,
          Math.max(sync?.retryAt || 0, bypassDebounce ? 0 : (sync?.editedAt || 0) + 3000),
        );
      }
    }
    this.views = next;
    this.publish();
    if (this.timer) clearTimeout(this.timer);
    if (!this.running && earliest !== Infinity)
      this.timer = setTimeout(
        () => {
          void this.pump(bypassDebounce).catch(() => undefined);
        },
        Math.max(0, earliest - this.d.now()),
      );
  }
  private async acknowledge(
    id: string,
    linkId: string,
    timestamp: number,
    revision: string,
    generation: number,
    file?: DriveFile & { cleanupWarnings?: string[] },
  ) {
    await this.d.updateLinkedTree(id, (tree, link) => {
      if (generation !== this.d.generation())
        throw Error('Drive connection changed. Your changes remain pending.');
      if (!tree || link?.id !== linkId) return {};
      return {
        link: {
          ...link,
          ...(file
            ? {
                name: file.name,
                description: file.description,
                modifiedTime: file.modifiedTime,
                cleanupWarnings: file.cleanupWarnings ?? link.cleanupWarnings,
              }
            : {}),
          sync: {
            acknowledgedDataUpdatedAt: timestamp,
            revision,
            pending: tree.dataUpdatedAt !== timestamp,
            editedAt: link.sync?.editedAt,
          },
        },
      };
    });
  }
  private async conflict(
    id: string,
    linkId: string,
    local: Tree,
    remote: { tree: Tree; revision: string },
    generation: number,
  ) {
    await this.d.updateLinkedTree(id, (_tree, link) =>
      link?.id === linkId && generation === this.d.generation()
        ? {
            link: {
              ...link,
              sync: {
                ...link.sync,
                pending: true,
                attention: undefined,
                conflict: {
                  localDataUpdatedAt: local.dataUpdatedAt,
                  remoteDataUpdatedAt: remote.tree.dataUpdatedAt,
                  revision: remote.revision,
                },
              },
            },
          }
        : {},
    );
  }
  private async attempt(
    id: string,
    manual: boolean,
    bypassDebounce: boolean,
    progress?: ProgressCallback,
    reviewed?: SyncConflict,
    expectedBackupId?: string | null,
  ): Promise<Attempt> {
    const generation = this.d.generation();
    return this.d.lock(generation, async () => {
      const tree = await this.d.getTree(id),
        link = await this.d.getDriveLink(id);
      if (!tree || (!link && !manual)) return {};
      if ((expectedBackupId && link?.id !== expectedBackupId) || (reviewed && !link))
        throw Error(
          'The Drive association changed or its backup was deleted. Reopen the tree in Workspace before saving.',
        );
      if (
        !this.d.online() ||
        (this.d.connection() !== 'connected' &&
          !(this.d.connection() === 'error' && link?.sync?.retryAt))
      )
        return {};
      if (link?.restoreWarnings?.length)
        throw Error(
          'Missing portraits require attention. Duplicate local edits in Workspace for safekeeping.',
        );
      if (link?.sync?.conflict && !reviewed) return {};
      if (link?.sync?.attention && !manual) return {};
      if (
        !reviewed &&
        link?.sync?.revision &&
        !link.sync.pending &&
        link.sync.acknowledgedDataUpdatedAt === tree.dataUpdatedAt
      )
        return {};
      if (this.edits.has(id)) return { wait: 450 };
      const due = Math.max(
        (await this.d.getLastDriveAttempt()) + 10_000,
        link?.sync?.retryAt || 0,
        manual || bypassDebounce ? 0 : (link?.sync?.editedAt || 0) + 3000,
      );
      if (due > this.d.now()) return { wait: due - this.d.now() };
      await this.d.setLastDriveAttempt(this.d.now());
      this.activeId = id;
      await this.refresh();
      let baseline = link?.sync?.revision;
      let saved: DriveSaveResult | undefined;
      try {
        const content = await driveContent(tree);
        if (link) {
          const remote = await this.d.inspect(link.id, generation);
          const upload = link.sync?.upload;
          if (upload && remote.revision === upload.revision && remote.content === upload.content) {
            await this.acknowledge(
              id,
              link.id,
              upload.dataUpdatedAt,
              remote.revision,
              generation,
              remote.file,
            );
            return {};
          }
          if (reviewed) {
            if (
              reviewed.localDataUpdatedAt !== tree.dataUpdatedAt ||
              reviewed.revision !== remote.revision
            ) {
              await this.conflict(id, link.id, tree, remote, generation);
              return {};
            }
            baseline = reviewed.revision;
          } else if (!baseline) {
            // Old links require a complete download before adopting a baseline.
            const restored = await this.d.restore(link.id, generation);
            if (restored.restoreWarnings.length || !restored.revision)
              throw Error(
                'This backup is incomplete or uses an unsupported legacy format. Review it in Workspace.',
              );
            if (restored.revision !== remote.revision) throw new DriveConflictError();
            if (remote.content === content) {
              await this.acknowledge(
                id,
                link.id,
                tree.dataUpdatedAt,
                remote.revision,
                generation,
                remote.file,
              );
              return {};
            }
            await this.conflict(id, link.id, tree, remote, generation);
            return {};
          }
          if (remote.revision !== baseline) {
            await this.conflict(id, link.id, tree, remote, generation);
            return {};
          }
        }
        const priorUpload = link?.sync?.upload;
        const revision =
          priorUpload?.dataUpdatedAt === tree.dataUpdatedAt && priorUpload.content === content
            ? priorUpload.revision
            : crypto.randomUUID();
        if (link)
          await this.d.updateLinkedTree(id, (_current, fresh) =>
            fresh?.id === link.id
              ? {
                  link: {
                    ...fresh,
                    sync: {
                      ...fresh.sync,
                      pending: true,
                      upload: { revision, dataUpdatedAt: tree.dataUpdatedAt, content },
                    },
                  },
                }
              : {},
          );
        const result = await this.d.save(tree, generation, link?.id, progress, {
          expectedRevision: baseline,
          revision,
          beforeReplace: reviewed
            ? async () => {
                const latest = await this.d.getTree(id);
                if (latest?.dataUpdatedAt !== reviewed.localDataUpdatedAt || this.edits.has(id))
                  throw new DriveConflictError();
              }
            : undefined,
        });
        saved = result;
        if (generation !== this.d.generation()) throw Error('Drive connection changed.');
        if (link)
          await this.acknowledge(
            id,
            link.id,
            tree.dataUpdatedAt,
            result.revision,
            generation,
            result,
          );
        else
          await this.d.updateLinkedTree(id, (current, fresh) => {
            if (generation !== this.d.generation())
              throw Error('Drive connection changed. Retry in the intended account.');
            return current && !fresh
              ? {
                  link: {
                    treeId: id,
                    id: result.id,
                    name: result.name,
                    description: result.description,
                    modifiedTime: result.modifiedTime,
                    cleanupWarnings: result.cleanupWarnings,
                    sync: {
                      acknowledgedDataUpdatedAt: tree.dataUpdatedAt,
                      revision: result.revision,
                      pending: current.dataUpdatedAt !== tree.dataUpdatedAt,
                      editedAt: this.d.now(),
                    },
                  },
                }
              : {};
          });
        return { result };
      } catch (error) {
        let failure = error;
        if (!link && saved && generation === this.d.generation())
          throw Error(
            [
              `Saved to Google Drive as ${saved.description || saved.name}, but this browser could not remember the file link. Open its Google Drive card in Workspace next time.`,
              ...saved.cleanupWarnings,
            ].join(' '),
            { cause: error },
          );
        if (link && generation === this.d.generation()) {
          let recordedConflict = false;
          if (error instanceof DriveConflictError) {
            try {
              const remote = await this.d.inspect(link.id, generation);
              const latest = await this.d.getTree(id);
              if (latest) await this.conflict(id, link.id, latest, remote, generation);
              recordedConflict = true;
            } catch (refreshError) {
              failure = refreshError;
            }
          }
          if (!recordedConflict)
            await this.d.updateLinkedTree(id, (current, fresh) => {
              if (fresh?.id !== link.id || generation !== this.d.generation()) return {};
              const retries = (fresh.sync?.retries || 0) + 1;
              const retryError = retryableDriveError(failure) ? failure : undefined;
              const retry = !!retryError && retries <= 6;
              return {
                link: {
                  ...fresh,
                  sync: {
                    ...fresh.sync,
                    pending:
                      fresh.sync?.pending ||
                      fresh.sync?.acknowledgedDataUpdatedAt !== current?.dataUpdatedAt,
                    retries,
                    retryable: !!retryError,
                    retryAt: retry
                      ? this.d.now() + driveRetryDelay(retries - 1, retryError?.retryAfter)
                      : undefined,
                    attention: retry
                      ? undefined
                      : failure instanceof Error
                        ? failure.message
                        : 'Drive sync failed. Retry to continue.',
                  },
                },
              };
            });
        }
        if (manual) throw failure;
        return {};
      } finally {
        this.activeId = undefined;
      }
    });
  }
  private async pump(bypass = false) {
    if (this.running || this.disposed) return;
    this.running = true;
    let delay = Infinity;
    try {
      for (const [id, view] of Object.entries(this.views)) {
        if (view.status !== 'pending' && view.status !== 'retrying') continue;
        const outcome = await this.attempt(id, false, bypass);
        if ('wait' in outcome) delay = Math.min(delay, outcome.wait);
      }
    } finally {
      this.running = false;
      await this.refresh();
      if (delay !== Infinity) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          void this.pump(bypass).catch(() => undefined);
        }, delay);
      }
    }
  }
  async manualSave(
    id: string,
    progress?: ProgressCallback,
    reviewed?: SyncConflict,
    expectedBackupId?: string | null,
  ) {
    const generation = this.d.generation();
    const intendedBackup =
      expectedBackupId === undefined ? (await this.d.getDriveLink(id))?.id : expectedBackupId;
    for (;;) {
      if (!this.d.online() || this.d.connection() !== 'connected')
        throw Error('Connect Drive and go online to sync. Your local changes remain saved.');
      if (generation !== this.d.generation())
        throw Error('Drive connection changed. Retry in the intended account.');
      const outcome = await this.attempt(
        id,
        true,
        true,
        progress,
        reviewed,
        intendedBackup,
      ).finally(() => this.refresh());
      if ('wait' in outcome) {
        await new Promise((resolve) => setTimeout(resolve, outcome.wait));
        continue;
      }
      return outcome.result;
    }
  }
  async retry(id?: string, recovery = false) {
    for (const link of await this.d.listDriveLinks()) {
      if (id && link.treeId !== id) continue;
      if (link.sync?.conflict || link.restoreWarnings?.length) continue;
      if (recovery && link.sync?.attention && !link.sync.retryable) continue;
      await this.d.updateLinkedTree(link.treeId, (_tree, fresh) =>
        fresh?.id === link.id
          ? { link: { ...fresh, sync: { ...fresh.sync, retries: 0, attention: undefined } } }
          : {},
      );
    }
    await this.refresh();
  }
  async useDrive(id: string, reviewed: SyncConflict): Promise<Tree | undefined> {
    const generation = this.d.generation();
    const result = await this.d.lock(generation, async () => {
      if (!this.d.online() || this.d.connection() !== 'connected')
        throw Error(
          'Connect Drive and go online before using the Drive version. Your local tree is unchanged.',
        );
      const link = await this.d.getDriveLink(id),
        tree = await this.d.getTree(id);
      if (!link || !tree) return;
      const remote = await this.d.inspect(link.id, generation);
      if (
        tree.dataUpdatedAt !== reviewed.localDataUpdatedAt ||
        remote.revision !== reviewed.revision
      ) {
        await this.conflict(id, link.id, tree, remote, generation);
        return;
      }
      const restored = await this.d.restore(link.id, generation);
      if (restored.restoreWarnings.length || !restored.revision)
        throw Error('The Drive download is incomplete. Your local tree is unchanged.');
      const freshRemote = await this.d.inspect(link.id, generation);
      if (freshRemote.revision !== reviewed.revision || restored.revision !== reviewed.revision) {
        await this.conflict(id, link.id, tree, freshRemote, generation);
        return;
      }
      if (generation !== this.d.generation())
        throw Error('Drive connection changed. Your local tree is unchanged.');
      let replacement: Tree | undefined;
      await this.d.updateLinkedTree(id, (latest, fresh) => {
        if (generation !== this.d.generation())
          throw Error('Drive connection changed. Your local tree is unchanged.');
        if (!latest || fresh?.id !== link.id) return {};
        if (latest.dataUpdatedAt !== reviewed.localDataUpdatedAt || this.edits.has(id))
          return {
            link: {
              ...fresh,
              sync: {
                ...fresh.sync,
                conflict: { ...reviewed, localDataUpdatedAt: latest.dataUpdatedAt },
              },
            },
          };
        replacement = { ...restored.tree, id, viewport: latest.viewport };
        return {
          tree: replacement,
          link: {
            ...fresh,
            name: freshRemote.file.name,
            description: freshRemote.file.description,
            modifiedTime: freshRemote.file.modifiedTime,
            restoreWarnings: [],
            sync: {
              acknowledgedDataUpdatedAt: replacement.dataUpdatedAt,
              revision: restored.revision,
              pending: false,
            },
          },
        };
      });
      return replacement;
    });
    await this.refresh();
    return result;
  }
  start() {
    this.disposed = false;
    const refresh = () => {
      void this.refresh().catch(() => undefined);
    };
    const channel =
      typeof window.BroadcastChannel === 'function'
        ? new window.BroadcastChannel('genealogical3-drive-sync')
        : null;
    if (channel)
      channel.onmessage = () => {
        window.dispatchEvent(new Event('tree-storage-refreshed'));
        refresh();
      };
    const changed = () => {
      channel?.postMessage('changed');
      refresh();
    };
    const resume = () => {
      void (async () => {
        if (this.d.connection() === 'error') await restoreDrive();
        await this.retry(undefined, true);
      })().catch(() => undefined);
    };
    let connection = this.d.connection();
    const unsubscribe = subscribeDriveConnection(() => {
      const next = this.d.connection();
      if (next === 'connected' && connection !== next) resume();
      else refresh();
      connection = next;
    });
    window.addEventListener('tree-storage-changed', changed);
    window.addEventListener('online', resume);
    window.addEventListener('offline', refresh);
    refresh();
    return () => {
      this.disposed = true;
      ++this.refreshId;
      if (this.timer) clearTimeout(this.timer);
      channel?.close();
      unsubscribe();
      window.removeEventListener('tree-storage-changed', changed);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', refresh);
    };
  }
  flush = () => this.refresh(true);
}
export const driveSync = new DriveSyncCoordinator();
