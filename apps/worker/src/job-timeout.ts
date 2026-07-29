export async function runWithTimeout(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Document job timed out"));
    }, timeoutMs);
  });
  try {
    await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
