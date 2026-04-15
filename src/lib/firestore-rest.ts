/**
 * Server-side Firestore helper backed by Firebase Admin SDK.
 * This works in App Hosting production and local emulator workflows.
 */

import { CollectionReference } from "firebase-admin/firestore";
import { db } from "./firebase-admin";

interface QueryFilter {
  field: string;
  op: "EQUAL" | "LESS_THAN" | "GREATER_THAN" | "ARRAY_CONTAINS";
  value: unknown;
}

interface QueryOptions {
  collection: string;
  allDescendants?: boolean;
  filters?: QueryFilter[];
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" };
  limit?: number;
  parent?: string;
}

interface QueryResult {
  path: string;
  id: string;
  data: Record<string, unknown>;
}

const OP_MAP: Record<QueryFilter["op"], FirebaseFirestore.WhereFilterOp> = {
  EQUAL: "==",
  LESS_THAN: "<",
  GREATER_THAN: ">",
  ARRAY_CONTAINS: "array-contains",
};

export async function setDoc(
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  await db.doc(path).set(data);
}

export async function getDoc(
  path: string
): Promise<Record<string, unknown> | null> {
  const snap = await db.doc(path).get();
  return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
}

export async function deleteDoc(path: string): Promise<void> {
  await db.doc(path).delete();
}

export async function updateDoc(
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  await db.doc(path).set(data, { merge: true });
}

export async function listDocs(
  collectionPath: string
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const snap = await db.collection(collectionPath).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    data: (doc.data() ?? {}) as Record<string, unknown>,
  }));
}

function getQueryBase(opts: QueryOptions):
  | FirebaseFirestore.Query
  | CollectionReference {
  if (opts.allDescendants) {
    return db.collectionGroup(opts.collection);
  }
  if (opts.parent) {
    return db.doc(opts.parent).collection(opts.collection);
  }
  return db.collection(opts.collection);
}

export async function runQuery(opts: QueryOptions): Promise<QueryResult[]> {
  let query: FirebaseFirestore.Query = getQueryBase(opts);

  for (const filter of opts.filters ?? []) {
    query = query.where(filter.field, OP_MAP[filter.op], filter.value);
  }

  if (opts.orderBy) {
    query = query.orderBy(
      opts.orderBy.field,
      opts.orderBy.direction === "DESCENDING" ? "desc" : "asc"
    );
  }

  if (opts.limit) {
    query = query.limit(opts.limit);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    path: doc.ref.path,
    id: doc.id,
    data: (doc.data() ?? {}) as Record<string, unknown>,
  }));
}
