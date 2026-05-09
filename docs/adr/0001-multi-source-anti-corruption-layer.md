# Multi-source data architecture via Anti-Corruption Layer

MarketLens aggregates retail price data and SEFAZ Alagoas is the first source, but other sources (other states' APIs, web scrapers, manual catalog imports) may follow. To avoid coupling the domain to source-specific shapes, every source has its own adapter (e.g. `SefazAlAdapter`) that translates source-specific DTOs (`SefazAlPriceItem`) into a canonical internal type, **`RawPriceObservation`**, before any normalization or persistence. The domain entities (`Product`, `PriceObservation`, `Establishment`) never reference any specific source; the only place `sourceId` lives is on `RawPriceObservation` and inside the `sources/<source>/` adapter folder.

## Considered options

- **Map directly from `SefazAlPriceItem` to `Product` + `PriceObservation`** in the SEFAZ adapter. Simpler today, but every new source would either duplicate normalization or grow a `if (source === ...)` ladder inside the normalizer. Replay/backfill of historical raw data is impossible because we discard the source-specific shape.
- **Skip the adapter layer entirely** and use the SEFAZ DTO as the canonical type. Forecloses multi-source forever and bakes "SEFAZ" into domain naming.

## Consequences

- One extra type (`RawPriceObservation`) and one extra mapping function per source. ~30-50 lines of code overhead.
- Tests for normalization use `RawPriceObservation` fixtures — not source-specific JSON — keeping them clean and fast.
- Adding a second source means writing a new adapter and its tests; the normalizer, repository, and domain never change.
- Optional future capability: archive `RawPriceObservation` to enable replay when normalization logic improves, without re-fetching from sources.
