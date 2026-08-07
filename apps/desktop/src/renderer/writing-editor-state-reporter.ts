import type { NovelStudioApi, WritingEditorStateReport } from "@novel-studio/application";

export interface WritingEditorStateIdentity {
  readonly workspaceId: string;
  readonly resourceKind: WritingEditorStateReport["resourceKind"];
  readonly resourceId: string;
  readonly editorInstanceId: string;
}

/** Stable renderer identity retained for one mounted editor instance. */
export interface WritingEditorRendererSession {
  readonly workspaceId: string;
  readonly editorInstanceId: string;
}

export interface WritingEditorStateSnapshot extends WritingEditorStateIdentity {
  readonly dirty: boolean;
  readonly bufferContent: string;
}

export type WritingEditorStateReportStatus =
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

export interface WritingEditorStateReporter {
  open(snapshot: WritingEditorStateSnapshot): Promise<WritingEditorStateReportStatus>;
  report(snapshot: WritingEditorStateSnapshot): Promise<WritingEditorStateReportStatus>;
  disconnect(): Promise<WritingEditorStateReportStatus>;
}

/**
 * Maintains the renderer half of the Main-owned editor liveness handshake. A report is not
 * considered connected until Main has acknowledged its revision and the renderer has echoed that
 * acknowledgement back using the same immutable snapshot revision.
 */
export function createWritingEditorStateReporter(api: NovelStudioApi): WritingEditorStateReporter {
  let active: WritingEditorStateIdentity | undefined;
  let lastSnapshot: WritingEditorStateSnapshot | undefined;
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
        if (active === undefined) return unknown("EDITOR_STATE_NOT_OPEN");
        const previous = lastSnapshot;
        if (previous === undefined) return unknown("EDITOR_STATE_NOT_OPEN");
        // A clean close explicitly proves that this resource no longer has a renderer buffer.
        // A dirty close is reported as unknown instead of discarding the draft and accidentally
        // allowing a later mutation to treat it as clean.
        const closed = previous.dirty ? previous : { ...previous, dirty: false, bufferContent: "" };
        const status = await send(closed, previous.dirty ? "unknown" : "disconnected", true);
        active = undefined;
        lastSnapshot = undefined;
        acknowledgedRevision = 0;
        return status;
      });
    }
  };

  function enqueue(
    operation: () => Promise<WritingEditorStateReportStatus>
  ): Promise<WritingEditorStateReportStatus> {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function send(
    snapshot: WritingEditorStateSnapshot,
    connection: WritingEditorStateReport["connection"],
    advanceRevision: boolean
  ): Promise<WritingEditorStateReportStatus> {
    const writingEditor = api.writingEditor;
    if (writingEditor === undefined) return unknown("EDITOR_STATE_UNAVAILABLE");
    let bufferChecksum: string;
    try {
      bufferChecksum = await checksumBuffer(snapshot.bufferContent);
    } catch {
      return unknown("EDITOR_STATE_HASH_UNAVAILABLE");
    }
    if (advanceRevision) rendererRevision += 1;
    const report: WritingEditorStateReport = {
      ...identityOf(snapshot),
      connection,
      rendererRevision,
      acknowledgedRevision,
      dirty: snapshot.dirty,
      bufferChecksum,
      bufferContent: snapshot.bufferContent
    };
    let received;
    try {
      received = await writingEditor.reportState(report);
    } catch {
      return unknown("EDITOR_STATE_REJECTED");
    }
    if (!received.ok) return unknown("EDITOR_STATE_REJECTED");
    if (!isExpectedAcknowledgement(received.acknowledgement, report)) {
      return unknown("EDITOR_STATE_ACK_INVALID");
    }
    acknowledgedRevision = received.acknowledgement.rendererRevision;

    const acknowledgedReport: WritingEditorStateReport = {
      ...report,
      acknowledgedRevision
    };
    try {
      received = await writingEditor.reportState(acknowledgedReport);
    } catch {
      return unknown("EDITOR_STATE_REJECTED");
    }
    if (!received.ok) return unknown("EDITOR_STATE_REJECTED");
    if (!isExpectedAcknowledgement(received.acknowledgement, acknowledgedReport)) {
      return unknown("EDITOR_STATE_ACK_INVALID");
    }
    acknowledgedRevision = received.acknowledgement.rendererRevision;
    return { status: "connected", rendererRevision };
  }
}

function identityOf(snapshot: WritingEditorStateIdentity): WritingEditorStateIdentity {
  return {
    workspaceId: snapshot.workspaceId,
    resourceKind: snapshot.resourceKind,
    resourceId: snapshot.resourceId,
    editorInstanceId: snapshot.editorInstanceId
  };
}

function sameIdentity(
  left: WritingEditorStateIdentity,
  right: WritingEditorStateIdentity
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.resourceKind === right.resourceKind &&
    left.resourceId === right.resourceId &&
    left.editorInstanceId === right.editorInstanceId
  );
}

function isExpectedAcknowledgement(
  acknowledgement: {
    readonly workspaceId: string;
    readonly resourceKind: WritingEditorStateReport["resourceKind"];
    readonly resourceId: string;
    readonly editorInstanceId: string;
    readonly rendererRevision: number;
  },
  report: WritingEditorStateReport
): boolean {
  return (
    acknowledgement.workspaceId === report.workspaceId &&
    acknowledgement.resourceKind === report.resourceKind &&
    acknowledgement.resourceId === report.resourceId &&
    acknowledgement.editorInstanceId === report.editorInstanceId &&
    acknowledgement.rendererRevision === report.rendererRevision
  );
}

function unknown(
  code: Extract<WritingEditorStateReportStatus, { readonly status: "unknown" }>["code"]
): WritingEditorStateReportStatus {
  return { status: "unknown", code };
}

async function checksumBuffer(content: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle === undefined) throw new Error("Web Crypto is unavailable.");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
