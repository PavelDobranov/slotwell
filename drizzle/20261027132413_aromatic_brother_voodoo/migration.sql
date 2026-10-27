CREATE TABLE "business_hours" (
	"business_id" smallint,
	"weekday" smallint,
	"window_index" integer,
	"opens_at" time(0) NOT NULL,
	"closes_at" time(0) NOT NULL,
	CONSTRAINT "business_hours_pkey" PRIMARY KEY("business_id","weekday","window_index"),
	CONSTRAINT "business_hours_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
	CONSTRAINT "business_hours_window_index_nonnegative" CHECK ("window_index" >= 0),
	CONSTRAINT "business_hours_opens_at_minute" CHECK (EXTRACT(SECOND FROM "opens_at") = 0),
	CONSTRAINT "business_hours_closes_at_minute" CHECK (EXTRACT(SECOND FROM "closes_at") = 0)
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"id" smallint PRIMARY KEY,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"time_zone" text NOT NULL,
	"default_phone_country" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"lead_time_minutes" integer NOT NULL,
	"horizon_days" integer NOT NULL,
	CONSTRAINT "business_settings_singleton" CHECK ("id" = 1),
	CONSTRAINT "business_settings_name_nonblank" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "business_settings_address_nonblank" CHECK (length(btrim("address")) > 0),
	CONSTRAINT "business_settings_time_zone_nonblank" CHECK (length(btrim("time_zone")) > 0),
	CONSTRAINT "business_settings_phone_country_uppercase" CHECK ("default_phone_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "business_settings_currency_uppercase" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "business_settings_lead_time_nonnegative" CHECK ("lead_time_minutes" >= 0),
	CONSTRAINT "business_settings_horizon_nonnegative" CHECK ("horizon_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price_cents" integer,
	"currency" char(3) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"cleanup_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "services_id_nonblank" CHECK (length(btrim("id")) > 0),
	CONSTRAINT "services_name_nonblank" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "services_category_nonblank" CHECK (length(btrim("category")) > 0),
	CONSTRAINT "services_price_nonnegative" CHECK ("price_cents" IS NULL OR "price_cents" >= 0),
	CONSTRAINT "services_currency_uppercase" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "services_duration_positive" CHECK ("duration_minutes" > 0),
	CONSTRAINT "services_cleanup_nonnegative" CHECK ("cleanup_minutes" >= 0),
	CONSTRAINT "services_sort_order_nonnegative" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "staff_id_nonblank" CHECK (length(btrim("id")) > 0),
	CONSTRAINT "staff_name_nonblank" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "staff_description_nonblank" CHECK (length(btrim("description")) > 0),
	CONSTRAINT "staff_sort_order_nonnegative" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff_services" (
	"staff_id" text,
	"service_id" text,
	CONSTRAINT "staff_services_pkey" PRIMARY KEY("staff_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_business_settings_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business_settings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_id_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_id_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;