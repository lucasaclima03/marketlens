import { Injectable } from '@nestjs/common';
import { IngestionFailureRepository } from '../infrastructure/ingestion-failure.repository.js';
import { PriceObservationRepository } from '../infrastructure/price-observation.repository.js';
import { NormalizationService } from './normalization.service.js';
import { Validator } from './validator.service.js';

@Injectable()
export class IngestionPipeline {
  constructor(
    readonly validator: Validator,
    readonly normalization: NormalizationService,
    readonly priceRepo: PriceObservationRepository,
    readonly failureRepo: IngestionFailureRepository,
  ) {}
}
