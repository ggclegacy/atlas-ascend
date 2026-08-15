/**
 * Map marker elements.
 *
 * These are plain DOM nodes because Mapbox markers live outside React's tree.
 * They are built here rather than inside the provider so the puck's appearance
 * is defined once — product identity must not change if the map vendor does.
 *
 * Styles are inline, but the keyframes they reference (`atlas-breathe`) are
 * global, declared in `globals.css`.
 */

const GOLD = "#c4912f";
const GOLD_BRIGHT = "#deb25e";
const VIOLET_CORE = "#6437e0";
const VIOLET_HALO = "#a98bff";
const VIOLET_ELECTRIC = "#8b5cf6";

/**
 * The user location puck.
 *
 * Composition, back to front: a breathing accuracy halo, a heading cone, a
 * violet core, and a fine gold ring. The gold ring is the detail that makes it
 * read as a machined object rather than a generic blue dot.
 *
 * Only the halo animates. Animating the core as well reads as a throbbing
 * alert; animating just the halo reads as a steady signal with presence.
 */
export function createUserPuckElement(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("aria-label", "Your location");
  Object.assign(root.style, {
    position: "relative",
    width: "0px",
    height: "0px",
    pointerEvents: "none",
  });

  const halo = document.createElement("div");
  Object.assign(halo.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "110px",
    height: "110px",
    marginLeft: "-55px",
    marginTop: "-55px",
    borderRadius: "50%",
    background: `radial-gradient(circle, ${hexToRgba(VIOLET_ELECTRIC, 0.4)} 0%, ${hexToRgba(VIOLET_CORE, 0.16)} 55%, transparent 100%)`,
    animation: "atlas-breathe 2.6s ease-in-out infinite alternate",
  });

  const cone = document.createElement("div");
  cone.setAttribute("data-atlas-cone", "");
  Object.assign(cone.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "58px",
    height: "46px",
    transform: "translate(-50%, -100%)",
    transformOrigin: "50% 100%",
    background: `linear-gradient(180deg, ${hexToRgba(VIOLET_ELECTRIC, 0.5)}, transparent)`,
    clipPath: "polygon(50% 100%, 0% 0%, 100% 0%)",
    display: "none",
  });

  const core = document.createElement("div");
  Object.assign(core.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "18px",
    height: "18px",
    marginLeft: "-9px",
    marginTop: "-9px",
    borderRadius: "50%",
    background: `radial-gradient(circle at 35% 30%, ${VIOLET_HALO}, ${VIOLET_CORE})`,
    boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
  });

  const ring = document.createElement("div");
  Object.assign(ring.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "24px",
    height: "24px",
    marginLeft: "-12px",
    marginTop: "-12px",
    borderRadius: "50%",
    border: `1.5px solid ${GOLD}`,
    boxShadow: `0 0 0 0.5px rgba(0,0,0,0.5), inset 0 0 2px ${hexToRgba(GOLD_BRIGHT, 0.6)}`,
  });

  root.append(halo, cone, core, ring);
  return root;
}

/**
 * Destination marker — a gold pin.
 *
 * Gold is correct here: a destination is active, precise, route-relevant
 * information, which is exactly what the accent is reserved for.
 */
export function createDestinationElement(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("aria-label", "Destination");
  Object.assign(root.style, {
    position: "relative",
    width: "26px",
    height: "34px",
    pointerEvents: "none",
  });

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "34");
  svg.setAttribute("viewBox", "0 0 26 34");

  const defs = document.createElementNS(svgNS, "defs");
  const grad = document.createElementNS(svgNS, "linearGradient");
  grad.setAttribute("id", "atlas-dest-gold");
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "1");
  grad.setAttribute("y2", "1");
  for (const [offset, color] of [
    ["0%", "#664b18"],
    ["35%", GOLD],
    ["52%", "#f6e7be"],
    ["70%", GOLD],
    ["100%", "#664b18"],
  ] as const) {
    const stop = document.createElementNS(svgNS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    grad.appendChild(stop);
  }
  defs.appendChild(grad);
  svg.appendChild(defs);

  const pin = document.createElementNS(svgNS, "path");
  pin.setAttribute("d", "M13 33C13 33 24 21.5 24 13A11 11 0 1 0 2 13c0 8.5 11 20 11 20z");
  pin.setAttribute("fill", "url(#atlas-dest-gold)");
  pin.setAttribute("stroke", "rgba(0,0,0,0.55)");
  pin.setAttribute("stroke-width", "0.75");

  const hole = document.createElementNS(svgNS, "circle");
  hole.setAttribute("cx", "13");
  hole.setAttribute("cy", "13");
  hole.setAttribute("r", "4");
  hole.setAttribute("fill", "#05050a");

  svg.append(pin, hole);
  root.appendChild(svg);
  return root;
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
