import { useEffect, useRef } from 'react';
import type { DateValue } from '../lib/model';

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
      : value.precision === 'year' || value.precision === 'about'
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
          onChange={(e) => {
            const precision = e.target.value;
            onChange(
              precision === 'year' || precision === 'about'
                ? {
                    precision,
                    year:
                      value.precision === 'year' || value.precision === 'about'
                        ? value.year
                        : value.precision === 'full'
                          ? Number(value.value.slice(0, 4)) || NaN
                          : new Date().getFullYear(),
                  }
                : precision === 'full'
                  ? { precision: 'full', value: '2000-01-01' }
                  : { precision: 'unknown' },
            );
          }}
        >
          <option value="unknown">Unknown</option>
          <option value="full">Full date</option>
          <option value="year">Year only</option>
          <option value="about">Approximate</option>
        </select>
      </label>
      {(value.precision === 'year' || value.precision === 'about') && (
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
              precision: value.precision,
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
