import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SefazAlModule } from '../sources/sefaz-al/sefaz-al.module.js';
import { IngestionPipeline } from './application/ingestion-pipeline.js';
import { IngestionService } from './application/ingestion.service.js';
import { NormalizationService } from './application/normalization.service.js';
import { Validator } from './application/validator.service.js';
import { EstablishmentRepository } from './infrastructure/establishment.repository.js';
import { IngestionFailureRepository } from './infrastructure/ingestion-failure.repository.js';
import { PriceObservationRepository } from './infrastructure/price-observation.repository.js';
import { ProductRepository } from './infrastructure/product.repository.js';

@Module({
  imports: [CatalogModule, SefazAlModule],
  providers: [
    Validator,
    NormalizationService,
    IngestionPipeline,
    IngestionService,
    ProductRepository,
    EstablishmentRepository,
    PriceObservationRepository,
    IngestionFailureRepository,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
