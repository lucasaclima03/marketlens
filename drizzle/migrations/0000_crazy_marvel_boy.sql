CREATE TABLE "chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj_root" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_cnpj_root_unique" UNIQUE("cnpj_root")
);
--> statement-breakpoint
CREATE TABLE "establishments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj" text NOT NULL,
	"cnpj_root" text GENERATED ALWAYS AS (substr("establishments"."cnpj", 1, 8)) STORED NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"street" text,
	"street_number" text,
	"neighborhood" text NOT NULL,
	"postal_code" text,
	"municipality_ibge_code" text NOT NULL,
	"municipality_name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"chain_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "establishments_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "ingestion_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"reason" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"establishment_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"declared_value" numeric(10, 2) NOT NULL,
	"sale_value" numeric(10, 2) NOT NULL,
	"valid_until" timestamp with time zone DEFAULT 'infinity'::timestamptz NOT NULL,
	"source_id" text NOT NULL,
	"quality_flag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_observations_quality_flag_valid" CHECK (quality_flag IS NULL OR quality_flag IN ('price_anomaly', 'ncm_mismatch', 'geo_invalid')),
	CONSTRAINT "price_observations_last_seen_after_fetched" CHECK (last_seen_at >= fetched_at)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gtin" text,
	"fallback_hash" text,
	"canonical_description" text NOT NULL,
	"fiscal_code" text NOT NULL,
	"category_gpc_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_exactly_one_id" CHECK ((gtin IS NOT NULL)::int + (fallback_hash IS NOT NULL)::int = 1)
);
--> statement-breakpoint
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_establishment_id_establishments_id_fk" FOREIGN KEY ("establishment_id") REFERENCES "public"."establishments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "establishments_cnpj_root_idx" ON "establishments" USING btree ("cnpj_root");--> statement-breakpoint
CREATE INDEX "establishments_municipality_idx" ON "establishments" USING btree ("municipality_ibge_code");--> statement-breakpoint
CREATE INDEX "ingestion_failures_reason_idx" ON "ingestion_failures" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "ingestion_failures_occurred_at_idx" ON "ingestion_failures" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "price_observations_current_row_idx" ON "price_observations" USING btree ("product_id","establishment_id") WHERE valid_until = 'infinity'::timestamptz;--> statement-breakpoint
CREATE INDEX "price_observations_product_time_idx" ON "price_observations" USING btree ("product_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_observations_establishment_time_idx" ON "price_observations" USING btree ("establishment_id","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "products_gtin_unique_idx" ON "products" USING btree ("gtin") WHERE gtin IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_fallback_hash_unique_idx" ON "products" USING btree ("fallback_hash") WHERE fallback_hash IS NOT NULL;