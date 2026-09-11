/**
 * Thin wrapper around chrome.debugger (Chrome DevTools Protocol).
 *
 * Everything that "acts" on the page (click, scroll) goes through here using
 * real Input.dispatchMouseEvent calls — never synthetic element.click() or
 * window.scrollTo() — so the movement is indistinguishable from an actual
 * mouse and can be watched/monitored live.
 */

const PROTOCOL_VERSION = '1.3';

export interface Point {
  x: number;
  y: number;
}

export async function attach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export async function detach(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

export function sendCommand<T = unknown>(tabId: number, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result as T);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adds random variance to a delay so the timing isn't perfectly uniform. */
function jitter(ms: number, spreadRatio = 0.3): number {
  const spread = ms * spreadRatio;
  return Math.max(0, ms + (Math.random() * spread * 2 - spread));
}

interface EvaluateResult<T> {
  result: { value: T };
  exceptionDetails?: unknown;
}

export async function evaluate<T = unknown>(tabId: number, expression: string): Promise<T> {
  const result = await sendCommand<EvaluateResult<T>>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result.value;
}

export async function realClick(tabId: number, point: Point): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  });
  await sleep(jitter(80));

  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(jitter(60));

  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

/**
 * Real scroll using wheel events, split into small steps so it looks like a
 * manual scroll instead of an instant jump.
 */
export async function realScroll(
  tabId: number,
  at: Point,
  deltaY: number,
  steps = 6,
  stepDelayMs = 90,
): Promise<void> {
  const perStep = deltaY / steps;
  for (let i = 0; i < steps; i++) {
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: at.x,
      y: at.y,
      deltaX: 0,
      deltaY: perStep,
    });
    await sleep(jitter(stepDelayMs));
  }
}
