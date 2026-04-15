export async function register() {
  // Only pre-warm on the Node.js server runtime (not Edge, not builds)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prewarmDeezerCache } = await import("./lib/deezer-prewarm");
    // Fire-and-forget: don't block the server from accepting requests
    prewarmDeezerCache().catch((err) => {
      console.error("[instrumentation] Deezer pre-warm failed:", err);
    });
  }
}
