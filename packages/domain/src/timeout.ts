/**
 * Run `run` with an AbortSignal that fires after `ms`, and reject with
 * `onTimeout()` at that moment even if `run` ignores the signal.
 *
 * A request on a half-open connection (server restarting, proxy black-holing)
 * otherwise never settles, and every caller waiting on it waits with it.
 */
export function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => Error,
): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(onTimeout());
      ctrl.abort();
    }, ms);
  });
  let work: Promise<T>;
  try {
    work = run(ctrl.signal);
  } catch (e) {
    clearTimeout(timer);
    return Promise.reject(e);
  }
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
