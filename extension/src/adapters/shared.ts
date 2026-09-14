/** Returns {x,y,top,bottom,height} for the element `elementExpr` resolves to, or null if it doesn't exist. */
export function rectExprFor(elementExpr: string): string {
  return `(() => {
    const el = ${elementExpr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, height: r.height };
  })()`;
}
