// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTreeImport } from './useTreeImport';
import { saveTree } from './storage';
import { makeTree } from './model';

vi.mock('./storage', () => ({ saveTree: vi.fn() }));
vi.mock('./feedback', async (original) => ({
  ...(await original<typeof import('./feedback')>()),
  afterPaint: () => Promise.resolve(),
}));
const jsonFile = (text: string) =>
  Object.assign(new File([text], 'tree.json', { type: 'application/json' }), {
    text: vi.fn().mockResolvedValue(text),
  });
beforeEach(() => {
  vi.mocked(saveTree).mockReset().mockResolvedValue('saved');
});
afterEach(cleanup);

describe('JSON import feedback and recovery', () => {
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
