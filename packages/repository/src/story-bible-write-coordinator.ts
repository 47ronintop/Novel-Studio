import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

interface StoryBibleWriteQueue {
  readonly tail: Promise<void>;
}

const projectWriteQueues = new Map<string, StoryBibleWriteQueue>();

/**
 * Serializes Story Bible mutations across repository and Agent transaction instances in this
 * process. The desktop project lock already prevents a second application owner; this coordinator
 * closes the in-process gap between a reference-impact check and the corresponding atomic replace.
 */
export async function withStoryBibleProjectWriteLock<T>(
  projectRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = await canonicalProjectKey(projectRoot);
  const previous = projectWriteQueues.get(key)?.tail ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  const queue = { tail };
  projectWriteQueues.set(key, queue);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (projectWriteQueues.get(key) === queue) {
      projectWriteQueues.delete(key);
    }
  }
}

async function canonicalProjectKey(projectRoot: string): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(projectRoot);
  } catch {
    canonicalRoot = resolve(projectRoot);
  }
  return process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
}
