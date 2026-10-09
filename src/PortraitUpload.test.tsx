// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortraitUpload } from './PortraitUpload';
import { portraitData } from './media';
import { makePerson } from './model';

vi.mock('./media', () => ({ portraitData: vi.fn() }));
vi.mock('./feedback', async (original) => ({
  ...(await original<typeof import('./feedback')>()),
  afterPaint: () => Promise.resolve(),
}));
beforeEach(() => {
  vi.mocked(portraitData).mockReset();
});
afterEach(cleanup);
const choose = (file = new File(['photo'], 'photo.png', { type: 'image/png' })) =>
  fireEvent.change(screen.getByLabelText('Choose portrait'), { target: { files: [file] } });

describe('portrait inline feedback', () => {
  it('shows processing, retries decoder failures, and applies only the portrait value', async () => {
    const change = vi.fn();
    let resolve!: (portrait: string) => void;
    vi.mocked(portraitData)
      .mockRejectedValueOnce(Error('Could not decode image.'))
      .mockImplementation(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
    render(<PortraitUpload person={makePerson('Alex')} onChange={change} />);
    choose();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not decode');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status').textContent).toContain('Processing photo');
    expect(screen.getByRole('button', { name: 'Add photo' })).toHaveProperty('disabled', true);
    await waitFor(() => expect(portraitData).toHaveBeenCalledTimes(2));
    await act(async () => resolve('data:image/jpeg;base64,portrait'));
    expect(change).toHaveBeenCalledWith('data:image/jpeg;base64,portrait');
    expect(screen.getByRole('status').textContent).toContain('Photo updated');
  });

  it('offers a different photo for invalid files', async () => {
    vi.mocked(portraitData).mockRejectedValue(Error('Choose a JPEG, PNG, or WebP image.'));
    render(<PortraitUpload person={makePerson('Alex')} onChange={vi.fn()} />);
    choose(new File(['text'], 'text.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a JPEG');
    expect(screen.getByRole('button', { name: 'Choose another photo' })).toBeTruthy();
  });

  it('ignores completion after selection changes or unmounts', async () => {
    const change = vi.fn();
    let resolve!: (portrait: string) => void;
    vi.mocked(portraitData).mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const view = render(<PortraitUpload person={makePerson('Alex')} onChange={change} />);
    choose();
    await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
    view.rerender(<PortraitUpload person={makePerson('Taylor')} onChange={change} />);
    await act(async () => resolve('stale portrait'));
    expect(change).not.toHaveBeenCalled();
    choose();
    await waitFor(() => expect(portraitData).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => resolve('unmounted portrait'));
    expect(change).not.toHaveBeenCalled();
  });

  it('ignores completion when an existing photo is removed during processing', async () => {
    const change = vi.fn();
    let resolve!: (portrait: string) => void;
    vi.mocked(portraitData).mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    render(
      <PortraitUpload person={{ ...makePerson('Alex'), portrait: 'original' }} onChange={change} />,
    );
    choose();
    await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await act(async () => resolve('stale portrait'));
    expect(change).toHaveBeenCalledExactlyOnceWith(null);
  });
});
