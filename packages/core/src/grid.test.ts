import { describe, expect, it } from 'vitest';
import {
  formatAutoColumns,
  formatSpan,
  formatTracks,
  parseAutoColumns,
  parseSpan,
  parseTracks,
  resizeTracks,
  trackLabel,
  type GridTrack,
} from './grid';

describe('grid columns', () => {
  it('parses equal columns from repeat()', () => {
    expect(parseTracks('repeat(3, minmax(0, 1fr))')).toEqual([
      { kind: 'share', value: 1 },
      { kind: 'share', value: 1 },
      { kind: 'share', value: 1 },
    ]);
  });

  it('parses mixed columns', () => {
    expect(parseTracks('260px minmax(0, 1fr) auto 2fr minmax(200px, 1fr)')).toEqual([
      { kind: 'fixed', value: '260px' },
      { kind: 'share', value: 1 },
      { kind: 'fit' },
      { kind: 'share', value: 2 },
      { kind: 'custom', value: 'minmax(200px, 1fr)' },
    ]);
  });

  it('gives up on patterns that are not a fixed list', () => {
    expect(parseTracks('repeat(auto-fit, minmax(220px, 1fr))')).toBeNull();
    expect(parseTracks('[full-start] 1fr [full-end]')).toBeNull();
    expect(parseTracks(undefined)).toEqual([]);
  });

  it('round-trips and collapses equal columns', () => {
    const tracks: GridTrack[] = [{ kind: 'share', value: 1 }, { kind: 'share', value: 1 }];
    expect(formatTracks(tracks)).toBe('repeat(2, minmax(0, 1fr))');
    expect(formatTracks([{ kind: 'fixed', value: '240px' }, { kind: 'share', value: 1 }])).toBe('240px minmax(0, 1fr)');
    expect(formatTracks([])).toBe('none');
    const mixed = '240px minmax(0, 2fr) auto';
    expect(formatTracks(parseTracks(mixed)!)).toBe(mixed);
  });

  it('reads and writes wrapping columns', () => {
    expect(parseAutoColumns('repeat(auto-fit, minmax(220px, 1fr))')).toEqual({ minWidth: '220px' });
    expect(parseAutoColumns('1fr 1fr')).toBeNull();
    expect(formatAutoColumns({ minWidth: '12rem' })).toBe('repeat(auto-fit, minmax(12rem, 1fr))');
  });

  it('labels columns in plain words', () => {
    expect(trackLabel({ kind: 'share', value: 1 })).toBe('1 share');
    expect(trackLabel({ kind: 'share', value: 2.5 })).toBe('2.5 shares');
    expect(trackLabel({ kind: 'fit' })).toBe('Fit');
  });
});

describe('resizing columns', () => {
  it('rebalances shares and keeps their total', () => {
    const tracks: GridTrack[] = [{ kind: 'share', value: 1 }, { kind: 'share', value: 1 }];
    const next = resizeTracks(tracks, [400, 400], 0, 200);
    expect(next).toEqual([{ kind: 'share', value: 1.5 }, { kind: 'share', value: 0.5 }]);
  });

  it('changes fixed columns and leaves shares to absorb it', () => {
    const tracks: GridTrack[] = [{ kind: 'fixed', value: '260px' }, { kind: 'share', value: 1 }];
    expect(resizeTracks(tracks, [260, 700], 0, 40)).toEqual([{ kind: 'fixed', value: '300px' }, { kind: 'share', value: 1 }]);
  });

  it('never shrinks a column below a usable width', () => {
    const tracks: GridTrack[] = [{ kind: 'fixed', value: '100px' }, { kind: 'fit' }];
    expect(resizeTracks(tracks, [100, 100], 0, 500)).toEqual([
      { kind: 'fixed', value: '176px' },
      { kind: 'fixed', value: '24px' },
    ]);
  });
});

describe('grid placement', () => {
  it('reads common grid-column values', () => {
    expect(parseSpan(undefined)).toEqual({ start: null, span: 1, full: false });
    expect(parseSpan('span 2')).toEqual({ start: null, span: 2, full: false });
    expect(parseSpan('1 / -1')).toEqual({ start: 1, span: 1, full: true });
    expect(parseSpan('2 / span 3')).toEqual({ start: 2, span: 3, full: false });
    expect(parseSpan('2 / 4')).toEqual({ start: 2, span: 2, full: false });
    expect(parseSpan('3')).toEqual({ start: 3, span: 1, full: false });
    expect(parseSpan('main')).toBeNull();
  });

  it('writes the shortest CSS', () => {
    expect(formatSpan({ start: null, span: 1, full: false })).toBeNull();
    expect(formatSpan({ start: null, span: 2, full: false })).toBe('span 2');
    expect(formatSpan({ start: 2, span: 1, full: false })).toBe('2');
    expect(formatSpan({ start: 2, span: 3, full: false })).toBe('2 / span 3');
    expect(formatSpan({ start: null, span: 1, full: true })).toBe('1 / -1');
  });
});
