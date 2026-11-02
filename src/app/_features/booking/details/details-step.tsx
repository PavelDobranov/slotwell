"use client";

import { useEffect, useRef } from "react";

import type { BusinessView } from "@/app/_features/booking/api";
import { useBooking } from "@/app/_features/booking/context";
import { BookingSummary } from "@/app/_features/booking/details/booking-summary";
import { ContactForm } from "@/app/_features/booking/details/contact-form";
import { BookingReview } from "@/app/_features/booking/details/review";

/** Connect contact/review views without moving submission authority into UI. */
export function DetailsStep({ business }: { business: BusinessView }) {
  const {
    state,
    dispatch,
    selectedServices,
    selectedStaff,
    canConfirm,
    commands,
  } = useBooking();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.step === "details" || state.step === "review")
      heading.current?.focus();
  }, [state.step]);
  if (!state.slot) return null;
  const reviewing = state.step === "review";
  return (
    <section
      aria-labelledby="details-heading"
      className="flex min-w-0 flex-col gap-5"
    >
      <h2
        id="details-heading"
        ref={heading}
        tabIndex={-1}
        className="text-[28px] leading-[34px] font-semibold lg:text-4xl lg:leading-[42px]"
      >
        {reviewing ? "Проверете и потвърдете" : "Вашите данни"}
      </h2>
      <BookingSummary
        services={selectedServices}
        staffName={selectedStaff?.name ?? "Избраният специалист"}
        business={business}
        slot={state.slot}
        onEdit={(step) => dispatch({ type: "edit", step })}
      />
      {reviewing ? (
        <BookingReview
          contact={state.contact}
          canConfirm={canConfirm}
          onConfirm={commands.confirm}
          onEdit={() => dispatch({ type: "edit", step: "details" })}
        />
      ) : (
        <ContactForm
          contact={state.contact}
          defaultPhoneCountry={business.defaultPhoneCountry}
          onChange={(draft) => dispatch({ type: "contact", draft })}
          onReview={() =>
            dispatch({
              type: "review",
              services: selectedServices,
              defaultPhoneCountry: business.defaultPhoneCountry,
            })
          }
          onBack={() => dispatch({ type: "edit", step: "time" })}
        />
      )}
    </section>
  );
}
