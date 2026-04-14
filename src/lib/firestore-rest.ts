/**
 * Minimal Firestore REST client.
 * Talks directly to the emulator (or production) via HTTP — no native deps,
 * no gRPC, works with every bundler.
 */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-coachella";
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST; // e.g. "127.0.0.1:8080"

function root(): string {
  if (EMULATOR) {
    return `http://${EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  }
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
}

// ── Value conversion ────────────────────────────────────────────────

type FsValue = Record<string, unknown>;

function encode(val: unknown): FsValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number")
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val))
    return { arrayValue: { values: val.map(encode) } };
  if (typeof val === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields[k] = encode(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function decode(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) {
    const a = v.arrayValue as { values?: FsValue[] };
    return (a.values ?? []).map(decode);
  }
  if ("mapValue" in v) {
    const m = v.mapValue as { fields?: Record<string, FsValue> };
    return decodeFields(m.fields ?? {});
  }
  return null;
}

function encodeFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encode(v);
  return out;
}

function decodeFields(
  fields: Record<string, FsValue>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
  return out;
}

/** Extract the last path segment (document ID) from a Firestore name. */
function docIdFromName(name: string): string {
  return name.split("/").pop()!;
}

// ── CRUD operations ─────────────────────────────────────────────────

/** Create or overwrite a document at a specific path. */
export async function setDoc(
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${root()}/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Firestore SET ${path} failed (${res.status}): ${txt}`);
  }
}

/** Get a single document. Returns null if it doesn't exist. */
export async function getDoc(
  path: string
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${root()}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const doc = (await res.json()) as { fields?: Record<string, FsValue> };
  if (!doc.fields) return null;
  return decodeFields(doc.fields);
}

/** Delete a document. */
export async function deleteDoc(path: string): Promise<void> {
  await fetch(`${root()}/${path}`, { method: "DELETE" });
}

/** Update specific fields on an existing document. */
export async function updateDoc(
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  const url = new URL(`${root()}/${path}`);
  for (const key of Object.keys(data)) {
    url.searchParams.append("updateMask.fieldPaths", key);
  }
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Firestore UPDATE ${path} failed (${res.status}): ${txt}`);
  }
}

/** List all documents in a collection (no ordering). */
export async function listDocs(
  collectionPath: string
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const res = await fetch(`${root()}/${collectionPath}`);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    documents?: Array<{ name: string; fields?: Record<string, FsValue> }>;
  };
  return (body.documents ?? []).map((d) => ({
    id: docIdFromName(d.name),
    data: decodeFields(d.fields ?? {}),
  }));
}

// ── Structured queries ──────────────────────────────────────────────

interface QueryFilter {
  field: string;
  op: "EQUAL" | "LESS_THAN" | "GREATER_THAN" | "ARRAY_CONTAINS";
  value: unknown;
}

interface QueryOptions {
  collection: string;
  /** If true, searches across all subcollections with this name. */
  allDescendants?: boolean;
  filters?: QueryFilter[];
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" };
  limit?: number;
  /** Parent document path for subcollection queries (e.g. "parties/abc"). */
  parent?: string;
}

interface QueryResult {
  /** Full document path (e.g. "parties/abc/members/user@x.com"). */
  path: string;
  id: string;
  data: Record<string, unknown>;
}

const OP_MAP: Record<string, string> = {
  EQUAL: "EQUAL",
  LESS_THAN: "LESS_THAN",
  GREATER_THAN: "GREATER_THAN",
  ARRAY_CONTAINS: "ARRAY_CONTAINS",
};

export async function runQuery(opts: QueryOptions): Promise<QueryResult[]> {
  const parentPath = opts.parent ? `/${opts.parent}` : "";
  const url = `${root()}${parentPath}:runQuery`;

  const structuredQuery: Record<string, unknown> = {
    from: [
      {
        collectionId: opts.collection,
        ...(opts.allDescendants ? { allDescendants: true } : {}),
      },
    ],
  };

  if (opts.filters && opts.filters.length === 1) {
    const f = opts.filters[0];
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: f.field },
        op: OP_MAP[f.op] ?? f.op,
        value: encode(f.value),
      },
    };
  } else if (opts.filters && opts.filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: "AND",
        filters: opts.filters.map((f) => ({
          fieldFilter: {
            field: { fieldPath: f.field },
            op: OP_MAP[f.op] ?? f.op,
            value: encode(f.value),
          },
        })),
      },
    };
  }

  if (opts.orderBy) {
    structuredQuery.orderBy = [
      {
        field: { fieldPath: opts.orderBy.field },
        direction: opts.orderBy.direction ?? "ASCENDING",
      },
    ];
  }

  if (opts.limit) {
    structuredQuery.limit = opts.limit;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!res.ok) return [];

  const rows = (await res.json()) as Array<{
    document?: { name: string; fields?: Record<string, FsValue> };
  }>;

  return rows
    .filter((r) => r.document)
    .map((r) => {
      const name = r.document!.name;
      const projectPrefix = `projects/${PROJECT_ID}/databases/(default)/documents/`;
      const path = name.includes(projectPrefix)
        ? name.split(projectPrefix)[1]
        : name;
      return {
        path,
        id: docIdFromName(name),
        data: decodeFields(r.document!.fields ?? {}),
      };
    });
}
