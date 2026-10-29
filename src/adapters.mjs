export function assertHarnessAdapter(adapter) {
  for (const method of [
    "initialize",
    "capabilities",
    "createSession",
    "run",
    "interrupt",
    "checkpoint",
    "dispose",
  ]) {
    if (typeof adapter[method] !== "function")
      throw new TypeError(`Harness adapter missing ${method}()`);
  }
  return adapter;
}
