"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const KEYS_TO_CLEAR = ["coachella:schedule:v1", "coachella:session"];

export function AuthSessionReset() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const shouldClear =
      searchParams.get("signed_out") === "1" || !!searchParams.get("error");
    if (!shouldClear) return;

    for (const key of KEYS_TO_CLEAR) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage failures during auth resets.
      }
    }
  }, [searchParams]);

  return null;
}
