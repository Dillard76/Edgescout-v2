import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User
} from "firebase/auth";
import { auth, saveWorkspaceSyncRecord } from "./firebase";

// Google Workspace Scopes
export const WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));

// In-memory token management
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Google sign in");
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// ==========================================
// GOOGLE DRIVE API INTEGRATION
// ==========================================

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

export async function listDriveFiles(token: string): Promise<DriveFile[]> {
  const url = "https://www.googleapis.com/drive/v3/files?pageSize=15&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=modifiedTime%20desc";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Drive API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.files || [];
}

export async function createDriveTextFile(
  token: string,
  filename: string,
  content: string,
  mimeType = "text/plain"
): Promise<DriveFile> {
  const metadata = {
    name: filename,
    mimeType,
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append("file", new Blob([content], { type: mimeType }));

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to upload file to Google Drive: ${errorText}`);
  }

  const file = await res.json();
  await saveWorkspaceSyncRecord({
    syncId: `drive-${Date.now()}`,
    service: "drive",
    title: filename,
    externalId: file.id,
    status: "Uploaded to Google Drive",
  });

  return file;
}

// ==========================================
// GOOGLE SHEETS API INTEGRATION
// ==========================================

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
}

export async function createEdgeScoutSheet(
  token: string,
  title: string,
  initialRows: Array<Array<string | number>> = []
): Promise<SpreadsheetInfo> {
  const requestBody = {
    properties: {
      title,
    },
    sheets: [
      {
        properties: {
          title: "EdgeScout Operations Ledger",
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: [
                  { userEnteredValue: { stringValue: "Timestamp" } },
                  { userEnteredValue: { stringValue: "Event / Action" } },
                  { userEnteredValue: { stringValue: "Asset / Target" } },
                  { userEnteredValue: { stringValue: "Floor Price (ETH)" } },
                  { userEnteredValue: { stringValue: "Max Bid Ceiling (ETH)" } },
                  { userEnteredValue: { stringValue: "Netflow (USD)" } },
                  { userEnteredValue: { stringValue: "Circuit Breaker" } },
                  { userEnteredValue: { stringValue: "Status / Notes" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Sheets API error: ${errorText}`);
  }

  const result = await res.json();
  const info: SpreadsheetInfo = {
    spreadsheetId: result.spreadsheetId,
    title: result.properties.title,
    spreadsheetUrl: result.spreadsheetUrl,
  };

  // If there are initial rows, append them
  if (initialRows.length > 0) {
    await appendSheetRow(token, result.spreadsheetId, initialRows);
  }

  await saveWorkspaceSyncRecord({
    syncId: `sheet-${Date.now()}`,
    service: "sheets",
    title: info.title,
    externalId: info.spreadsheetId,
    status: "Created Google Sheet Ledger",
  });

  return info;
}

export async function appendSheetRow(
  token: string,
  spreadsheetId: string,
  values: Array<Array<string | number>>
) {
  const range = "EdgeScout Operations Ledger!A:H";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to append row to Google Sheets: ${errorText}`);
  }

  return await res.json();
}

// ==========================================
// GMAIL API INTEGRATION
// ==========================================

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  from?: string;
  date?: string;
}

export async function listRecentGmailMessages(token: string): Promise<GmailMessage[]> {
  const listUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=EdgeScout OR Optimism OR Alert";
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gmail API error: ${errorText}`);
  }

  const listData = await res.json();
  const messages = listData.messages || [];

  const detailed: GmailMessage[] = [];
  for (const m of messages.slice(0, 5)) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (msgRes.ok) {
        const d = await msgRes.json();
        const headers = d.payload?.headers || [];
        const subject = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "No Subject";
        const from = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "";
        const date = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "";
        detailed.push({
          id: d.id,
          threadId: d.threadId,
          snippet: d.snippet,
          subject,
          from,
          date,
        });
      }
    } catch {
      // Continue next message
    }
  }

  return detailed;
}

export async function sendGmailMessage(
  token: string,
  to: string,
  subject: string,
  bodyText: string
): Promise<{ id: string }> {
  // Construct RFC 2822 email message
  const emailLines = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "",
    bodyText,
  ];

  const rawMessage = emailLines.join("\r\n");
  const encodedMessage = btoa(unescape(encodeURIComponent(rawMessage)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedMessage }),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to send email via Gmail: ${errorText}`);
  }

  const result = await res.json();
  await saveWorkspaceSyncRecord({
    syncId: `gmail-${Date.now()}`,
    service: "gmail",
    title: subject,
    externalId: result.id,
    status: `Email sent to ${to}`,
  });

  return result;
}
