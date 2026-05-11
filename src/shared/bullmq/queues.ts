export const QUEUE_CURATED_SEED = 'curated-seed';
export const QUEUE_DISCOVERY = 'discovery-crawl';
export const QUEUE_FUEL = 'fuel-crawl';

export type QueueName = typeof QUEUE_CURATED_SEED | typeof QUEUE_DISCOVERY | typeof QUEUE_FUEL;
