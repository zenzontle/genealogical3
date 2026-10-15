// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortraitUpload } from './PortraitUpload';
import { portraitData } from './media';
import { makePerson, type Person } from './model';
import { mockDialogs } from './dialogTestSetup';

vi.mock('./media', () => ({ portraitData: vi.fn() }));
vi.mock('./feedback', async (original) => ({
  ...(await original<typeof import('./feedback')>()),
  afterPaint: () => Promise.resolve(),
}));
beforeEach(() => {
  mockDialogs();
  vi.mocked(portraitData).mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const choose = (file = new File(['photo'], 'photo.png', { type: 'image/png' })) =>
  fireEvent.change(screen.getByLabelText('Choose portrait'), { target: { files: [file] } });

describe('portrait toast feedback', () => {
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
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('Could not decode');
    expect(error.closest('.toast-stack')).toBeTruthy();
    expect(error.closest('.operation-feedback')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status').textContent).toContain('Processing photo');
    expect(screen.getByRole('button', { name: 'Add photo' })).toHaveProperty('disabled', true);
    await waitFor(() => expect(portraitData).toHaveBeenCalledTimes(2));
    await act(async () => resolve('data:image/jpeg;base64,portrait'));
    expect(change).toHaveBeenCalledWith('data:image/jpeg;base64,portrait');
    expect(screen.getByRole('status').textContent).toContain('Photo updated');
    expect(screen.getByRole('status').closest('.toast-stack')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    choose();
    await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await act(async () => resolve('stale portrait'));
    expect(change).toHaveBeenCalledExactlyOnceWith(null);
  });
});

function EditablePortrait({ onChange = vi.fn() }: { onChange?: (value: string | null) => void }) {
  const [person, setPerson] = useState<Person>({
    ...makePerson('Alex'),
    portrait: 'data:image/jpeg;base64,stored-photo',
  });
  return (
    <PortraitUpload
      person={person}
      onChange={(portrait) => {
        onChange(portrait);
        setPerson({ ...person, portrait });
      }}
    />
  );
}

describe('full photo viewer', () => {
  it('opens by keyboard with the exact stored source and person name, without processing or editing', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<EditablePortrait onChange={change} />);
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Photo of Alex' });
    expect(within(dialog).getByRole('img', { name: 'Photo of Alex' }).getAttribute('src')).toBe(
      'data:image/jpeg;base64,stored-photo',
    );
    expect(dialog.classList.contains('portrait-viewer')).toBe(true);
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Change photo' }),
    );
    expect(change).not.toHaveBeenCalled();
    expect(portraitData).not.toHaveBeenCalled();
  });

  it.each(['close button', 'Escape'])(
    'restores thumbnail focus after closing with %s',
    async (method) => {
      const user = userEvent.setup();
      render(<EditablePortrait />);
      const thumbnail = screen.getByRole('button', { name: 'View photo' });
      await user.click(thumbnail);
      if (method === 'close button')
        await user.click(screen.getByRole('button', { name: 'Close dialog' }));
      else fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(thumbnail);
    },
  );

  it('contains keyboard focus and opens the replacement picker without changing anything on cancellation', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<EditablePortrait onChange={change} />);
    await user.click(screen.getByRole('button', { name: 'View photo' }));
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const remove = screen.getByRole('button', { name: 'Remove photo' });
    remove.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(remove);
    const picker = screen.getByLabelText('Choose portrait');
    expect(picker.closest('dialog')).toBe(screen.getByRole('dialog'));
    const click = vi.spyOn(picker, 'click');
    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    expect(click).toHaveBeenCalledOnce();
    fireEvent.change(picker, { target: { files: [] } });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(portraitData).not.toHaveBeenCalled();
  });

  it('keeps the viewer open after replacing the photo and shows the updated stored image', async () => {
    const user = userEvent.setup();
    vi.mocked(portraitData).mockResolvedValue('data:image/jpeg;base64,replacement');
    render(<EditablePortrait />);
    await user.click(screen.getByRole('button', { name: 'View photo' }));
    choose();
    await screen.findByText('Photo updated.');
    expect(
      within(screen.getByRole('dialog')).getByRole('status').closest('.toast-stack'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Photo of Alex' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Photo of Alex' }).getAttribute('src')).toBe(
      'data:image/jpeg;base64,replacement',
    );
    expect(screen.getByAltText('Portrait').getAttribute('src')).toBe(
      'data:image/jpeg;base64,replacement',
    );
  });

  it('retains the stored image through invalid files and decoder failures, then retries', async () => {
    vi.mocked(portraitData)
      .mockRejectedValueOnce(Error('Choose a JPEG, PNG, or WebP image.'))
      .mockRejectedValueOnce(Error('Could not decode image.'))
      .mockResolvedValue('data:image/jpeg;base64,retried');
    render(<EditablePortrait />);
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    choose(new File(['text'], 'text.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a JPEG');
    const click = vi.spyOn(screen.getByLabelText('Choose portrait'), 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another photo' }));
    expect(click).toHaveBeenCalledOnce();
    choose();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not decode');
    expect(screen.getByRole('img', { name: 'Photo of Alex' }).getAttribute('src')).toBe(
      'data:image/jpeg;base64,stored-photo',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Photo updated.');
    expect(screen.getByRole('img', { name: 'Photo of Alex' }).getAttribute('src')).toBe(
      'data:image/jpeg;base64,retried',
    );
  });

  it.each(['close button', 'Escape'])(
    'allows %s during processing and can reopen the updated photo',
    async (method) => {
      const user = userEvent.setup();
      let finish!: (value: string) => void;
      vi.mocked(portraitData).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      render(<EditablePortrait />);
      const thumbnail = screen.getByRole('button', { name: 'View photo' });
      await user.click(thumbnail);
      choose();
      await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
      expect(screen.getByRole('button', { name: 'Change photo' })).toHaveProperty('disabled', true);
      if (method === 'close button')
        await user.click(screen.getByRole('button', { name: 'Close dialog' }));
      else fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(thumbnail);
      await user.click(thumbnail);
      expect(screen.getByRole('status').textContent).toContain('Processing photo');
      await act(async () => finish('data:image/jpeg;base64,finished'));
      expect(screen.getByRole('img', { name: 'Photo of Alex' }).getAttribute('src')).toBe(
        'data:image/jpeg;base64,finished',
      );
    },
  );

  it('closes and restores Add photo focus on removal, ignoring any pending replacement', async () => {
    const user = userEvent.setup();
    let finish!: (value: string) => void;
    const change = vi.fn();
    vi.mocked(portraitData).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<EditablePortrait onChange={change} />);
    await user.click(screen.getByRole('button', { name: 'View photo' }));
    choose();
    await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add photo' }));
    await act(async () => finish('stale'));
    expect(change).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('resets viewer and feedback on person changes and ignores the previous replacement', async () => {
    let finish!: (value: string) => void;
    const change = vi.fn();
    vi.mocked(portraitData).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <PortraitUpload person={{ ...makePerson('Alex'), portrait: 'alex' }} onChange={change} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    choose();
    await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
    view.rerender(
      <PortraitUpload person={{ ...makePerson('Taylor'), portrait: 'taylor' }} onChange={change} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => finish('stale'));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    expect(screen.getByRole('dialog', { name: 'Photo of Taylor' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Photo of Taylor' }).getAttribute('src')).toBe('taylor');
  });
});
