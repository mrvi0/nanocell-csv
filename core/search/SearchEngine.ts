/**
 * @file core/search/SearchEngine.ts
 * Pure headless search & replace algorithm executing over 2D Dataframe matrices.
 * ZERO browser/DOM imports.
 */

import { CellCoordinate, CellRange, CellChange, Dataframe } from '../model/Dataframe.js';

export interface SearchQuery {
  readonly term: string;
  readonly caseSensitive?: boolean;
  readonly useRegex?: boolean;
  readonly matchWholeCell?: boolean;
  readonly scopeRange?: CellRange;
}

export interface SearchMatch {
  readonly x: number;
  readonly y: number;
  readonly value: string;
}

export class SearchEngine {
  private buildRegex(query: SearchQuery): RegExp | null {
    if (!query.term) return null;
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let pattern = query.useRegex ? query.term : escape(query.term);
    if (query.matchWholeCell) pattern = `^(?:${pattern})$`;
    const flags = query.caseSensitive ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch {
      const safe = escape(query.term);
      return new RegExp(query.matchWholeCell ? `^(?:${safe})$` : safe, flags);
    }
  }

  find(dataframe: Dataframe, query: SearchQuery): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const regex = this.buildRegex(query);
    if (!regex) return matches;

    const yStart = query.scopeRange ? query.scopeRange.ymin : 0;
    const yEnd = query.scopeRange ? query.scopeRange.ymax : dataframe.height - 1;
    const xStart = query.scopeRange ? query.scopeRange.xmin : 0;
    const xEnd = query.scopeRange ? query.scopeRange.xmax : dataframe.width - 1;

    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const value = dataframe.get(x, y);
        regex.lastIndex = 0;
        if (regex.test(value)) {
          matches.push({ x, y, value });
        }
      }
    }
    return matches;
  }

  goToMatching(dataframe: Dataframe, currentCoord: CellCoordinate, step: 1 | -1 = 1): CellCoordinate | null {
    const rawRows = dataframe.data;
    const targetVal = dataframe.get(currentCoord.x, currentCoord.y);
    const width = dataframe.width;
    const height = dataframe.height;
    const total = width * height;
    if (total <= 1) return null;

    let idx = currentCoord.y * width + currentCoord.x;
    for (let i = 1; i < total; i++) {
      idx = (idx + step + total) % total;
      const x = idx % width;
      const y = (idx - x) / width;
      if ((rawRows[y]?.[x] ?? '') === targetVal) return { x, y };
    }
    return null;
  }

  goToNextMatching(dataframe: Dataframe, currentCoord: CellCoordinate): CellCoordinate | null {
    return this.goToMatching(dataframe, currentCoord, 1);
  }

  goToPreviousMatching(dataframe: Dataframe, currentCoord: CellCoordinate): CellCoordinate | null {
    return this.goToMatching(dataframe, currentCoord, -1);
  }

  replaceAll(dataframe: Dataframe, query: SearchQuery, replacement: string): number {
    const regex = this.buildRegex(query);
    if (!regex) return 0;
    const matches = this.find(dataframe, query);
    const changes: CellChange[] = [];

    for (const { x, y, value } of matches) {
      regex.lastIndex = 0;
      const newValue = value.replace(regex, replacement);
      if (newValue !== value) {
        changes.push({ x, y, oldValue: value, newValue });
      }
    }

    if (changes.length > 0) {
      dataframe.create({
        type: 'RANGE_EDIT',
        timestamp: Date.now(),
        payload: {
          changes,
          description: `Replace all occurrences of '${query.term}' with '${replacement}'`
        }
      });
    }
    return changes.length;
  }
}
