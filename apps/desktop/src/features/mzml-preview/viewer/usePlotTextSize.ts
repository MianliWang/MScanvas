import { useCallback, useLayoutEffect, useRef } from "react";

/** Counter only SVG text scaling. Scientific paths keep the renderer's sole axis transform. */
export function usePlotTextSize() {
  const node = useRef<SVGSVGElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback(() => {
    const plot = node.current;
    if (plot === null) return;
    const box = plot.getBoundingClientRect();
    const view = plot.viewBox?.baseVal;
    if (!view || box.width <= 0 || box.height <= 0) return;
    for (const label of plot.querySelectorAll("text")) {
      const x = Number(label.getAttribute("x") ?? 0), y = Number(label.getAttribute("y") ?? 0);
      label.style.fontSize = "12px";
      label.setAttribute("transform", "translate(" + x + " " + y + ") scale(" + view.width / box.width + " " +
        view.height / box.height + ") translate(" + -x + " " + -y + ")");
    }
  }, []);
  const attach = useCallback((plot: SVGSVGElement | null) => {
    observer.current?.disconnect(); observer.current = null; node.current = plot;
    if (plot === null) return;
    measure();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(measure); observer.current.observe(plot);
    }
  }, [measure]);
  useLayoutEffect(measure);
  useLayoutEffect(() => () => observer.current?.disconnect(), []);
  return attach;
}
