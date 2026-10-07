import { useEffect, useRef } from 'react';
import type { DateValue } from './model';

export function DateInput({
  label,
  value,
  onChange,
  invalid = false,
  errorId,
}: {
  label: string;
  value: DateValue;
  onChange: (value: DateValue) => void;
  invalid?: boolean;
  errorId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const savedValue =
    value.precision === 'full'
      ? value.value
      : value.precision === 'year'
        ? Number.isFinite(value.year)
          ? String(value.year)
          : ''
        : '';
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = savedValue;
  }, [savedValue, value.precision]);
  return (
    <div className="date-field">
      <label>
        {label}
        <select
          value={value.precision}
          onChange={(e) =>
            onChange(
              e.target.value === 'year'
                ? { precision: 'year', year: new Date().getFullYear() }
                : e.target.value === 'full'
                  ? { precision: 'full', value: '2000-01-01' }
                  : { precision: 'unknown' },
            )
          }
        >
          <option value="unknown">Unknown</option>
          <option value="year">Year only</option>
          <option value="full">Full date</option>
        </select>
      </label>
      {value.precision === 'year' && (
        <input
          ref={input}
          type="number"
          aria-label={`${label} year`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          min="1"
          max="9999"
          defaultValue={Number.isFinite(value.year) ? value.year : ''}
          onChange={(e) => {
            onChange({
              precision: 'year',
              year: e.currentTarget.valueAsNumber,
            });
          }}
        />
      )}
      {value.precision === 'full' && (
        <input
          ref={input}
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          aria-label={`${label} date`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          defaultValue={value.value}
          onChange={(e) => {
            onChange({ precision: 'full', value: e.currentTarget.value });
          }}
        />
      )}
    </div>
  );
}
