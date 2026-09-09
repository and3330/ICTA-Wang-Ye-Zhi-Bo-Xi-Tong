type Stopper = () => void | Promise<void>;

const stoppers = new Set<Stopper>();
const inFlight = new Set<Promise<unknown>>();
const schedulerState = new Map<string, {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
}>();
let acceptingWork = true;

export function isAcceptingWork(): boolean {
  return acceptingWork;
}

export function beginShutdown(): boolean {
  if (!acceptingWork) return false;
  acceptingWork = false;
  return true;
}

export function registerStopper(stopper: Stopper): () => void {
  stoppers.add(stopper);
  return () => stoppers.delete(stopper);
}

export function trackOperation<T>(operation: Promise<T>): Promise<T> {
  inFlight.add(operation);
  void operation.finally(() => inFlight.delete(operation)).catch(() => undefined);
  return operation;
}

export function schedulerAttempt(name: string): void {
  const current = schedulerState.get(name);
  schedulerState.set(name, {
    lastAttemptAt: new Date(),
    lastSuccessAt: current?.lastSuccessAt ?? null,
    consecutiveFailures: current?.consecutiveFailures ?? 0,
  });
}

export function schedulerSuccess(name: string): void {
  schedulerState.set(name, {
    lastAttemptAt: new Date(),
    lastSuccessAt: new Date(),
    consecutiveFailures: 0,
  });
}

export function schedulerFailure(name: string): void {
  const current = schedulerState.get(name);
  schedulerState.set(name, {
    lastAttemptAt: new Date(),
    lastSuccessAt: current?.lastSuccessAt ?? null,
    consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
  });
}

export function schedulerMetrics() {
  return Object.fromEntries(Array.from(schedulerState).map(([name, state]) => [name, {
    lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
    consecutiveFailures: state.consecutiveFailures,
  }]));
}

export async function stopRegisteredResources(): Promise<void> {
  await Promise.allSettled(Array.from(stoppers).map((stopper) => Promise.resolve().then(stopper)));
}

export async function drainOperations(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size > 0 && Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    await Promise.race([
      Promise.allSettled(Array.from(inFlight)),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
  }
  return inFlight.size === 0;
}

export function inFlightOperationCount(): number {
  return inFlight.size;
}