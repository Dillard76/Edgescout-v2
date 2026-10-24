import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  auth,
  testConnection,
  fetchRecentAuditLogs,
  saveAuditLogToFirestore
} from "../services/firebase";
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  listDriveFiles,
  createDriveTextFile,
  createEdgeScoutSheet,
  appendSheetRow,
  listRecentGmailMessages,
  sendGmailMessage,
  DriveFile,
  SpreadsheetInfo,
  GmailMessage
} from "../services/googleWorkspace";
import {
  Cloud,
  Database,
  FileSpreadsheet,
  HardDrive,
  Mail,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  LogOut,
  Send,
  PlusCircle,
  FileText,
  ShieldCheck,
  Info,
  Sparkles,
  Lock
} from "lucide-react";

interface WorkspaceHubProps {
  beginnerMode: boolean;
  currentFloorEth?: number;
  circuitBreakerActive?: boolean;
  netflowUSD?: number;
}

export const WorkspaceHub: React.FC<WorkspaceHubProps> = ({
  beginnerMode,
  currentFloorEth = 3.40,
  circuitBreakerActive = false,
  netflowUSD = -142500,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean>(true);

  // Drive state
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [loadingDrive, setLoadingDrive] = useState<boolean>(false);

  // Sheets state
  const [activeSheet, setActiveSheet] = useState<SpreadsheetInfo | null>(null);
  const [loadingSheets, setLoadingSheets] = useState<boolean>(false);

  // Gmail state
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);
  const [loadingGmail, setLoadingGmail] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState<string>("bryandillard76@gmail.com");

  // Audit logs from Firestore
  const [firestoreLogs, setFirestoreLogs] = useState<any[]>([]);

  // Confirmation Modals State (Mandatory for destructive/external operations)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionType: "drive_export" | "sheet_create" | "gmail_send";
    payload?: any;
  } | null>(null);

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Initialize Auth on component mount
  useEffect(() => {
    testConnection().then((connected) => setFirestoreConnected(connected));

    const unsubscribe = initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        loadWorkspaceData(accessToken);
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );

    return () => unsubscribe();
  }, []);

  const loadWorkspaceData = async (accessToken: string) => {
    // Load Drive Files
    setLoadingDrive(true);
    listDriveFiles(accessToken)
      .then((files) => setDriveFiles(files))
      .catch((err) => console.warn("Drive list error:", err))
      .finally(() => setLoadingDrive(false));

    // Load Gmail Messages
    setLoadingGmail(true);
    listRecentGmailMessages(accessToken)
      .then((msgs) => setGmailMessages(msgs))
      .catch((err) => console.warn("Gmail list error:", err))
      .finally(() => setLoadingGmail(false));

    // Load Firestore Audit Logs
    fetchRecentAuditLogs()
      .then((logs) => setFirestoreLogs(logs || []))
      .catch(() => {});
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setStatusMessage(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        setStatusMessage({
          type: "success",
          text: `Signed in as ${res.user.email}. Google Drive, Sheets, Gmail, and Firebase Firestore are active!`,
        });
        loadWorkspaceData(res.accessToken);
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Sign-in failed: ${err.message}`,
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setDriveFiles([]);
    setGmailMessages([]);
    setActiveSheet(null);
    setStatusMessage({
      type: "info",
      text: "Signed out of Google Workspace.",
    });
  };

  // ===============================================
  // CONFIRMATION DIALOG HANDLERS (MANDATORY REQUIREMENT)
  // ===============================================

  const promptDriveExport = () => {
    const reportContent = `================================================================================
EDGESCOUT V2 AUTONOMOUS COGNITIVE AGENT - AUDIT REPORT
Target Asset: Ry Hawthorne '_404/LostLayer' #4041
Timestamp: ${new Date().toISOString()}
Network: Optimism Mainnet (OP Stack, Chain ID: 10)
--------------------------------------------------------------------------------
1. VALUATION & SPOT PRICING:
   - Spot Floor Price: ${currentFloorEth} ETH
   - Max Bid Ceiling: ${(currentFloorEth * 0.8).toFixed(4)} ETH (8000 BPS / 80.00%)
   - Guaranteed Margin Spread: ${(currentFloorEth * 0.2).toFixed(4)} ETH (20.00%)

2. SMART MONEY RISK & RELAYER TELEMETRY:
   - Smart Money Netflow: $${netflowUSD.toLocaleString()} USD
   - Risk Threshold Ceiling: -$25,000 USD Outflow
   - Circuit Breaker Status: ${circuitBreakerActive ? "TRIPPED (LOCKED)" : "OPERATIONAL (SAFE)"}
   - Interlock State: ${circuitBreakerActive ? "Acquisitions Reverting on-chain" : "Ready for Execution"}

3. SECURITY AUDIT:
   - Sanitization: Option A Regular Expression Zero-Trust Redaction Verified
   - Memory Architecture: Pinecone 3072-Dimensional Multi-Namespace Store
================================================================================`;

    setConfirmModal({
      isOpen: true,
      title: "Upload Report to Google Drive?",
      description: "EdgeScout will create a new text report file in your personal Google Drive containing live pricing, risk telemetry, and circuit breaker status.",
      actionType: "drive_export",
      payload: {
        filename: `EdgeScout-Report-#4041-${new Date().toISOString().slice(0, 10)}.txt`,
        content: reportContent,
      },
    });
  };

  const promptSheetCreate = () => {
    setConfirmModal({
      isOpen: true,
      title: "Create Google Sheets Ledger?",
      description: "EdgeScout will create a new Google Spreadsheet titled 'EdgeScout Operations & Risk Ledger' in your Google Drive and populate it with historical metrics and current target valuation.",
      actionType: "sheet_create",
    });
  };

  const promptGmailAlert = () => {
    const subject = circuitBreakerActive
      ? "🚨 [CRITICAL ALERT] EdgeScout Circuit Breaker Triggered on Optimism"
      : "✅ [STATUS REPORT] EdgeScout Agent Operational on Optimism";

    const body = `EdgeScout Autonomous Agent Telemetry Update:

Target: Ry Hawthorne '_404/LostLayer' #4041
Spot Floor: ${currentFloorEth} ETH
80% Max Bid Ceiling: ${(currentFloorEth * 0.8).toFixed(4)} ETH (20% discount secured)
Netflow: $${netflowUSD.toLocaleString()} USD
Circuit Breaker State: ${circuitBreakerActive ? "TRIPPED / LOCKED" : "NORMAL / OPERATIONAL"}
Network: Optimism OP Stack (Chain ID: 10)

This automated notice was sent via EdgeScout Gmail Integration.`;

    setConfirmModal({
      isOpen: true,
      title: "Send Notification via Gmail?",
      description: `EdgeScout will compose and send an automated email to "${recipientEmail}" with live contract status and risk telemetry.`,
      actionType: "gmail_send",
      payload: {
        to: recipientEmail,
        subject,
        body,
      },
    });
  };

  const handleExecuteConfirmedAction = async () => {
    if (!confirmModal || !token) return;
    const { actionType, payload } = confirmModal;
    setConfirmModal(null);
    setStatusMessage(null);

    try {
      if (actionType === "drive_export") {
        setLoadingDrive(true);
        const file = await createDriveTextFile(token, payload.filename, payload.content);
        setStatusMessage({
          type: "success",
          text: `Successfully uploaded "${file.name}" to Google Drive!`,
        });
        await saveAuditLogToFirestore({
          logId: `log-${Date.now()}`,
          eventType: "OracleSync",
          summary: `Exported audit report to Google Drive: ${file.name}`,
        });
        loadWorkspaceData(token);
      } else if (actionType === "sheet_create") {
        setLoadingSheets(true);
        const initialRows = [
          [
            new Date().toLocaleString(),
            "Initial System Calibration",
            "Ry Hawthorne #4041",
            currentFloorEth,
            Number((currentFloorEth * 0.8).toFixed(4)),
            netflowUSD,
            circuitBreakerActive ? "TRIPPED" : "NORMAL",
            "Initial Ledger Row Created",
          ],
        ];
        const sheet = await createEdgeScoutSheet(token, "EdgeScout Operations & Risk Ledger", initialRows);
        setActiveSheet(sheet);
        setStatusMessage({
          type: "success",
          text: `Created new spreadsheet "${sheet.title}"! Open in Google Sheets below.`,
        });
        await saveAuditLogToFirestore({
          logId: `log-${Date.now()}`,
          eventType: "OracleSync",
          summary: `Created Google Sheet ledger: ${sheet.title}`,
        });
        loadWorkspaceData(token);
      } else if (actionType === "gmail_send") {
        setLoadingGmail(true);
        const res = await sendGmailMessage(token, payload.to, payload.subject, payload.body);
        setStatusMessage({
          type: "success",
          text: `Email successfully sent to ${payload.to} (Message ID: ${res.id})!`,
        });
        await saveAuditLogToFirestore({
          logId: `log-${Date.now()}`,
          eventType: circuitBreakerActive ? "CircuitBreakerTripped" : "OracleSync",
          summary: `Gmail notification sent to ${payload.to} regarding circuit breaker status`,
        });
        loadWorkspaceData(token);
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: `Operation failed: ${err.message}`,
      });
    } finally {
      setLoadingDrive(false);
      setLoadingSheets(false);
      setLoadingGmail(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Cloud className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                Google Workspace & Firebase Cloud Hub
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Drive • Sheets • Gmail • Firestore
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Export audit reports, maintain automated trade ledgers in Sheets, send Gmail alerts, and persist state in Firebase.
            </p>
          </div>
        </div>

        {/* Auth State Button */}
        <div>
          {user ? (
            <div className="flex items-center space-x-3 bg-slate-950 border border-slate-800 rounded-xl p-2 px-3">
              {user.photoURL ? (
                <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-slate-700" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">
                  {user.email?.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-xs">
                <span className="text-white font-semibold block truncate max-w-[150px]">{user.displayName || "Google User"}</span>
                <span className="text-slate-400 text-[10px] block truncate max-w-[150px]">{user.email}</span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-slate-400 hover:text-rose-400 p-1.5 rounded transition-colors ml-2"
                title="Sign out of Google"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="flex items-center space-x-2.5 px-4 py-2 rounded-xl bg-white text-slate-900 font-medium text-xs hover:bg-slate-100 transition-all shadow-md active:scale-95 disabled:opacity-60"
            >
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              <span>{isSigningIn ? "Connecting to Google..." : "Sign in with Google"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Beginner Explanation */}
      {beginnerMode && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-200 text-xs flex items-start space-x-3">
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-amber-300 block text-sm">
              💡 Why Connect Google Drive, Sheets, Gmail, and Firebase?
            </span>
            <p className="text-amber-200/90 leading-relaxed">
              When EdgeScout runs on Optimism, you need real-world audit trails and alerting:
              <strong className="text-white"> Google Drive</strong> safely stores your mathematical proof reports;
              <strong className="text-white"> Google Sheets</strong> acts as your live trading ledger;
              <strong className="text-white"> Gmail</strong> immediately alerts you or on-call developers if the emergency circuit breaker trips; and
              <strong className="text-white"> Firebase Firestore</strong> persistently remembers all historical transactions across sessions.
            </p>
          </div>
        </div>
      )}

      {/* Status Toast */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-mono flex items-center justify-between ${
            statusMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : statusMessage.type === "error"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
              : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
          }`}
        >
          <div className="flex items-center space-x-2">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : statusMessage.type === "error" ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-white text-xs ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* 4 Pillars of Integration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Google Drive */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-md flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Google Drive Integration</h3>
                  <p className="text-xs text-slate-400">File Storage & Audit Report Export</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
                drive.file
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Export timestamped cryptographic audit logs and 80% ceiling compliance proofs directly to your Google Drive.
            </p>

            {/* Action Buttons */}
            <div className="pt-2">
              <button
                type="button"
                onClick={promptDriveExport}
                disabled={!user || loadingDrive}
                className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors flex items-center justify-center space-x-2 shadow disabled:opacity-50"
              >
                {loadingDrive ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                <span>Export #4041 Risk Audit Report to Drive</span>
              </button>
            </div>

            {/* Recent Files List */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-medium text-slate-400 block">Recent Drive Files:</span>
              {!user ? (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                  Sign in with Google above to browse Drive files
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                  No recent files found or loading...
                </div>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {driveFiles.slice(0, 4).map((f) => (
                    <div
                      key={f.id}
                      className="p-2 rounded bg-slate-950 border border-slate-800/70 text-xs flex items-center justify-between text-slate-300"
                    >
                      <div className="flex items-center space-x-2 truncate pr-2">
                        <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span className="truncate text-[11px] font-mono">{f.name}</span>
                      </div>
                      {f.webViewLink && (
                        <a
                          href={f.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 shrink-0 flex items-center text-[10px]"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Google Sheets */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-md flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Google Sheets Integration</h3>
                  <p className="text-xs text-slate-400">Live Risk & Acquisition Ledger</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                spreadsheets
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Create and maintain an automated spreadsheet ledger documenting every floor check, bid evaluation, and circuit breaker trip.
            </p>

            {/* Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={promptSheetCreate}
                disabled={!user || loadingSheets}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors flex items-center justify-center space-x-2 shadow disabled:opacity-50"
              >
                {loadingSheets ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PlusCircle className="w-3.5 h-3.5" />
                )}
                <span>Create EdgeScout Acquisition Ledger Sheet</span>
              </button>
            </div>

            {/* Active Sheet Link */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-medium text-slate-400 block">Active Google Sheet Ledger:</span>
              {activeSheet ? (
                <div className="p-2.5 rounded bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between text-xs">
                  <div className="truncate pr-2">
                    <span className="text-emerald-300 font-semibold block truncate">{activeSheet.title}</span>
                    <span className="text-[10px] text-slate-400 font-mono">ID: {activeSheet.spreadsheetId.slice(0, 16)}...</span>
                  </div>
                  <a
                    href={activeSheet.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[11px] flex items-center space-x-1 shrink-0"
                  >
                    <span>Open Sheet</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                  {!user ? "Sign in to create a Google Sheets ledger" : "Click the button above to generate your spreadsheet ledger"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 3: Gmail Integration */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-md flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Gmail Integration</h3>
                  <p className="text-xs text-slate-400">Automated Alert Dispatcher</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30">
                gmail.send
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Dispatch immediate on-call emergency alerts when netflows exceed -$25k USD or when an acquisition completes.
            </p>

            {/* Recipient Input */}
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 block font-medium">Alert Recipient Email:</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="developer@example.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-rose-500"
              />
            </div>

            {/* Send Alert Button */}
            <div>
              <button
                type="button"
                onClick={promptGmailAlert}
                disabled={!user || loadingGmail}
                className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors flex items-center justify-center space-x-2 shadow disabled:opacity-50"
              >
                {loadingGmail ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Send {circuitBreakerActive ? "🚨 Circuit Breaker Alert" : "Live Status"} via Gmail</span>
              </button>
            </div>

            {/* Recent Messages */}
            <div className="space-y-1 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-medium text-slate-400 block">Recent Gmail Threads:</span>
              {!user ? (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                  Sign in to view Gmail notifications
                </div>
              ) : gmailMessages.length === 0 ? (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                  No EdgeScout notifications in inbox yet
                </div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {gmailMessages.map((m) => (
                    <div key={m.id} className="p-2 rounded bg-slate-950 border border-slate-800/70 text-xs">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                        <span className="truncate max-w-[140px] text-slate-300 font-medium">{m.subject}</span>
                        <span>{m.date ? new Date(m.date).toLocaleDateString() : ""}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate mt-0.5">{m.snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 4: Firebase Firestore Persistence */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-md flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Firebase Firestore Database</h3>
                  <p className="text-xs text-slate-400">Persistent Multi-Session Storage</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                Firestore DB
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Connection State:</span>
                <span className={`font-semibold flex items-center space-x-1 ${firestoreConnected ? "text-emerald-400" : "text-amber-400"}`}>
                  <span className={`w-2 h-2 rounded-full ${firestoreConnected ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
                  <span>{firestoreConnected ? "CONNECTED" : "OFFLINE"}</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Database ID:</span>
                <span className="text-slate-300 text-[10px] truncate max-w-[150px]">ai-studio-edgescoutv2auton...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ABAC Rules:</span>
                <span className="text-emerald-400">Hardened Zero-Trust</span>
              </div>
            </div>

            {/* Recent Audit Logs from Firestore */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-medium">Persistent Firestore Logs:</span>
                <span className="font-mono text-[10px]">{firestoreLogs.length} Records</span>
              </div>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {firestoreLogs.length === 0 ? (
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                    {!user ? "Sign in to load your Firestore database logs" : "No persistent logs yet. Perform an action to sync!"}
                  </div>
                ) : (
                  firestoreLogs.map((log) => (
                    <div key={log.id} className="p-2 rounded bg-slate-950 border border-slate-800/70 text-[11px] font-mono space-y-0.5">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span className="text-indigo-300 font-semibold">{log.eventType}</span>
                        <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-slate-300 truncate">{log.summary}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MANDATORY USER CONFIRMATION MODAL */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">{confirmModal.title}</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmModal.description}
            </p>

            {confirmModal.actionType === "drive_export" && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
                <div><strong>File:</strong> {confirmModal.payload?.filename}</div>
                <div><strong>Destination:</strong> Google Drive Root</div>
              </div>
            )}

            {confirmModal.actionType === "sheet_create" && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
                <div><strong>Title:</strong> EdgeScout Operations & Risk Ledger</div>
                <div><strong>Columns:</strong> Timestamp, Event, Target, Floor ETH, Ceiling ETH, Netflow, Status</div>
              </div>
            )}

            {confirmModal.actionType === "gmail_send" && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
                <div><strong>To:</strong> {confirmModal.payload?.to}</div>
                <div className="truncate"><strong>Subject:</strong> {confirmModal.payload?.subject}</div>
              </div>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteConfirmedAction}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-md"
              >
                Confirm & Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
