CREATE TABLE "schedule_exceptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" smallint,
	"staff_id" text,
	"on_date" date NOT NULL,
	"window_index" integer NOT NULL,
	"is_closed" boolean NOT NULL,
	"opens_at" time(0),
	"closes_at" time(0),
	CONSTRAINT "schedule_exceptions_window_index_nonnegative" CHECK ("window_index" >= 0),
	CONSTRAINT "schedule_exceptions_one_subject" CHECK (("business_id" IS NOT NULL) <> ("staff_id" IS NOT NULL)),
	CONSTRAINT "schedule_exceptions_hours_match_closed" CHECK ("is_closed" = ("opens_at" IS NULL) AND "is_closed" = ("closes_at" IS NULL)),
	CONSTRAINT "schedule_exceptions_opens_at_minute" CHECK ("opens_at" IS NULL OR EXTRACT(SECOND FROM "opens_at") = 0),
	CONSTRAINT "schedule_exceptions_closes_at_minute" CHECK ("closes_at" IS NULL OR EXTRACT(SECOND FROM "closes_at") = 0)
);
--> statement-breakpoint
CREATE TABLE "staff_occupancy" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_occupancy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_id" text NOT NULL,
	"period" tstzrange NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "staff_occupancy_kind_valid" CHECK ("kind" = 'appointment' OR "kind" = 'block'),
	CONSTRAINT "staff_occupancy_period_canonical" CHECK (NOT isempty("period") AND lower_inc("period") AND NOT upper_inc("period") AND lower("period") IS NOT NULL AND upper("period") IS NOT NULL),
	CONSTRAINT "staff_occupancy_no_overlap" EXCLUDE USING gist ("staff_id" WITH =, "period" WITH &&)
);
--> statement-breakpoint
CREATE TABLE "staff_schedules" (
	"staff_id" text,
	"weekday" smallint,
	"window_index" integer,
	"opens_at" time(0) NOT NULL,
	"closes_at" time(0) NOT NULL,
	CONSTRAINT "staff_schedules_pkey" PRIMARY KEY("staff_id","weekday","window_index"),
	CONSTRAINT "staff_schedules_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
	CONSTRAINT "staff_schedules_window_index_nonnegative" CHECK ("window_index" >= 0),
	CONSTRAINT "staff_schedules_opens_at_minute" CHECK (EXTRACT(SECOND FROM "opens_at") = 0),
	CONSTRAINT "staff_schedules_closes_at_minute" CHECK (EXTRACT(SECOND FROM "closes_at") = 0)
);
--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_business_id_business_settings_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business_settings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_staff_id_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_occupancy" ADD CONSTRAINT "staff_occupancy_staff_id_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_staff_id_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;