// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DateInput } from './DateInput';
import { lifeDatesError, type DateValue } from '../lib/model';

afterEach(cleanup);
function Editor({ label }: { label: string }) {
  const [value, setValue] = useState<DateValue>({ precision: 'year', year: 1920 });
  const error = lifeDatesError({ born: value, died: { precision: 'unknown' } });
  return (
    <>
      <DateInput
        label={label}
        value={value}
        onChange={setValue}
        invalid={!!error}
        errorId="date-error"
      />
      <p role="alert" id="date-error">
        {error}
      </p>
      <output>{JSON.stringify(value)}</output>
    </>
  );
}
it.each(['Born', 'Died'])(
  'edits approximate %s years and switches to existing options',
  (label) => {
    render(<Editor label={label} />);
    const select = (value: string) =>
      fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Unknown',
      'Year only',
      'Full date',
      'Approximate',
    ]);
    select('about');
    expect(screen.getByLabelText(`${label} year`)).toHaveProperty('value', '1920');
    expect(screen.queryByLabelText(`${label} date`)).toBeNull();
    fireEvent.change(screen.getByLabelText(`${label} year`), { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toMatch(/valid birth year/);
    expect(screen.getByLabelText(`${label} year`).getAttribute('aria-describedby')).toBe(
      'date-error',
    );
    fireEvent.change(screen.getByLabelText(`${label} year`), { target: { value: '1930' } });
    expect(screen.getByRole('status').textContent).toBe('{"precision":"about","year":1930}');
    expect(screen.getByRole('alert').textContent).toBe('');
    select('year');
    expect(screen.getByLabelText(`${label} year`)).toHaveProperty('value', '1930');
    select('full');
    fireEvent.change(screen.getByLabelText(`${label} date`), { target: { value: '1940-02-29' } });
    select('about');
    expect(screen.getByLabelText(`${label} year`)).toHaveProperty('value', '1940');
    select('unknown');
    expect(screen.getByRole('status').textContent).toBe('{"precision":"unknown"}');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  },
);
