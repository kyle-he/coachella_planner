import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function initAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  // Firebase App Hosting / GCP: credentials are injected automatically.
  // Vercel: provide a service account JSON via env.
  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim() ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim() ||
    "";

  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    return initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // Vercel UI sometimes stores newlines escaped.
        privateKey: parsed.private_key?.replace(/\\n/g, "\n"),
      }),
      projectId: parsed.project_id || process.env.FIREBASE_PROJECT_ID,
    });
  }

  return initializeApp();
}

const app = initAdminApp();

/**
 * Shared Firestore Admin client for all server handlers/routes.
 * App Hosting injects service account credentials automatically.
 */
export const db = getFirestore(app);
