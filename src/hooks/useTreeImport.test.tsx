// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTreeImport } from './useTreeImport';
import { saveTree } from '../lib/storage';
import { makeTree } from '../lib/model';

vi.mock('../lib/storage', () => ({ saveTree: vi.fn() }));
vi.mock('../lib/feedback', async (original) => ({
  ...(await original<typeof import('../lib/feedback')>()),
  afterPaint: () => Promise.resolve(),
}));
const jsonFile = (text: string) =>
  Object.assign(new File([text], 'tree.json', { type: 'application/json' }), {
    text: vi.fn().mockResolvedValue(text),
  });
beforeEach(() => {
  vi.mocked(saveTree).mockReset().mockResolvedValue('saved');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('JSON import feedback and recovery', () => {
  it('gives an independent imported copy fresh, equal timestamps without changing its source', async () => {
    const source = { ...makeTree('Source'), updatedAt: 50, dataUpdatedAt: 60 };
    const before = structuredClone(source);
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const saved = vi.fn();
    const { result } = renderHook(() => useTreeImport(saved, vi.fn().mockResolvedValue(undefined)));
    await act(() => result.current.run(jsonFile(JSON.stringify(source))));
    const copy = vi.mocked(saveTree).mock.calls[0][0];
    expect(copy).toEqual({
      ...source,
      id: copy.id,
      name: 'Source (imported)',
      updatedAt: 100,
      dataUpdatedAt: 100,
    });
    expect(copy.id).not.toBe(source.id);
    expect(source).toEqual(before);
    expect(saved).toHaveBeenCalledWith(copy);
  });
  it('allows retrying a file read failure before validation', async () => {
    const file = jsonFile(JSON.stringify(makeTree('Family')));
    file.text.mockRejectedValueOnce(Error('Could not read file.'));
    const { result } = renderHook(() =>
      useTreeImport(vi.fn(), vi.fn().mockResolvedValue(undefined)),
    );
    await act(() => result.current.run(file));
    expect(result.current.canRetry).toBe(true);
    expect(saveTree).not.toHaveBeenCalled();
    await act(() => result.current.run());
    expect(result.current.feedback.status).toBe('success');
  });
  it('rejects malformed, oversized, and invalid tree files without saving', async () => {
    const files = [jsonFile('{broken'), jsonFile('{}'), jsonFile(JSON.stringify(makeTree()))];
    Object.defineProperty(files[2], 'size', { value: 30_000_001 });
    const { result } = renderHook(() => useTreeImport(vi.fn(), vi.fn()));
    for (const file of files) {
      await act(() => result.current.run(file));
      expect(result.current.feedback.status).toBe('error');
      expect(result.current.canRetry).toBe(false);
    }
    expect(saveTree).not.toHaveBeenCalled();
  });

  it('reuses the generated tree ID after a failed save', async () => {
    vi.mocked(saveTree).mockRejectedValueOnce(Error('Storage full.')).mockResolvedValue('saved');
    const saved = vi.fn(),
      refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTreeImport(saved, refresh));
    const file = jsonFile(JSON.stringify(makeTree('Family')));
    await act(() => result.current.run(file));
    expect(result.current.canRetry).toBe(true);
    const firstId = vi.mocked(saveTree).mock.calls[0][0].id;
    await act(() => result.current.run());
    expect(vi.mocked(saveTree).mock.calls[1][0].id).toBe(firstId);
    expect(file.text).toHaveBeenCalledOnce();
    expect(result.current.importedId).toBe(firstId);
    expect(result.current.feedback).toEqual({
      status: 'success',
      message: 'Imported Family (imported).',
    });
  });

  it('retries only library refresh after persistence succeeds, without another saved copy', async () => {
    const saved = vi.fn(),
      refresh = vi
        .fn()
        .mockRejectedValueOnce(Error('Library unavailable.'))
        .mockResolvedValue(undefined);
    const { result } = renderHook(() => useTreeImport(saved, refresh));
    await act(() => result.current.run(jsonFile(JSON.stringify(makeTree('Family')))));
    expect(saved).toHaveBeenCalledOnce();
    expect(result.current.feedback.status).toBe('error');
    await act(() => result.current.run());
    expect(saveTree).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.feedback.status).toBe('success');
  });

  it('shows pending state and ignores repeated file submissions', async () => {
    let resolve!: (text: string) => void;
    const file = jsonFile('');
    file.text.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() =>
      useTreeImport(vi.fn(), vi.fn().mockResolvedValue(undefined)),
    );
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.run(file);
      await Promise.resolve();
    });
    expect(result.current.feedback).toEqual({ status: 'pending', message: 'Reading file…' });
    await act(() => result.current.run(file));
    expect(file.text).toHaveBeenCalledOnce();
    await act(async () => {
      resolve(JSON.stringify(makeTree()));
      await first;
    });
    expect(saveTree).toHaveBeenCalledOnce();
  });
});

describe('GEDCOM import', () => {
  const gedcomFile = (lines: string[], name = 'Smith family.ged') => {
    const bytes = new TextEncoder().encode(lines.join('\n'));
    return Object.assign(new File([bytes], name), {
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      text: vi.fn(),
    });
  };
  const family = [
    '0 HEAD',
    '1 CHAR UTF-8',
    '0 @I1@ INDI',
    '1 NAME Ann /Smith/',
    '1 FAMS @F1@',
    '0 @I2@ INDI',
    '1 NAME Bo /Smith/',
    '1 FAMC @F1@',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 CHIL @I2@',
  ];

  it('saves a converted tree named after the file and summarizes it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const saved = vi.fn();
    const { result } = renderHook(() => useTreeImport(saved, vi.fn().mockResolvedValue(undefined)));
    const file = gedcomFile([...family, '0 TRLR']);
    await act(() => result.current.run(file));
    const tree = vi.mocked(saveTree).mock.calls[0][0];
    expect(file.text).not.toHaveBeenCalled();
    expect(tree).toMatchObject({ name: 'Smith family', updatedAt: 100, dataUpdatedAt: 100 });
    expect(tree.people.map((p) => p.name)).toEqual(['Ann Smith', 'Bo Smith']);
    expect(saved).toHaveBeenCalledWith(tree);
    expect(result.current.importedId).toBe(tree.id);
    expect(result.current.feedback).toEqual({
      status: 'success',
      message: 'Imported Smith family with 2 people and 1 relationship.',
    });
  });

  it('keeps a note of what was left out until it is dismissed, including after a retry', async () => {
    vi.mocked(saveTree).mockRejectedValueOnce(Error('Storage full.')).mockResolvedValue('saved');
    const { result } = renderHook(() =>
      useTreeImport(vi.fn(), vi.fn().mockResolvedValue(undefined)),
    );
    const file = gedcomFile([...family, '1 SOUR @S1@', '0 TRLR'], 'tree.GEDCOM');
    await act(() => result.current.run(file));
    expect(result.current.canRetry).toBe(true);
    await act(() => result.current.run());
    expect(file.arrayBuffer).toHaveBeenCalledOnce();
    expect(vi.mocked(saveTree).mock.calls[1][0].name).toBe('tree');
    expect(result.current.feedback).toEqual({
      status: 'info',
      message:
        'Imported tree with 2 people and 1 relationship. 1 source citation was not imported.',
    });
  });

  it('recognizes GEDCOM and JSON files that lost their extension', async () => {
    const { result } = renderHook(() =>
      useTreeImport(vi.fn(), vi.fn().mockResolvedValue(undefined)),
    );
    await act(() => result.current.run(gedcomFile([...family, '0 TRLR'], 'download')));
    expect(vi.mocked(saveTree).mock.calls[0][0].people).toHaveLength(2);
    const json = new TextEncoder().encode(JSON.stringify(makeTree('Family')));
    const file = Object.assign(new File([json], 'download'), {
      arrayBuffer: vi.fn().mockResolvedValue(json.buffer),
    });
    await act(() => result.current.run(file));
    expect(vi.mocked(saveTree).mock.calls[1][0].name).toBe('Family (imported)');
  });

  it('rejects files that are not GEDCOM without offering a retry', async () => {
    const { result } = renderHook(() => useTreeImport(vi.fn(), vi.fn()));
    await act(() => result.current.run(gedcomFile(['{"version": 2}'])));
    expect(result.current.feedback).toEqual({
      status: 'error',
      message: 'This is not a GEDCOM file. It should start with a 0 HEAD line.',
    });
    expect(result.current.canRetry).toBe(false);
    expect(saveTree).not.toHaveBeenCalled();
  });
});
