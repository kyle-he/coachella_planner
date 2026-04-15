import "server-only";

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = getApps()[0] ?? initializeApp();

/**
 * Shared Firestore Admin client for all server handlers/routes.
 * App Hosting injects service account credentials automatically.
 */
export const db = getFirestore(app);
