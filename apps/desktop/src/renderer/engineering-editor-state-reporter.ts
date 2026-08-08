import type { EngineeringEditorStateReport, NovelStudioApi } from "@novel-studio/application";

export interface EngineeringEditorStateIdentity {
  readonly rootBindingId: string;
  /** Canonical POSIX relative identity, named `relativePath` at the Main boundary. */
  readonly relativePath: string;
  readonly editorInstanceId: string;
}

export interface EngineeringEditorStateSnapshot extends EngineeringEditorStateIdentity {
  readonly dirty: boolean;
  /** Sent only while dirty; Main exposes it only through its explicit-share read path. */
  readonly bufferContent: string;
}

export type EngineeringEditorStateReportStatus =
  | { readonly status: "connected"; readonly rendererRevision: number }
  | {
      readonly status: "unknown";
      readonly code:
        | "EDITOR_STATE_UNAVAILABLE"
        | "EDITOR_STATE_NOT_OPEN"
        | "EDITOR_STATE_RESOURCE_MISMATCH"
        | "EDITOR_STATE_ACK_INVALID"
        | "EDITOR_STATE_HASH_UNAVAILABLE"
        | "EDITOR_STATE_REJECTED";
    };

export interface EngineeringEditorStateReporter {
  open(snapshot: EngineeringEditorStateSnapshot): Promise<EngineeringEditorStateReportStatus>;
  report(snapshot: EngineeringEditorStateSnapshot): Promise<EngineeringEditorStateReportStatus>;
  disconnect(): Promise<EngineeringEditorStateReportStatus>;
}

/**
 * Renderer half of the engineering editor liveness handshake. Main must acknowledge a report and
 * the renderer must echo that acknowledgement before the editor is considered connected.
 */
export function createEngineeringEditorStateReporter(
  api: NovelStudioApi
): EngineeringEditorStateReporter {
  let active: EngineeringEditorStateIdentity | undefined;
  let lastSnapshot: EngineeringEditorStateSnapshot | undefined;
  let rendererRevision = 0;
  let acknowledgedRevision = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    open(snapshot) {
      return enqueue(async () => {
        if (active !== undefined && !sameIdentity(active, snapshot)) {
          return unknown("EDITOR_STATE_RESOURCE_MISMATCH");
        }
        active = identityOf(snapshot);
        lastSnapshot = snapshot;
        return send(snapshot, "connected", true);
      });
    },
    report(snapshot) {
      return enqueue(async () => {
        if (active === undefined) return unknown("EDITOR_STATE_NOT_OPEN");
        if (!sameIdentity(active, snapshot)) return unknown("EDITOR_STATE_RESOURCE_MISMATCH");
        lastSnapshot = snapshot;
        return send(snapshot, "connected", true);
      });
    },
    disconnect() {
      return enqueue(async () => {
        if (active === undefined || lastSnapshot === undefined) {
          return unknown("EDITOR_STATE_NOT_OPEN");
        }
        const previous = lastSnapshot;
        // Never make a dirty editor appear clean simply because it has closed. Main must reject
        // mutation while that state remains unknown. The unknown report deliberately carries no
        // buffer: retained renderer text is available only from a live, connected editor.
        const closed = { ...previous, dirty: false, bufferContent: "" };
        const status = await send(closed, previous.dirty ? "unknown" : "disconnected", true);
        active = undefined;
        lastSnapshot = undefined;
        acknowledgedRevision = 0;
        return status;
      });
    }
  };

  function enqueue(
    operation: () => Promise<EngineeringEditorStateReportStatus>
  ): Promise<EngineeringEditorStateReportStatus> {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function send(
    snapshot: EngineeringEditorStateSnapshot,
    connection: EngineeringEditorStateReport["connection"],
    advanceRevision: boolean
  ): Promise<EngineeringEditorStateReportStatus> {
    const engineeringEditor = api.engineeringEditor;
    if (engineeringEditor === undefined) return unknown("EDITOR_STATE_UNAVAILABLE");
    const bufferContent = snapshot.dirty ? snapshot.bufferContent : "";
    let bufferChecksum: string;
    try {
      bufferChecksum = await checksumBuffer(bufferContent);
    } catch {
      return unknown("EDITOR_STATE_HASH_UNAVAILABLE");
    }
    if (advanceRevision) rendererRevision += 1;
    const report: EngineeringEditorStateReport = {
      ...identityOf(snapshot),
      connection,
      rendererRevision,
      acknowledgedRevision,
      dirty: snapshot.dirty,
      bufferChecksum,
      bufferContent
    };
    let received;
    try {
      received = await engineeringEditor.reportState(report);
    } catch {
      return unknown("EDITOR_STATE_REJECTED");
    }
    if (!received.ok || !isExpectedAcknowledgement(received.acknowledgement, report)) {
      return unknown(received.ok ? "EDITOR_STATE_ACK_INVALID" : "EDITOR_STATE_REJECTED");
    }
    acknowledgedRevision = received.acknowledgement.rendererRevision;

    try {
      received = await engineeringEditor.reportState({ ...report, acknowledgedRevision });
    } catch {
      return unknown("EDITOR_STATE_REJECTED");
    }
    if (!received.ok || !isExpectedAcknowledgement(received.acknowledgement, report)) {
      return unknown(received.ok ? "EDITOR_STATE_ACK_INVALID" : "EDITOR_STATE_REJECTED");
    }
    acknowledgedRevision = received.acknowledgement.rendererRevision;
    return { status: "connected", rendererRevision };
  }
}

function identityOf(snapshot: EngineeringEditorStateIdentity): EngineeringEditorStateIdentity {
  return {
    rootBindingId: snapshot.rootBindingId,
    relativePath: snapshot.relativePath,
    editorInstanceId: snapshot.editorInstanceId
  };
}

function sameIdentity(
  left: EngineeringEditorStateIdentity,
  right: EngineeringEditorStateIdentity
): boolean {
  return (
    left.rootBindingId === right.rootBindingId &&
    left.relativePath === right.relativePath &&
    left.editorInstanceId === right.editorInstanceId
  );
}

function isExpectedAcknowledgement(
  acknowledgement: {
    readonly rootBindingId: string;
    readonly relativePath: string;
    readonly editorInstanceId: string;
    readonly rendererRevision: number;
  },
  report: EngineeringEditorStateReport
): boolean {
  return (
    acknowledgement.rootBindingId === report.rootBindingId &&
    acknowledgement.relativePath === report.relativePath &&
    acknowledgement.editorInstanceId === report.editorInstanceId &&
    acknowledgement.rendererRevision === report.rendererRevision
  );
}

function unknown(
  code: Extract<EngineeringEditorStateReportStatus, { readonly status: "unknown" }>["code"]
): EngineeringEditorStateReportStatus {
  return { status: "unknown", code };
}

async function checksumBuffer(content: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle === undefined) throw new Error("Web Crypto is unavailable.");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
