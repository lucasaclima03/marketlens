export interface CuratedSeedJobContext {
  readonly kind: 'curated_seed';
  readonly queriedGtin: string;
}

export interface DiscoveryJobContext {
  readonly kind: 'discovery';
}

export type JobContext = CuratedSeedJobContext | DiscoveryJobContext;
