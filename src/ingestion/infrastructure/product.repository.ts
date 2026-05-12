import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Product } from '../../catalog/domain/product.js';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { products } from '../../shared/db/schema/products.js';

export interface ProductFillFields {
  readonly canonical_description: string;
  readonly fiscal_code: string;
  readonly category_gpc_code: string;
}

@Injectable()
export class ProductRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async findOrCreateByGtin(gtin: string, fillFn: () => ProductFillFields): Promise<Product> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(products)
        .where(eq(products.gtin, gtin))
        .for('update')
        .limit(1);
      if (existing[0]) return existing[0];

      const fill = fillFn();
      const [inserted] = await tx
        .insert(products)
        .values({
          gtin,
          fallback_hash: null,
          canonical_description: fill.canonical_description,
          fiscal_code: fill.fiscal_code,
          category_gpc_code: fill.category_gpc_code,
        })
        .returning();

      if (!inserted) {
        throw new Error('Insert returned no row');
      }
      return inserted;
    });
  }
}
