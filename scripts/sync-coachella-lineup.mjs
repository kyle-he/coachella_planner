/**
 * One-time (or occasional) snapshot: pulls artist photos + official Spotify URLs
 * from the same JSON the https://www.coachella.com/lineup widget loads
 * (events.aegamp.com). Writes src/lib/coachella-lineup-meta.json — the app only
 * reads that file at build/runtime; it does not call Coachella on each request.
 *
 * Usage: npm run sync-lineup   (or: node scripts/sync-coachella-lineup.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../src/lib/coachella-lineup-meta.json");

function normalizeCoachellaLineupKey(name) {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "o")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function parseDataPath(html) {
  const m = html.match(/data-path="([^"]+)"/);
  if (!m) throw new Error('Could not find data-path on https://www.coachella.com/lineup');
  return m[1];
}

async function main() {
  const lineupHtml = await fetchText("https://www.coachella.com/lineup");
  const dataPath = parseDataPath(lineupHtml);
  const base = `https://events.aegamp.com/app/${dataPath}`;

  const index = await fetchJson(`${base}/artists.json`);
  const ids = Object.keys(index);

  const byKey = {};
  let i = 0;
  for (const id of ids) {
    const row = index[id];
    const detail = await fetchJson(`${base}/${id}.json`);
    const title = detail.title || row.title;
    const key = normalizeCoachellaLineupKey(title);
    if (!key) continue;
    byKey[key] = {
      title,
      imageUrl: detail.photo_suffix || row.photo_suffix || "",
      spotifyUrl: detail.spotifyUrl || null,
    };
    i += 1;
    if (i % 20 === 0) process.stderr.write(`.\n`);
    await new Promise((r) => setTimeout(r, 35));
  }

  const payload = {
    source: "https://www.coachella.com/lineup",
    dataPath,
    generatedAt: new Date().toISOString(),
    byKey,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${Object.keys(byKey).length} artists → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
