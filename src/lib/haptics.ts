import { WebHaptics } from "web-haptics";

const webHaptics = typeof window !== "undefined" ? new WebHaptics() : null;

function trigger(input?: Parameters<WebHaptics["trigger"]>[0]) {
  if (!webHaptics) return;
  void webHaptics.trigger(input).catch(() => {
    // Ignore unsupported browsers/devices or blocked haptics.
  });
}

export function hapticSuccess() {
  trigger("success");
}

export function hapticNudge() {
  trigger("nudge");
}

export function hapticToast(message?: string) {
  if (message?.toLowerCase().includes("cannot")) {
    trigger("nudge");
    return;
  }
  trigger("success");
}
