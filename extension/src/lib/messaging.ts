export type ExtensionMessage =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'CLEAR' }
  | { type: 'DEDUPE' }
  | { type: 'GET_STATE' };

export type ExtensionResponse = { ok: true; data?: unknown } | { ok: false; error: string };
