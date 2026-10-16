// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTreeExport } from './useTreeExport';
import { exportJson, exportPng } from '../lib/media';
import { afterPaint } from '../lib/feedback';
import { makeTree } from '../lib/model';

vi.mock('../lib/media', () => ({ exportJson: vi.fn(), exportPng: vi.fn() }));
vi.mock('../lib/feedback', async (original) => ({
  ...(await original<typeof import('../lib/feedback')>()),
  afterPaint: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(afterPaint).mockResolvedValue(undefined);
  vi.mocked(exportPng).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('export feedback', () => {
  it('paints pending state before JSON preparation and prevents duplicate exports', async () => {
    let resolve!: () => void;
    vi.mocked(afterPaint).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const tree = makeTree();
    const { result } = renderHook(() => useTreeExport(tree.id, () => tree));
    let first!: Promise<void>;
    act(() => {
      first = result.current.run('JSON');
    });
    expect(result.current.feedback).toEqual({ status: 'pending', message: 'Preparing JSON…' });
    expect(exportJson).not.toHaveBeenCalled();
    await act(() => result.current.run('PNG'));
    expect(exportPng).not.toHaveBeenCalled();
    await act(async () => {
      resolve();
      await first;
    });
    expect(exportJson).toHaveBeenCalledOnce();
    expect(result.current.feedback).toEqual({
      status: 'success',
      message: 'JSON export completed.',
    });
  });

  it('waits for PNG generation to finish before reporting completion', async () => {
    let finish!: () => void;
    vi.mocked(exportPng).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const tree = makeTree();
    const { result } = renderHook(() => useTreeExport(tree.id, () => tree));
    let exporting!: Promise<void>;
    await act(async () => {
      exporting = result.current.run('PNG');
    });
    expect(exportPng).toHaveBeenCalledWith(tree);
    expect(result.current.feedback.status).toBe('pending');
    await act(async () => {
      finish();
      await exporting;
    });
    expect(result.current.feedback).toEqual({
      status: 'success',
      message: 'PNG export completed.',
    });
  });

  it('reports PNG failures and retries using the latest valid tree', async () => {
    vi.mocked(exportPng).mockRejectedValueOnce(Error('A portrait could not be loaded.'));
    let tree = makeTree('Original');
    const { result } = renderHook(() => useTreeExport(tree.id, () => tree));
    await act(() => result.current.run('PNG'));
    expect(result.current.feedback).toEqual({
      status: 'error',
      message: 'A portrait could not be loaded.',
    });
    tree = { ...tree, name: 'Updated' };
    await act(() => result.current.retry());
    expect(exportPng).toHaveBeenLastCalledWith(tree);
    expect(result.current.feedback).toEqual({
      status: 'success',
      message: 'PNG export completed.',
    });
  });

  it('keeps JSON validation failures visible until dismissed', async () => {
    vi.mocked(exportJson).mockImplementationOnce(() => {
      throw Error('Correct the dates before saving.');
    });
    const tree = makeTree();
    const { result } = renderHook(() => useTreeExport(tree.id, () => tree));
    await act(() => result.current.run('JSON'));
    expect(result.current.feedback.status).toBe('error');
    act(() => result.current.dismiss());
    expect(result.current.feedback.status).toBe('idle');
  });
});
