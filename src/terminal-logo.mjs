// Geometry from assets/omni.svg; the terminal raster preserves every edge.
const nodes = [
  [166.29, 35],
  [336.4, 78.14],
  [453.9, 328.2],
  [341.7, 445.95],
  [65.07, 451.5],
  [35, 227.54],
];
const polygons = [
  { points: [nodes[0], [64.03, 451.5], nodes[2], nodes[1]], width: 30 },
  { points: [nodes[0], nodes[5], nodes[1]], width: 12 },
  { points: [nodes[3], nodes[1], nodes[2]], width: 12 },
  { points: [nodes[5], [64.03, 451.5], nodes[3]], width: 12 },
];
const segments = polygons.flatMap(({ points, width }) =>
  points.map((a, i) => ({ a, b: points[(i + 1) % points.length], width })),
);

function covered(x, y) {
  return (
    nodes.some(([cx, cy]) => Math.hypot(x - cx, y - cy) <= 35) ||
    segments.some(({ a, b, width }) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
      );
      return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= width / 2;
    })
  );
}

export function logoRows(columns = 32) {
  // Eight Braille dots per cell preserve diagonal edges and circular nodes.
  // Keep leading blank cells on every row so the geometry stays aligned.
  const height = Math.ceil(columns / 2);
  const bits = [
    [1, 8],
    [2, 16],
    [4, 32],
    [64, 128],
  ];
  return Array.from({ length: height }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      let mask = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 2; sx++) {
          const x = -20 + ((column * 2 + sx + 0.5) * 530) / (columns * 2);
          const y = -20 + ((row * 4 + sy + 0.5) * 530) / (height * 4);
          if (covered(x, y)) mask |= bits[sy][sx];
        }
      return String.fromCodePoint(0x2800 + mask);
    }).join(""),
  );
}

export const terminalLogoPlain = logoRows().join("\n");
export function terminalLogo({
  color = !Object.hasOwn(process.env, "NO_COLOR"),
} = {}) {
  return color
    ? `\x1b[38;2;255;210;129m${terminalLogoPlain}\x1b[0m`
    : terminalLogoPlain;
}
