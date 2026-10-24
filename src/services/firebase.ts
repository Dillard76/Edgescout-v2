import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App singleton
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Test connection on boot
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firestore client is offline. Verify configuration.");
    }
    return false;
  }
}

// Structured error handler conforming to FirestoreErrorInfo
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error:", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Helpers for EdgeScout persistence
export async function saveAuditLogToFirestore(data: {
  logId: string;
  eventType: "CircuitBreakerTripped" | "AcquisitionExecuted" | "OracleSync" | "SecurityRedaction";
  summary: string;
  details?: string;
}) {
  const user = auth.currentUser;
  if (!user) return null;

  const path = "audit_logs";
  try {
    return await addDoc(collection(db, path), {
      ...data,
      userId: user.uid,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchRecentAuditLogs() {
  const user = auth.currentUser;
  if (!user) return [];

  const path = "audit_logs";
  try {
    const q = query(
      collection(db, path),
      where("userId", "==", user.uid),
      limit(20)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function saveWorkspaceSyncRecord(data: {
  syncId: string;
  service: "drive" | "sheets" | "gmail";
  title: string;
  externalId?: string;
  status: string;
}) {
  const user = auth.currentUser;
  if (!user) return null;

  const path = "workspace_syncs";
  try {
    return await addDoc(collection(db, path), {
      ...data,
      userId: user.uid,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
