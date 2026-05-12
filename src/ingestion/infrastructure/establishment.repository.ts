import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Establishment } from '../../catalog/domain/establishment.js';
import type { AppDatabase } from '../../shared/db/client.js';
import { DATABASE } from '../../shared/db/db.module.js';
import { establishments } from '../../shared/db/schema/establishments.js';

export interface EstablishmentFillFields {
  readonly legal_name: string;
  readonly trade_name: string | null;
  readonly street: string | null;
  readonly street_number: string | null;
  readonly neighborhood: string;
  readonly postal_code: string | null;
  readonly municipality_ibge_code: string;
  readonly municipality_name: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

@Injectable()
export class EstablishmentRepository {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  async findOrCreateByCnpj(
    cnpj: string,
    fillFn: () => EstablishmentFillFields,
  ): Promise<Establishment> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(establishments)
        .where(eq(establishments.cnpj, cnpj))
        .for('update')
        .limit(1);
      if (existing[0]) return existing[0];

      const fill = fillFn();
      const [inserted] = await tx
        .insert(establishments)
        .values({ cnpj, chain_id: null, ...fill })
        .returning();

      if (!inserted) {
        throw new Error('Insert returned no row');
      }
      return inserted;
    });
  }
}
