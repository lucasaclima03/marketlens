export interface IngestionResult {
  readonly fetched: number;
  readonly persisted: number;
  readonly extended: number;
  readonly rejected: number;
  readonly skipped: number;
}

export const emptyIngestionResult = (): IngestionResult => ({
  fetched: 0,
  persisted: 0,
  extended: 0,
  rejected: 0,
  skipped: 0,
});
