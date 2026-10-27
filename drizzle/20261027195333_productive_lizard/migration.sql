CREATE TABLE "appointment_access" (
	"appointment_id" uuid PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	CONSTRAINT "appointment_access_hash_valid" CHECK ("token_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "appointment_services" (
	"appointment_id" uuid,
	"position" integer,
	"service_id" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer,
	"currency" char(3) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"cleanup_minutes" integer NOT NULL,
	CONSTRAINT "appointment_services_pkey" PRIMARY KEY("appointment_id","position"),
	CONSTRAINT "appointment_services_distinct" UNIQUE("appointment_id","service_id"),
	CONSTRAINT "appointment_services_position_nonnegative" CHECK ("position" >= 0),
	CONSTRAINT "appointment_services_name_nonblank" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "appointment_services_price_nonnegative" CHECK ("price_cents" IS NULL OR "price_cents" >= 0),
	CONSTRAINT "appointment_services_currency_uppercase" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "appointment_services_duration_positive" CHECK ("duration_minutes" > 0),
	CONSTRAINT "appointment_services_cleanup_nonnegative" CHECK ("cleanup_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY,
	"client_id" uuid NOT NULL,
	"staff_id" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text NOT NULL,
	"notes" text,
	"staff_name" text NOT NULL,
	"business_address" text NOT NULL,
	"booking_time_zone" text NOT NULL,
	"starts_at" timestamp(3) with time zone NOT NULL,
	"service_ends_at" timestamp(3) with time zone NOT NULL,
	"occupied_ends_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"confirmation_expires_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "appointments_status_confirmed" CHECK ("status" = 'confirmed'),
	CONSTRAINT "appointments_contact_name_valid" CHECK ("contact_name" = btrim("contact_name") AND length("contact_name") BETWEEN 1 AND 100),
	CONSTRAINT "appointments_contact_phone_valid" CHECK ("contact_phone" = btrim("contact_phone") AND length("contact_phone") BETWEEN 1 AND 32),
	CONSTRAINT "appointments_contact_email_valid" CHECK ("contact_email" = btrim("contact_email") AND length("contact_email") BETWEEN 1 AND 254),
	CONSTRAINT "appointments_notes_length" CHECK (length("notes") <= 1000),
	CONSTRAINT "appointments_staff_name_nonblank" CHECK (length(btrim("staff_name")) > 0),
	CONSTRAINT "appointments_business_address_nonblank" CHECK (length(btrim("business_address")) > 0),
	CONSTRAINT "appointments_zone_nonblank" CHECK (length(btrim("booking_time_zone")) > 0),
	CONSTRAINT "appointments_instants_valid" CHECK ("starts_at" > '-infinity'::timestamptz AND "starts_at" < "service_ends_at" AND "service_ends_at" <= "occupied_ends_at" AND "occupied_ends_at" < 'infinity'::timestamptz AND "created_at" > '-infinity'::timestamptz AND "created_at" < 'infinity'::timestamptz AND "confirmation_expires_at" < 'infinity'::timestamptz),
	CONSTRAINT "appointments_expiry_exact" CHECK ("confirmation_expires_at" = "service_ends_at" + INTERVAL '168 hours')
);
--> statement-breakpoint
CREATE TABLE "booking_operations" (
	"id" uuid PRIMARY KEY,
	"credential_hash" text NOT NULL UNIQUE,
	"state" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"submit_before" timestamp(3) with time zone NOT NULL,
	"appointment_id" uuid UNIQUE,
	"payload_fingerprint" text,
	"fingerprint_version" integer,
	"fingerprint_key_id" text,
	"encrypted_replay" text,
	"replay_key_id" text,
	"replay_expires_at" timestamp(3) with time zone,
	CONSTRAINT "booking_operations_credential_hash_valid" CHECK ("credential_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "booking_operations_state_valid" CHECK ("state" = 'pending' OR "state" = 'committed' OR "state" = 'abandoned' OR "state" = 'tombstone'),
	CONSTRAINT "booking_operations_metadata_matches_state" CHECK (CASE WHEN "state" = 'committed' THEN "appointment_id" IS NOT NULL AND "payload_fingerprint" IS NOT NULL AND "fingerprint_version" IS NOT NULL AND "fingerprint_key_id" IS NOT NULL AND "encrypted_replay" IS NOT NULL AND "replay_key_id" IS NOT NULL AND "replay_expires_at" IS NOT NULL ELSE "appointment_id" IS NULL AND "payload_fingerprint" IS NULL AND "fingerprint_version" IS NULL AND "fingerprint_key_id" IS NULL AND "encrypted_replay" IS NULL AND "replay_key_id" IS NULL AND "replay_expires_at" IS NULL END),
	CONSTRAINT "booking_operations_fingerprint_valid" CHECK ("payload_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "booking_operations_version_positive" CHECK ("fingerprint_version" > 0),
	CONSTRAINT "booking_operations_fingerprint_key_nonblank" CHECK (length(btrim("fingerprint_key_id")) > 0),
	CONSTRAINT "booking_operations_replay_valid" CHECK ("encrypted_replay" ~ '^([a-f0-9]{2}){60,}$'),
	CONSTRAINT "booking_operations_replay_key_nonblank" CHECK (length(btrim("replay_key_id")) > 0),
	CONSTRAINT "booking_operations_instants_valid" CHECK ("created_at" > '-infinity'::timestamptz AND "created_at" < "submit_before" AND "submit_before" < 'infinity'::timestamptz AND "replay_expires_at" > "created_at" AND "replay_expires_at" < 'infinity'::timestamptz)
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY,
	"normalized_phone" text NOT NULL UNIQUE,
	CONSTRAINT "clients_phone_e164" CHECK ("normalized_phone" ~ '^[+][1-9][0-9]{1,14}$')
);
--> statement-breakpoint
ALTER TABLE "staff_occupancy" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_occupancy" ADD CONSTRAINT "staff_occupancy_appointment_id_unique" UNIQUE("appointment_id");--> statement-breakpoint
ALTER TABLE "appointment_access" ADD CONSTRAINT "appointment_access_appointment_id_appointments_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointments_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "booking_operations" ADD CONSTRAINT "booking_operations_appointment_id_appointments_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_occupancy" ADD CONSTRAINT "staff_occupancy_appointment_id_appointments_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_occupancy" ADD CONSTRAINT "staff_occupancy_appointment_kind" CHECK (("kind" = 'appointment') = ("appointment_id" IS NOT NULL));