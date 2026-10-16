/* The geometry of Vaelo's V, on a 64-unit grid. Plain JS with no React so
   the app's Mark and the icon generator (scripts/generate-icons.mjs) draw
   from the same lines. */
const TOP = 13;
const BOTTOM = 53;
const LEFT = 11;
const RIGHT = 53;

/* Small marks get a sturdier hairline and serif so they survive at 20px. */
export function markGeometry(size) {
  const small = size < 36;
  const heavy = small ? 10 : 9;
  const hair = small ? 4.2 : 2.6;
  const serif = small ? 2.6 : 1.5;
  const foot = small ? 2.4 : 1.6;
  const h = BOTTOM - TOP;
  const leftSlope = (32 - foot / 2 - LEFT) / h;
  const rightSlope = (RIGHT - 32 - foot / 2) / h;
  const t = (RIGHT - hair - (LEFT + heavy)) / (leftSlope + rightSlope);
  const crotch = [LEFT + heavy + leftSlope * t, TOP + t];
  const heavyPath = `M${LEFT} ${TOP}H${LEFT + heavy}L${crotch[0]} ${crotch[1]}L${32 + foot / 2} ${BOTTOM}H${32 - foot / 2}Z`;
  const hairPath = `M${RIGHT - hair} ${TOP}H${RIGHT}L${32 + foot / 2} ${BOTTOM}H${32 - foot / 2}L${crotch[0]} ${crotch[1]}Z`;
  const serifs = [
    [LEFT - 4.5, TOP - serif, heavy + 9, serif],
    [RIGHT - hair - 4, TOP - serif, hair + 8, serif],
  ];
  return {
    heavyPath,
    hairPath,
    hairLine: [RIGHT - hair / 2, TOP, 32, BOTTOM - 1],
    serifs,
    bounds: {
      x: serifs[0][0],
      y: TOP - serif,
      width: serifs[1][0] + serifs[1][2] - serifs[0][0],
      height: BOTTOM - (TOP - serif),
    },
  };
}
