export function serializeJsonLine(type, payload = {}) {
  return JSON.stringify({ ...payload, version: 1, type });
}
