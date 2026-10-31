"use client";

import { useEffect, useRef, useState } from "react";

import {
  fetchConfirmation,
  formatConfirmation,
  parseConfirmationFragment,
} from "@/app/_features/confirmation/confirmation-api";
import {
  type ConfirmationState,
  ConfirmationSummary,
} from "@/app/_features/confirmation/confirmation-summary";

export function Confirmation() {
  const [attempt, setAttempt] = useState(0);
  return (
    <ConfirmationRead
      key={attempt}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ConfirmationRead({ onRetry }: { onRetry: () => void }) {
  const [state, setState] = useState<ConfirmationState>({ status: "loading" });
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.status === "confirmed") resultHeading.current?.focus();
  }, [state.status]);

  useEffect(() => {
    let current = 0;
    let controller: AbortController | undefined;
    async function load() {
      const request = ++current;
      controller?.abort();
      setState({ status: "loading" });
      const credential = parseConfirmationFragment(window.location.hash);
      if (!credential) {
        setState({ status: "unavailable" });
        return;
      }
      controller = new AbortController();
      const activeController = controller;
      const timeout = window.setTimeout(() => activeController.abort(), 15_000);
      try {
        const response = await fetchConfirmation(
          credential,
          activeController.signal,
        );
        if (request !== current) return;
        if (response.status === 400 || response.status === 404) {
          setState({ status: "unavailable" });
          return;
        }
        if (!response.ok) throw new Error();
        const display = formatConfirmation(await response.json());
        if (request === current) setState({ status: "confirmed", display });
      } catch {
        // Never retain/log credentials, bodies, snapshots or raw failures.
        if (request === current) setState({ status: "temporary" });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) void load();
    };
    void load();
    window.addEventListener("hashchange", load);
    window.addEventListener("pageshow", restore);
    return () => {
      current++;
      controller?.abort();
      window.removeEventListener("hashchange", load);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  return (
    <ConfirmationSummary
      state={state}
      onRetry={onRetry}
      resultHeading={resultHeading}
    />
  );
}
