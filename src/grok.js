// grok.js: Grok, painted in watercolour and ink. The silhouette is round, after the logo: a dark orb ringed by a
// broken cream rim, with the logo's slash poking out behind it as two tapered tips (top-right and bottom-left), two
// stubby legs, two little arm nubs and two glowing slit eyes. `u` is the body unit (the orb is 9u across; Grok is 10u
// tall with legs). (x, y) is the point on the ground between the feet.
//
// Body-local coordinates in the front view, used by the o.draw / o.armL / o.armR hooks:
//   orb centre (0, -5.7u), radius 4.5u (x -4.5u..4.5u, y -10.2u..-1.2u); eye centres (±1.9u, -6.4u), each 1u wide and
//   2u tall; mouth near (0, -4.3u); legs reach y 0. Arms pivot at (±4u, -4.8u) and are 2.5u long. o.armL / o.armR are
//   called at the arm TIP in arm space (x runs outward along the arm), so a held prop just draws around (0, 0).
//
// Everything here draws one frame. Motion comes from what you pass in: feel() / emotions() for moods, move() for
// dances, turn() for turns, and jump() / take() / stroll() / spring() from core.js for acting.

const ORB = { cy: -5.7, r: 4.5 }, EX = 1.9, EY = -6.4;   // orb centre y and radius, eye centre x (±) and y, in u
const GL = PAL.cream, HOLE = '#22181F';                  // glyph colour (rim, tips, eyes, mouth lines); mouth interiors

// ---------- views ----------
// Turns are drawn KEY VIEWS, like a cartoon model sheet, never a rotated 3D ball. Every view faces screen-right;
// flip: true mirrors it to face left. Numbers are in u.
//   L, R: silhouette edges.  shade: [angle, depth] of the dark crescent turned away from the light (the back of the
//   head in the turned views).  hl: x of the highlight.
//   face: where the features go. A front-view x maps to cx + x·fw; sides = which eyes show; mx = mouth x; bx = cheek x.
//   legs: [x, far] (far legs are darker).  arms: [pivotX, dir, which, layer] ('L' = o.aL / o.armL; layer 0 = behind the
//   body, 1 = in front of it, 2 = behind and in shadow).  hat / hw: hat offset and width.
const VIEWS = {
  front: { L: -4.5, R: 4.5, shade: [.85, .13], hl: -1.7, face: { cx: 0, fw: 1, sides: [-1, 1], mx: 0, bx: 3 }, hat: 0, hw: 1,
           legs: [[-1.7, 0], [1.7, 0]], arms: [[-4, -1, 'L', 0], [4, 1, 'R', 0]] },
  q:     { L: -4.5, R: 4.5, shade: [2.9, .2], hl: -.6, face: { cx: 1.3, fw: .78, sides: [-1, 1], mx: .5, bx: 3 }, hat: .5, hw: .95,
           legs: [[-2, 1], [1.2, 0]], arms: [[4.3, 1, 'R', 2], [-4.1, -1, 'L', 1]] },
  side:  { L: -4.5, R: 4.5, shade: [3, .3], hl: .4, face: { cx: 1.65, fw: .55, sides: [1], mx: 2.5, bx: 1.2 }, hat: .3, hw: .9,
           legs: [[-.5, 1], [.5, 0]], arms: [[-.3, 0, 'L', 1]] },
  qback: { L: -4.5, R: 4.5, shade: [.25, .2], hl: -2.2, face: null, hat: -.5, hw: .95,
           legs: [[2, 1], [-1.2, 0]], arms: [[-4.3, -1, 'R', 2], [4.1, 1, 'L', 1]] },
  back:  { L: -4.5, R: 4.5, shade: [.85, .13], hl: -1.7, face: null, hat: 0, hw: 1, back: true,
           legs: [[-1.7, 0], [1.7, 0]], arms: [[-4, -1, 'R', 0], [4, 1, 'L', 0]] },
};
// Key view for a heading in turns: 0 = front, .25 = facing right, .5 = back, .75 (or -.25) = facing left.
// Snaps to the nearest eighth, which is how a drawn turn works: front → q → side, one drawing per step.
function spinView(a) {
  const K = [['front', 0], ['q', 0], ['side', 0], ['qback', 0], ['back', 0], ['qback', 1], ['side', 1], ['q', 1]];
  const [view, f] = K[((Math.round(a * 8) % 8) + 8) % 8]; return { view, flip: !!f };
}
// A turn from heading a0 to a1 (in turns) between t0 and t1. It steps through the key views and smears the
// in-between drawings. Spread it into grok(): grok(x, y, u, { ...feel('happy', t), ...turn(t, 2, 2.2, 0, .25) }).
function turn(t, t0, t1, a0, a1) {
  const k = ease(seg(t, t0, t1)), v = spinView(lerp(a0, a1, k));
  return { ...v, smear: t > t0 && t < t1 ? .55 * Math.sin(k * Math.PI) : 0, smearDir: 0 };
}

// ---------- colour ----------
// Tints shift the body colour with the mood. tint: a name here or any hex colour; tintK: 0..1 strength.
const TINT = { pale: '#C9C3D6', flush: '#E23E36', blue: '#4F6FB8', rosy: '#E2708F', green: '#7F9F45', gold: '#F2B648' };
function tintCols(o) {
  const c = { col: o.col || PAL.slate, dk: o.dk || PAL.slateDk, lt: o.lt || PAL.slateLt };
  const tc = o.tint && (TINT[o.tint] || o.tint), k = clamp(o.tintK ?? 1);
  if (!tc || k <= 0) return c;
  return { col: mixCol(c.col, tc, .6 * k), dk: mixCol(c.dk, mixCol(tc, PAL.ink, .45), .5 * k), lt: mixCol(c.lt, mixCol(tc, '#FFFFFF', .3), .5 * k) };
}

// ---------- orb geometry ----------
// Points on the orb's circle from angle a0 to a1 (radians, y down: 0 = right, π/2 = bottom, -π/2 = top), radius r·k.
function orbArc(u, a0, a1, k = 1, n = 24) {
  const p = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); p.push([Math.cos(a) * ORB.r * k * u, (ORB.cy + Math.sin(a) * ORB.r * k) * u]); } return p;
}
// A band hugging the inside of the outline from a0 to a1, w u wide; each end tapers to a point unless told not to.
function rimBand(u, a0, a1, w, taper0 = true, taper1 = true) {
  const n = 26, out = [], inn = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, a = lerp(a0, a1, s);
    const k = Math.min(taper0 ? ease(s / .35) : 1, taper1 ? ease((1 - s) / .35) : 1), r0 = ORB.r - .06, r1 = r0 - w * (.12 + .88 * k);
    out.push([Math.cos(a) * r0 * u, (ORB.cy + Math.sin(a) * r0) * u]); inn.push([Math.cos(a) * r1 * u, (ORB.cy + Math.sin(a) * r1) * u]);
  }
  return out.concat(inn.reverse());
}
// The crescent of the orb turned away from the light: ang = the direction it faces, depth 0..1 of the radius.
function crescentPts(u, ang, depth, n = 18) {
  const p = [], c = Math.cos(ang), s = Math.sin(ang), r = ORB.r * u * .98;
  const add = (x, y) => p.push([x * c - y * s, ORB.cy * u + x * s + y * c]);
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + i / n * Math.PI; add(Math.cos(a) * r, Math.sin(a) * r); }
  for (let i = n; i >= 0; i--) { const a = -Math.PI / 2 + i / n * Math.PI; add(Math.cos(a) * r * (1 - 2 * depth), Math.sin(a) * r); }
  return p;
}
// The rim: the logo's broken ring, two arcs with gaps where the slash crosses. Each arc is full width where the slash
// leaves the orb and tapers at its other end. lo..hi limits it to part of the circle (for the open lid).
const RIM = [[2.44, 5.24, false, true], [-.7, 2.09, false, true]];   // [a0, a1, taper at a0, taper at a1]
function rim(u, lo = -Infinity, hi = Infinity) {
  for (const [a0, a1, t0, t1] of RIM) for (const off of [0, TAU, -TAU]) {
    const b0 = Math.max(a0 + off, lo), b1 = Math.min(a1 + off, hi);
    if (b1 - b0 > .05) paint(rimBand(u, b0, b1, .62, t0 && b0 === a0 + off, t1 && b1 === a1 + off), { wash: GL, washOp: 255, ink: null });
  }
}
// The slash's two tips, poking out behind the orb: top-right (long) and bottom-left (short). tip > 0 droops them
// (sadness, sleep), tip < 0 perks them up (alarm, excitement), like ears. which: 'top', 'bottom' or both.
function tips(u, sw, tip = 0, which = null) {
  const one = (ang, r1, bow) => {
    const P = []; for (let i = 0; i <= 4; i++) { const k = i / 4, r = lerp(3.4, r1, k), a = ang + bow * Math.sin(k * Math.PI) - bow * k * .5; P.push([Math.cos(a) * r * u, (ORB.cy + Math.sin(a) * r) * u]); }
    paint(ribbon(P, 1.5 * u, .06 * u), { wash: GL, washOp: 255, ink: PAL.ink, sw: sw * .85 });
  };
  if (which !== 'bottom') one(-Math.PI / 4 + tip, 7.3, .07);
  if (which !== 'top') one(Math.PI * .75 - tip * .6, 6.1, .07);
}

// ---------- Grok ----------
// Options (all optional):
//   pose:   dx, dy (in u; negative dy = up), sq (squash; negative stretches), rot (pivots at the feet), flip, sx, sy,
//           aL, aR (arm raise angles: 0 = straight out, + = up, - = down), walk (phase; the legs step), noLegs, noShadow,
//           tip (radians: + droops the slash's tips, - perks them up)
//   view:   front | q | side | qback | back (see VIEWS). smear 0..1 + smearDir ±1 (0 = both sides) for fast moves
//   face:   eyes (a name, or [left, right] for mismatched eyes), mouth, lookX / lookY (-1..1), squint 0..1, blush 0..1,
//           gloom 0..1 (dark forehead with gloom lines), lid 0..1 (the top of the orb flips open, front view only),
//           seed (blink timing)
//   colour: col / dk / lt, or tint + tintK
//   extras: hat, emote + emoteK (0..1 pop) + emoteAge (s since it appeared), draw(u, sw), armL(u, sw), armR(u, sw)
//   boil:   boilKey (a stable id for its boil seeds; defaults to call order, so set it if characters come and go mid-shot)
function grok(x, y, u, o = {}) {
  // each part boils from its own seed (see boilSeed), so a moving arm never re-boils the body, or the next character
  const id = o.boilKey ?? ++GROK_N, rs = part => boilSeed(`grok ${id} ${part}`);
  x += (o.dx || 0) * u;
  const V = VIEWS[o.view] || VIEWS.front;
  const dy = (o.dy || 0) * u, sq = (o.sq || 0) + (o.take || 0), sm = clamp(o.smear || 0);
  const sw = clamp(u / 15, .45, 2.4) * (o.swMul || 1), J = u * .06;
  const { col, dk, lt } = tintCols(o), far = mixCol(dk, PAL.ink, .22);
  // the tips follow through: a squash pushes them down, a stretch lifts them
  const tip = (o.tip || 0) + clamp(sq, -.4, .4) * .7;

  rs('shadow');
  if (!o.noShadow) {
    const f = 1 - Math.min(.5, Math.abs(o.dy || 0) * .06);
    paint(ellPts(x, y + u * .15, u * 4.6 * f, u * f, 22), { fill: PAL.ink, fillOp: 90, bleed: .25, tex: .3, border: .1, ink: null });
  }
  if (sm > .05) smearTrail(x, y + dy, u, V, sm, o.smearDir ?? (o.flip ? -1 : 1), col);

  push();
  translate(x, y + dy);
  if (o.rot) rotate(o.rot);
  scale((o.flip ? -1 : 1) * (o.sx ?? 1) * (1 + sq * .6) * (1 + sm * .35), (o.sy ?? 1) * (1 - sq));

  const arm = ([px, dir, which, layer]) => {
    rs('arm' + which);
    const a = which === 'L' ? (o.aL ?? .2) : (o.aR ?? .2), hook = which === 'L' ? o.armL : o.armR;
    // a raised (or dropped) arm slides its root out to the body's edge, so it stands beside the body instead of behind it
    push(); translate((px + dir * .9 * clamp((Math.abs(a) - .7) / .9)) * u, -4.8 * u);
    if (dir === 0) {   // side view: the near arm hangs low on the body, below the mouth; a raises it, a < 0 lowers it
      translate(0, 1.3 * u); rotate(.7 - a);
      paint(rrPts(-.2 * u, -.45 * u, 2.3 * u, .9 * u, .42 * u), { wash: col, washOp: 255, fill: dk, fillOp: 60, tex: .5, ink: PAL.ink, sw: sw * .8 });
      if (hook) { translate(2.1 * u, 0); hook(u, sw); }
    } else {
      rotate(dir < 0 ? a : -a);
      paint(rrPts(dir < 0 ? -2.5 * u : 0, -.45 * u, 2.5 * u, .9 * u, .42 * u), { wash: layer === 2 ? mixCol(col, dk, .45) : col, washOp: 255, fill: dk, fillOp: 60, tex: .5, ink: PAL.ink, sw: sw * .8 });
      if (hook) { translate(dir * 2.5 * u, 0); if (dir < 0) scale(-1, 1); hook(u, sw); }
    }
    pop();
  };

  const lid = V === VIEWS.front ? o.lid || 0 : 0;
  // arms behind, the slash's tips, then legs (under the body), then the body, then arms in front
  V.arms.filter(a => a[3] !== 1).forEach(arm);
  rs('tips'); if (lid <= .01) tips(u, sw, tip);
  if (!o.noLegs) V.legs.forEach(([lx, isFar], i) => {
    rs('leg' + i);
    let h = 2.2, sx = 0;
    if (o.walk != null) {
      if (o.view === 'side') {   // profile: the legs swing in turn, lifting as they swing forward
        const ph = (o.walk + i * .5) * TAU;
        sx = Math.sin(ph) * .75; h = 2.2 - Math.max(0, Math.cos(ph)) * .8;
      } else { const ph = Math.sin((o.walk + (i % 2 ? .5 : 0)) * TAU); if (ph > 0) h = 2.2 - ph * .9; }
    }
    paint(rrPts((lx + sx - .6) * u, -2.3 * u, 1.2 * u, h * u, .45 * u), { wash: isFar ? far : dk, washOp: 255, ink: PAL.ink, sw: sw * .8 });
  });

  rs('body');
  if (lid > .01) lunchbox(u, o, sw, J, lid, col, dk, lt, tip);
  else {
    const body = ellPts(0, ORB.cy * u, ORB.r * u, ORB.r * u, 30, J * .6);
    paint(body, { wash: col, washOp: 255, ink: null });
    paint(crescentPts(u, V.shade[0], V.shade[1]), { fill: dk, fillOp: 150, bleed: .04, tex: .6, border: .4, ink: null });
    paint(ellPts(V.hl * u, -8 * u, 1.9 * u, 1.05 * u, 18, J * 2, -.45), { fill: lt, fillOp: V.back ? 45 : 70, bleed: .2, tex: .85, border: .8, ink: null });
    rs('rim'); rim(u);
    rs('outline'); paint(body, { ink: PAL.ink, sw });
    if (o.gloom > .02) gloom(u, sw, o.gloom);
    if (V.face) {
      const F = V.face;
      push(); translate(F.cx * u, 0); scale(F.fw, 1);
      if (o.blush) blush(u, sw, F, o.blush === true ? 1 : o.blush);
      if (['mask', 'masq'].includes(o.hat) && F.sides.length > 1) faceHat(u, o.hat, sw, F.sides);
      rs('eyes'); eyes(u, o, sw, F.sides, sm); rs('mouth');
      push(); translate(F.mx * u, 0); mouth(u, o.mouth, sw); pop();
      if (['cat', 'bowtie'].includes(o.hat)) faceHat(u, o.hat, sw, F.sides);
      pop();
    }
    rs('hat'); push(); translate(V.hat * u, 0); scale(V.hw, 1); hat(u, o.hat, sw, col); pop();
  }
  V.arms.filter(a => a[3] === 1).forEach(arm);
  rs('draw'); if (o.draw) o.draw(u, sw);
  pop();

  rs('emote');
  if (o.emote) {   // emotes sit over the head, or by its top-left, away from the slash's tip
    const top = EMOTE_TOP.includes(o.emote), dir = o.flip ? -1 : 1;
    const ex = top ? x + dir * V.hat * u : x - dir * 4.9 * u, ey = y + dy + (top ? -12.6 : -9.6) * u * (1 - sq);
    emote(o.emote, ex, ey, u * .9, o.emoteK ?? 1, o.emoteAge ?? T);
  }
  rs('after');   // so whatever is drawn next doesn't depend on this pose
}

// The lid: the top of the orb hinges open at its left end (front view only), like a flip-top. The mouth is the dark
// wedge between jaw and lid; both rows of teeth point INTO it, staggered, and each tooth is sized to the gap at its
// spot, so they never cross, even when the lid is only open a crack.
function lunchbox(u, o, sw, J, lid, col, dk, lt, tip) {
  const cy = ORB.cy * u, hy = -4.95 * u, hx = Math.sqrt((ORB.r * u) ** 2 - (hy - cy) ** 2);
  const aR = Math.asin((hy - cy) / (ORB.r * u)), aL = Math.PI - aR;   // where the hinge line meets the circle
  const A = lid * 1.15, gap = x => (x + hx) * Math.sin(A);
  const tooth = (tx, dir) => {   // base on the jaw line from tx to tx + 1.2u, tip pointing up (dir -1) or down (dir 1)
    const h = Math.min(.75 * u, .42 * gap(tx + .6 * u)); if (h < .12 * u) return;
    paint([[tx, hy], [tx + 1.2 * u, hy], [tx + .6 * u, hy + dir * h]], { wash: PAL.cream, ink: PAL.ink, sw: sw * .45 });
  };
  // lower jaw, with its tip
  tips(u, sw, tip, 'bottom');
  const jaw = orbArc(u, aR, aL);
  paint(jaw, { wash: col, washOp: 255, ink: null });
  paint(crescentPts(u, .85, .13), { fill: dk, fillOp: 120, bleed: .04, tex: .6, border: .4, ink: null });
  rim(u, aR, aL);
  // the open mouth: a dark wedge from the hinge to the lid's far corner, with the tongue lying in it
  paint([[-hx, hy], [hx, hy], [-hx + 2 * hx * Math.cos(A), hy - 2 * hx * Math.sin(A)]], { wash: '#7A2534', ink: null });
  const th = Math.min(.5 * u, .3 * gap(1.6 * u));
  if (th > .08 * u) paint(ellPts(1.6 * u, hy - th * .7, 2 * u, th, 16), { wash: PAL.rose, fill: '#E2476E', fillOp: 60, ink: null });
  for (let i = 0; i < 6; i++) tooth(-hx + .35 * u + i * 1.38 * u, -1);
  paint(jaw, { ink: PAL.ink, sw });
  // lid, with the top tip
  push(); translate(-hx, hy); rotate(-A); translate(hx, -hy);
  tips(u, sw, tip, 'top');
  const cap = orbArc(u, aL, aR + TAU);
  paint(cap, { wash: col, washOp: 255, ink: null });
  paint(ellPts(-1.7 * u, -8 * u, 1.9 * u, 1.05 * u, 16, J), { fill: lt, fillOp: 110, bleed: .15, tex: .8, border: .8, ink: null });
  rim(u, aL, aR + TAU);
  for (let i = 0; i < 5; i++) tooth(-hx + 1.05 * u + i * 1.38 * u, 1);
  paint(cap, { ink: PAL.ink, sw });
  if (o.gloom > .02) gloom(u, sw, o.gloom);
  eyes(u, o, sw, [-1, 1], 0);
  hat(u, o.hat, sw, col);
  pop();
}

// A smear drawing: dry-brush streaks and speed lines trailing a fast move (dir ±1), or on both sides for a spin (0).
function smearTrail(x, y, u, V, k, dir, col) {
  const sides = dir === 0 ? [-1, 1] : [-dir];
  for (const s of sides) for (let i = 0; i < 4; i++) {
    const yy = y - (8.8 - i * 1.9) * u, x0 = x + s * (V.R - .9) * u, len = (3 + 3 * hash(i + 7 * s)) * u * k;
    inkLine([[x0, yy], [x0 + s * len * .5, yy + jit(u * .1)], [x0 + s * len, yy]], 2.2 * k, col, 'dry', .3);
    if (i % 2) inkLine([[x0 + s * len * .3, yy + .5 * u], [x0 + s * len * 1.1, yy + .5 * u]], .6, PAL.ink, 'inkfine', 0);
  }
}

// Gloom: a dark wash over the top of the head with hanging gloom lines (despair, dread, a guilty conscience).
function gloom(u, sw, g) {
  const a0 = Math.atan2(-1.75, -4.15), a1 = Math.atan2(-1.75, 4.15);
  paint(orbArc(u, a0, a1, .97, 20), { fill: PAL.indigo, fillOp: 170 * g, bleed: .08, tex: .5, border: .6, ink: null });
  for (let i = 0; i < 5; i++) {
    const gx = lerp(-2.8, 2.8, i / 4), top = ORB.cy - Math.sqrt(ORB.r ** 2 - gx * gx) * .93;
    inkLine([[gx * u, top * u], [gx * u + jit(u * .05), (top + 2.3 * g * (.7 + .3 * hash(i))) * u]], sw * .5, '#A29DCB', 'inkfine', 0);
  }
}

function blush(u, sw, F, b) {
  for (const s of F.sides) {
    const bx = s * F.bx * u;
    paint(ellPts(bx, -4.6 * u, u * .8, u * .4, 14), { wash: mixCol('#6E5670', PAL.rose, .35 + .65 * clamp(b)), washOp: 255, ink: null });
    if (b > .6) for (let k = 0; k < 3; k++) inkLine([[bx - .5 * u + k * .4 * u, -4.35 * u], [bx - .3 * u + k * .4 * u, -4.85 * u]], sw * .4, mixCol(PAL.rose, PAL.cream, .4), 'inkfine', 0);
  }
}

// ---------- eyes ----------
// normal, look, wide, happy, closed, sleepy, wink, narrow, angry, determined, sad, teary, cry, squeeze, shine,
// scared, blank, spark, red, heart, x, swirl, dot, shades. o.eyes may be a pair: ['narrow', 'wide'].
// Grok's eyes glow: they're painted in the cream of the rim, light on the dark orb.
function eyes(u, o, sw, sides, smear = 0) {
  const kinds = Array.isArray(o.eyes) ? o.eyes : o.eyes === 'wink' ? ['happy', 'normal'] : [o.eyes || 'normal', o.eyes || 'normal'];
  const sqz = clamp(o.squint || 0);
  if (smear > .5) { for (const s of sides) inkLine([[s * EX * u - .8 * u, EY * u], [s * EX * u + .8 * u, EY * u]], sw * 1.4, GL, 'ink', 0); return; }
  if (sqz > .8) { for (const s of sides) inkLine([[s * EX * u - .7 * u, (EY + .1) * u], [s * EX * u + .7 * u, (EY + .1) * u]], sw, GL, 'ink', 0); return; }
  if (kinds[0] === 'shades') {   // sunglasses: two dark lenses in gold frames, a bridge, arms running back along the head
    const P = pts => pts.map(([a, b]) => [a * u, (b + EY) * u]), gold = PAL.ochre;
    const lens = cx => P([[cx - 1.3, -1.05], [cx + 1.3, -1.05], [cx + 1.2, -.2], [cx + .75, .62], [cx, .76], [cx - .75, .62], [cx - 1.2, -.2]]);
    if (sides.length > 1) {
      for (const s of [-1, 1]) inkLine(P([[s * (EX + 1.25), -.85], [s * 4.3, -.95]]), sw * .8, gold, 'ink', 0);
      inkLine(P([[-.6, -.75], [0, -1], [.6, -.75]]), sw * .8, gold, 'ink', .5);
    } else inkLine(P([[EX - 1.2, -.85], [-4.2, -.95]]), sw * .8, gold, 'ink', 0);   // profile: the arm runs back to the ear
    for (const s of sides) {
      const cx = s * EX;
      paint(lens(cx), { wash: '#1B1824', ink: gold, sw: sw * .9, curv: .3 });
      inkLine(P([[cx - .8, -.35], [cx - .25, -.8]]), sw * .45, PAL.cream, 'inkfine', 0);   // glint
      inkLine(P([[cx - .4, .15], [cx, -.2]]), sw * .3, PAL.cream, 'inkfine', 0);
    }
    return;
  }
  if (sqz > 0) { push(); translate(0, EY * u); scale(1 + sqz * .15, 1 - sqz); translate(0, -EY * u); }
  for (const s of sides) { push(); translate(s * EX * u, EY * u); eye(kinds[s < 0 ? 0 : 1], s, u, o, sw); pop(); }
  if (sqz > 0) pop();
}

// One eye, drawn around its centre. s = -1 for the left eye, 1 for the right.
function eye(e, s, u, o, sw) {
  const lx = (o.lookX || 0) * u * .5, ly = (o.lookY || 0) * u * .4;
  const slit = (w, h) => paint(rrPts(-w / 2 * u + lx, -h / 2 * u + ly, w * u, h * u, w * .42 * u), { wash: GL, ink: null });
  const blinkOn = ['normal', 'look', 'wide'].includes(e) && ((T * .9 + (o.seed || 0) * 1.7) % 3.3) < .12;
  if (blinkOn) { inkLine([[-.6 * u, .5 * u], [.6 * u, .5 * u]], sw, GL, 'ink', 0); return; }
  const lineEye = (pts, w = 1.6, c = .2) => inkLine(pts.map(([a, b]) => [a * u, b * u]), sw * w, GL, 'ink', c);
  switch (e) {
    case 'normal': case 'look': slit(1, 2); break;
    case 'wide': slit(1.25, 2.6); break;
    case 'happy': lineEye([[-.85, .7], [0, -.5], [.85, .7]]); break;
    case 'closed': lineEye([[-.85, .2], [0, .6], [.85, .2]], 1.2, .4); break;
    case 'sleepy':
      paint(rrPts(-.5 * u + lx, .05 * u, u, .95 * u, .3 * u), { wash: GL, ink: null });
      lineEye([[-.75, .05], [0, -.1], [.75, .1]], 1.1, .4); break;
    case 'narrow': paint(rrPts(-.6 * u + lx, -.1 * u + ly, 1.2 * u, .7 * u, .25 * u), { wash: GL, ink: null }); break;
    case 'angry': case 'determined': {   // top edge slants DOWN toward the middle
      const hi = e === 'angry' ? .75 : .5, top = e === 'angry' ? -.7 : -.55;
      const P = [[-.6, s < 0 ? top : top + hi], [.6, s < 0 ? top + hi : top], [.6, 1], [-.6, 1]];
      paint(P.map(([a, b]) => [a * u + lx, b * u + ly]), { wash: GL, ink: null });
      break;
    }
    case 'sad': case 'teary': {   // top edge slants UP toward the middle (worried)
      const P = [[-.55, s < 0 ? -.2 : -.85], [.55, s < 0 ? -.85 : -.2], [.55, .9], [-.55, .9]];
      paint(P.map(([a, b]) => [a * u + lx, b * u + ly]), { wash: GL, ink: null });
      if (e === 'teary') {
        const w = Math.sin(T * 9 + s) * .06 * u;
        paint(ellPts(0, .95 * u + w, .9 * u, .38 * u, 14), { wash: PAL.sky, washOp: 230, ink: PAL.ink, sw: sw * .4 });
        paint(ellPts(-.35 * u, .85 * u + w, .18 * u, .1 * u, 8), { wash: PAL.cream, ink: null });
      }
      break;
    }
    case 'cry': {   // squeezed shut, with tear streams running down the body and drops flicking off
      lineEye([[-.85, .45], [-.3, -.05], [.3, .15], [.85, -.2]].map(([a, b]) => [a * -s, b]), 1.3, .3);
      const R = []; for (let k = 0; k <= 5; k++) R.push([(s * .5 + Math.sin(T * 8 + k * 1.3 + s) * .12 * k / 5) * u, (.4 + k * .72) * u]);
      paint(ribbon(R, .45 * u, .8 * u), { wash: PAL.sky, washOp: 235, ink: PAL.ink, sw: sw * .45 });
      for (let k = 0; k < 2; k++) {
        const ph = frac(T * 1.8 + k * .5 + (s > 0 ? .25 : 0)), p = arcPt([s * .9 * u, .2 * u], [s * 3.4 * u, 1.8 * u], 1.6 * u, ph);
        paint(ellPts(p[0], p[1], .22 * u * (1 - ph * .5), .3 * u * (1 - ph * .5), 8), { wash: PAL.sky, ink: PAL.ink, sw: sw * .35 });
      }
      break;
    }
    case 'squeeze': lineEye([[-.5 * -s, -.7], [.5 * -s, 0], [-.5 * -s, .7]], 1.3, 0); break;   // > <
    case 'shine':   // big glossy pupils in glowing rings
      paint(ellPts(lx * .6, ly * .6, u * .85, u * 1.2, 16), { wash: GL, ink: null });
      paint(ellPts(lx * .6, ly * .6 + .08 * u, u * .62, u * .95, 16), { wash: PAL.ink, ink: null });
      paint(ellPts(lx * .6 - .22 * u, ly * .6 - .4 * u, u * .26, u * .32, 10), { wash: GL, ink: null });
      paint(ellPts(lx * .6 + .22 * u, ly * .6 + .42 * u, u * .12, u * .12, 8), { wash: GL, ink: null });
      break;
    case 'scared':
      paint(ellPts(0, 0, u * .95, u * 1.15, 16), { wash: GL, ink: null });
      paint(ellPts((o.lookX || 0) * u * .3 + Math.sin(T * 40) * .04 * u, .1 * u, u * .3, u * .4, 10), { wash: PAL.ink, ink: null });
      break;
    case 'blank': paint(ellPts(0, 0, u * .8, u * 1.05, 14), { wash: GL, ink: null }); break;
    case 'spark':
      paint(ellPts(0, 0, u * 1.5, u * 1.5, 18), { fill: PAL.ochre, fillOp: 90, bleed: .3, ink: null });
      paint(starPts(0, 0, u * 1.35 * (1 + .12 * Math.sin(T * 14))), { wash: PAL.cream, fill: PAL.ochre, fillOp: 80, ink: PAL.ink, sw: sw * .55 });
      break;
    case 'red':
      paint(ellPts(0, 0, u * 1.6, u * 1.6, 18), { fill: '#E0283F', fillOp: 110, bleed: .35, ink: null });
      paint(rrPts(-.55 * u, -u, 1.1 * u, 2 * u, .4 * u), { wash: '#FF4A5E', ink: null });
      break;
    case 'heart': paint(heartPts(0, .1 * u, u * .9 * (1 + .1 * pulse(T))), { wash: '#E2476E', ink: PAL.ink, sw: sw * .5 }); break;
    case 'x': lineEye([[-.75, -.75], [.75, .75]], 1, 0); lineEye([[.75, -.75], [-.75, .75]], 1, 0); break;
    case 'swirl': {
      const sp = []; for (let k = 0; k < 16; k++) { const a = k * .7 + T * 6 * s, r = k * .06 * u; sp.push([Math.cos(a) * r, Math.sin(a) * r]); }
      inkLine(sp, sw * .6, GL, 'inkfine', .6); break;
    }
    case 'dot': paint(ellPts(lx * .5, ly * .5, u * .45, u * .55, 12), { wash: GL, ink: null }); break;
    default: slit(1, 2);
  }
}

// ---------- mouths ----------
// o, O, smile, grin, flat, wobble, cat, frown, smirk, laugh, open, wail, teeth, tongue, pout, yawn
// Lines are cream, like the eyes; open mouths are dark holes with a cream lip.
function mouth(u, m, sw) {
  if (!m) return;
  const P = pts => pts.map(([a, b]) => [a * u, b * u]);
  const line = (pts, w = 1.1, c = .6) => inkLine(P(pts), sw * w, GL, 'ink', c);
  const hole = { wash: HOLE, ink: GL, sw: sw * .6 };
  switch (m) {
    case 'o': paint(ellPts(0, -4.3 * u, u * .45, u * .5, 12), hole); break;
    case 'O': paint(ellPts(0, -4.1 * u, u * .8, u * .95, 14), hole); break;
    case 'smile': line([[-.8, -4.6], [0, -4.1], [.8, -4.6]]); break;
    case 'frown': line([[-.8, -4.1], [0, -4.6], [.8, -4.1]]); break;
    case 'grin': paint(P([[-1.3, -4.8], [1.3, -4.8], [.9, -3.9], [-.9, -3.9]]), { ...hole, curv: .3 }); break;
    case 'flat': line([[-.7, -4.4], [.7, -4.4]], .8, 0); break;
    case 'wobble': line([[-1, -4.4], [-.5, -4.7], [0, -4.4], [.5, -4.7], [1, -4.4]], .7, .3); break;
    case 'cat': line([[-.9, -4.5], [-.45, -4.1], [0, -4.5], [.45, -4.1], [.9, -4.5]], .7, .5); break;
    case 'smirk': line([[-.8, -4.35], [.2, -4.3], [.9, -4.75]], .8, .5); break;
    case 'laugh':
      paint(P([[-1.4, -4.9], [1.4, -4.9], [1, -4], [0, -3.4], [-1, -4]]), { ...hole, curv: .4 });
      paint(ellPts(0, -3.85 * u, .7 * u, .32 * u, 12), { wash: PAL.rose, ink: null }); break;
    case 'open':
      paint(ellPts(0, -4.25 * u, u * .75, u * .6, 14), hole);
      paint(ellPts(0, -3.95 * u, u * .45, u * .2, 10), { wash: PAL.rose, ink: null }); break;
    case 'wail': {
      const w = Math.sin(T * 30) * .06;
      paint(P([[-1.5, -4.5 + w], [-.5, -4.9], [.5, -4.9 - w], [1.5, -4.5], [1.2, -3.3], [-1.2, -3.3]]), { ...hole, curv: .3 });
      paint(ellPts(0, -3.6 * u, .8 * u, .25 * u, 12), { wash: PAL.rose, ink: null }); break;
    }
    case 'teeth':
      paint(rectPts(-1.3 * u, -4.85 * u, 2.6 * u, .95 * u, u * .04), { wash: PAL.cream, ink: PAL.ink, sw: sw * .6 });
      inkLine(P([[-1.25, -4.38], [1.25, -4.38]]), sw * .35, PAL.ink, 'ink', 0);
      for (const tx of [-.65, 0, .65]) inkLine(P([[tx, -4.8], [tx, -3.95]]), sw * .3, PAL.ink, 'ink', 0);
      break;
    case 'tongue':
      paint(P([[.05, -4.3], [.75, -4.3], [.72, -3.75], [.4, -3.55], [.08, -3.75]]), { wash: PAL.rose, ink: PAL.ink, sw: sw * .5, curv: .5 });
      line([[-.8, -4.6], [0, -4.2], [.8, -4.5]]); break;
    case 'pout': line([[-.45, -4.2], [0, -4.5], [.45, -4.2]], 1, .6); line([[-.25, -4.0], [0, -3.9], [.25, -4.0]], .6, .6); break;
    case 'yawn':
      paint(ellPts(0, -4.1 * u, u * .6, u * 1.05, 14), hole);
      paint(ellPts(0, -3.45 * u, u * .38, u * .25, 10), { wash: PAL.rose, ink: null }); break;
  }
}

// ---------- hats ----------
// party, hard, crown, halo, wizard, hood, top, fedora, band, sweatband, beanie, bow, flower, headphones, cat (ears; the
// whiskers show in the front and 3/4 views), plus face pieces for the front and 3/4 views: masq, mask, bowtie
function hat(u, h, sw, col = PAL.slate) {
  if (!h || h === 'mask' || h === 'masq' || h === 'bowtie') return;
  const P = pts => pts.map(([a, b]) => [a * u, b * u]);
  if (h === 'band' || h === 'sweatband') {   // a band around the forehead, curving with the orb
    const edge = (y, sag) => { const hw = Math.sqrt(ORB.r ** 2 - (y - ORB.cy) ** 2) + .1, p = []; for (let i = 0; i <= 10; i++) { const xx = lerp(-hw, hw, i / 10); p.push([xx, y + sag * (1 - (xx / hw) ** 2)]); } return p; };
    const band = P(edge(-8.95, .35).concat(edge(-7.95, .4).reverse()));
    paint(band, { wash: h === 'band' ? '#D8394E' : PAL.cream, ink: PAL.ink, sw: sw * .5 });
    if (h === 'sweatband') for (let i = 0; i < 4; i++) inkLine(P([[-2.4 + i * 1.6, -8.75], [-2.1 + i * 1.6, -8.05]]), sw * .4, '#D8394E', 'inkfine', 0);
    return;
  }
  if (h === 'headphones') {
    inkLine(P([[-4.6, -6.4], [-4.3, -9.7], [0, -11.1], [4.3, -9.7], [4.6, -6.4]]), sw * 2.4, PAL.ink, 'ink', .6);
    for (const s of [-1, 1]) paint(rrPts((s < 0 ? -5.4 : 4.1) * u, -7.7 * u, 1.3 * u, 2.6 * u, .55 * u), { wash: PAL.violet, fill: PAL.rose, fillOp: 50, ink: PAL.ink, sw: sw * .7 });
    return;
  }
  if (h === 'cat') {   // ears on the crown, clear of the slash's tip
    const at = (a, r) => [Math.cos(a) * r * u, (ORB.cy + Math.sin(a) * r) * u], D = Math.PI / 180;
    for (const [b0, b1, tp] of [[-132, -100, -118], [-80, -48, -62]]) {
      paint([at(b0 * D, 4.35), at(tp * D, 6.7), at(b1 * D, 4.35)], { wash: col, ink: PAL.ink, sw: sw * .8 });
      paint([at((b0 + 6) * D, 4.5), at(tp * D, 6.1), at((b1 - 6) * D, 4.5)], { wash: PAL.rose, ink: null });
    }
    return;
  }
  // the rest sit on the crown: drawn for a flat 10u-wide top, then scaled onto the crown
  const k = .72; sw /= k;
  push(); translate(0, -9.45 * u); scale(k); translate(0, 8 * u);
  if (h === 'party') {
    paint(P([[-1.8, -7.9], [0, -12.8], [1.8, -7.9]]), { wash: PAL.rose, fill: PAL.violet, fillOp: 50, ink: PAL.ink, sw: sw * .8 });
    paint(ellPts(0, -12.8 * u, u * .75, u * .75, 12), { wash: PAL.ochre, ink: PAL.ink, sw: sw * .6 });
  } else if (h === 'hard') {
    const d = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; d.push([Math.cos(a) * 3.8 * u, -7.4 * u + Math.sin(a) * 3.4 * u]); }
    paint(d, { wash: '#F2C53D', ink: PAL.ink, sw: sw * .8 });
    paint(rectPts(-5.2 * u, -8 * u, 10.4 * u, .9 * u), { wash: '#F2C53D', ink: PAL.ink, sw: sw * .8 });
  } else if (h === 'crown') {
    paint(P([[-3, -7.9], [-3, -10.8], [-1.5, -9.3], [0, -11.2], [1.5, -9.3], [3, -10.8], [3, -7.9]]), { wash: '#F2C53D', fill: PAL.ochre, fillOp: 90, ink: PAL.ink, sw: sw * .8 });
    for (const gx of [-1.5, 0, 1.5]) paint(ellPts(gx * u, -8.7 * u, u * .3, u * .3, 8), { wash: gx ? PAL.teal : PAL.rose, ink: null });
  } else if (h === 'halo') {
    brush.noFill(); brush.noWash(); brush.noHatch(); brush.set('ink', PAL.ochre, sw * 1.4);
    brush.beginShape(0); for (const p of ellPts(0, -10.4 * u, 3.2 * u, .8 * u, 20)) brush.vertex(p[0], p[1]); brush.endShape(true);
  } else if (h === 'wizard' || h === 'hood') {
    paint(P([[-3.9, -7.9], [.9, -15], [3.9, -7.9]]), { wash: h === 'hood' ? PAL.violet : PAL.indigo, fill: PAL.violet, fillOp: 80, ink: PAL.ink, sw: sw * .8 });
    paint(starPts(.2 * u, -10.6 * u, u * .9, .4, 5), { wash: PAL.ochre, ink: null });
  } else if (h === 'top') {
    paint(rectPts(-2.6 * u, -12.5 * u, 5.2 * u, 4.3 * u), { wash: PAL.ink, ink: null });
    paint(rectPts(-2.6 * u, -9.4 * u, 5.2 * u, .8 * u), { wash: '#C8324A', ink: null });
    paint(rectPts(-3.9 * u, -8.6 * u, 7.8 * u, .8 * u), { wash: PAL.ink, ink: null });
  } else if (h === 'fedora') {
    paint(P([[-2.8, -8.3], [-2.3, -10.8], [0, -10.2], [2.3, -10.8], [2.8, -8.3]]), { wash: '#6B5A4A', ink: PAL.ink, sw: sw * .8, curv: .3 });
    paint(rectPts(-2.8 * u, -9.2 * u, 5.6 * u, .8 * u), { wash: '#C8324A', ink: null });
    paint(ellPts(0, -8.2 * u, 4.6 * u, .6 * u, 20), { wash: '#6B5A4A', ink: PAL.ink, sw: sw * .8 });
  } else if (h === 'beanie') {
    const d = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; d.push([Math.cos(a) * 4.3 * u, -7.4 * u + Math.sin(a) * 3 * u]); }
    paint(d, { wash: PAL.teal, fill: PAL.sky, fillOp: 60, ink: PAL.ink, sw: sw * .8 });
    paint(rectPts(-4.6 * u, -8 * u, 9.2 * u, 1.1 * u), { wash: mixCol(PAL.teal, PAL.ink, .2), ink: PAL.ink, sw: sw * .7 });
    paint(ellPts(0, -10.6 * u, .8 * u, .8 * u, 12), { wash: PAL.cream, ink: PAL.ink, sw: sw * .6 });
  } else if (h === 'bow') {
    for (const s of [-1, 1]) paint(P([[-2.2, -8.1], [-2.2 + s * 1.7, -9.3], [-2.2 + s * 1.7, -7.1]]), { wash: PAL.rose, fill: '#E2476E', fillOp: 70, ink: PAL.ink, sw: sw * .6, curv: .3 });
    paint(ellPts(-2.2 * u, -8.2 * u, .45 * u, .45 * u, 10), { wash: '#E2476E', ink: PAL.ink, sw: sw * .5 });
  } else if (h === 'flower') {
    const fx = -2.6 * u, fy = -8.6 * u;
    inkLine([[fx, fy], [fx + .3 * u, -7.9 * u]], sw * .6, PAL.sap, 'ink', 0);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + .3; paint(ellPts(fx + Math.cos(a) * .7 * u, fy + Math.sin(a) * .7 * u, .55 * u, .55 * u, 10), { wash: PAL.cream, ink: PAL.ink, sw: sw * .4 }); }
    paint(ellPts(fx, fy, .45 * u, .45 * u, 10), { wash: PAL.ochre, ink: PAL.ink, sw: sw * .4 });
  }
  pop();
}
function faceHat(u, h, sw, sides) {
  const P = pts => pts.map(([a, b]) => [a * u, b * u]);
  if (h === 'cat') {   // whiskers, from the cheeks out past the edge
    for (const s of sides) for (const k of [-.3, .3]) inkLine([[s * 3.7 * u, -4.5 * u + k * u], [s * 6 * u, -4.7 * u + k * 2 * u]], sw * .45, '#B5AFD3', 'inkfine', 0);
  } else if (h === 'masq') {   // drawn under the eyes, so they glow through its eye holes
    paint(P([[-4.3, -7.6], [-2, -8.3], [0, -7.5], [2, -8.3], [4.3, -7.6], [3.5, -5.4], [1.2, -5.5], [0, -6.2], [-1.2, -5.5], [-3.5, -5.4]]), { wash: PAL.violet, fill: PAL.rose, fillOp: 60, ink: PAL.ink, sw: sw * .7, curv: .3 });
    for (const ex of [-EX, EX]) paint(ellPts(ex * u, EY * u, .95 * u, 1.3 * u, 12), { wash: PAL.ink, ink: null });
  } else if (h === 'mask') {
    paint(P([[-4.7, -8], [4.7, -8], [3.8, -5.1], [.5, -5.8], [-.5, -5.8], [-3.8, -5.1]]), { wash: PAL.violet, ink: PAL.ink, sw: sw * .7 });
  } else if (h === 'bowtie') {
    for (const s of [-1, 1]) paint([[0, -2.2 * u], [s * 1.5 * u, -2.9 * u], [s * 1.5 * u, -1.4 * u]], { wash: PAL.rose, ink: PAL.ink, sw: sw * .5 });
  }
}

// ---------- emotes ----------
// Painted reaction marks, never lettering: ! ? !! !? zzz sweat spark heart hearts anger steam bulb dots scribble
// music swirl stars cloud. k = 0..1 pop-in progress (with overshoot); age = seconds since it appeared (drives the
// looping ones). Emotes in EMOTE_TOP sit over the head; the rest sit by its top corner.
const EMOTE_TOP = ['steam', 'stars', 'cloud', 'bulb', 'scribble'];
function emote(kind, x, y, s, k = 1, age = T) {
  const p = backOut(k); if (p < .02) return;
  const sw = clamp(s / 15, .4, 2), P = pts => pts.map(([a, b]) => [a * s, b * s]);
  const dot = (dx, col) => paint(ellPts(dx, 1.25 * s, .42 * s, .42 * s, 12), { wash: col, ink: PAL.ink, sw: sw * .7 });
  const bang = (dx, col) => {
    push(); translate(dx, 0); rotate(.1 + .08 * Math.sin(age * 16) * Math.exp(-age * 3));
    paint(P([[-.62, -2.3], [.62, -2.3], [.22, .45], [-.22, .45]]), { wash: col, fill: PAL.cream, fillOp: 70, ink: PAL.ink, sw: sw * .8, curv: .25 }); dot(0, col);
    pop();
  };
  const quest = (dx, col) => {
    push(); translate(dx, 0); rotate(-.08 + .08 * Math.sin(age * 12) * Math.exp(-age * 3));
    paint(ribbon(P([[-1, -1.3], [-.55, -2.15], [.35, -2.3], [1, -1.6], [.7, -.75], [.05, -.3], [0, .4]]), .75 * s, .5 * s), { wash: col, fill: PAL.cream, fillOp: 60, ink: PAL.ink, sw: sw * .8 });
    dot(0, col); pop();
  };
  push(); translate(x, y); scale(p);
  switch (kind) {
    case '!': bang(0, PAL.ochre); break;
    case '?': quest(0, PAL.sky); break;
    case '!!': bang(-.8 * s, PAL.ochre); bang(.9 * s, PAL.ochre); break;
    case '!?': bang(-.9 * s, PAL.ochre); quest(1 * s, PAL.sky); break;
    case 'zzz': for (let i = 0; i < 3; i++) {   // painted Z shapes drifting up and away
      const ph = frac(age * .4 + i / 3), a = Math.sin(ph * Math.PI), zs = (.8 + ph * .7) * s * Math.min(1, a * 1.6);
      if (a < .12) continue;
      const zx = ph * 2.6 * s, zy = -ph * 4.2 * s, Z = [[-.6, -.6], [.6, -.6], [.6, -.28], [-.12, .3], [.6, .3], [.6, .6], [-.6, .6], [-.6, .28], [.12, -.3], [-.6, -.3]];
      push(); translate(zx, zy); rotate(-.15 + .1 * Math.sin(age * 2 + i));
      paint(Z.map(([a, b]) => [a * zs, b * zs]), { wash: PAL.cream, fill: PAL.sky, fillOp: 70, ink: PAL.ink, sw: sw * .7 });
      pop();
    } break;
    case 'sweat': for (const [dx, dy, r] of [[0, 0, 1], [1.6, 1.4, .7]])
      paint(P([[dx, dy - 1.6 * r], [dx + .9 * r, dy + .2], [dx, dy + .9 * r], [dx - .9 * r, dy + .2]]), { wash: PAL.sky, fill: '#FFFFFF', fillOp: 60, ink: PAL.ink, sw: sw * .6, curv: .7 });
      break;
    case 'spark': {
      const tw = 1 + .15 * Math.sin(age * 12);
      paint(starPts(0, 0, 1.6 * s * tw), { wash: PAL.cream, fill: PAL.ochre, fillOp: 80, ink: PAL.ink, sw: sw * .5 });
      paint(starPts(1.9 * s, 1.2 * s, .8 * s / tw), { wash: PAL.ochre, ink: PAL.ink, sw: sw * .4 });
      break;
    }
    case 'heart': paint(heartPts(0, 0, s * 1.8 * (1 + .12 * pulse(age + OFF))), { wash: '#E2476E', fill: PAL.rose, fillOp: 90, ink: PAL.ink, sw: sw * .6 }); break;
    case 'hearts': for (let i = 0; i < 3; i++) {
      const ph = frac(age * .55 + i / 3), a = Math.sin(ph * Math.PI); if (a < .1) continue;
      paint(heartPts((Math.sin(ph * 6 + i * 2) * .7 + i * .7 - .7) * s, -ph * 3.8 * s, s * (.5 + .6 * a)), { wash: '#E2476E', fill: PAL.rose, fillOp: 90, ink: PAL.ink, sw: sw * .5 });
    } break;
    case 'anger': {   // the comic "vein pop": four curved strokes, each bowed in toward the centre
      const b = 1 + .15 * pulse(age + OFF, 8);
      for (let i = 0; i < 4; i++) { push(); rotate(i * Math.PI / 2 + Math.PI / 4); scale(b); inkLine(P([140, 160, 180, 200, 220].map(d => [2.1 + 1.3 * Math.cos(d * Math.PI / 180), 1.3 * Math.sin(d * Math.PI / 180)])), sw * 1.1, '#D8394E', 'ink', .6); pop(); }
      break;
    }
    case 'steam': for (const sd of [-1, 1]) for (let j = 0; j < 2; j++) {
      const ph = frac(age / .7 + j * .5 + (sd > 0 ? .25 : 0)), r = (.55 + ph * .9) * s, cx = sd * (3.2 + ph * 1.8) * s, cy = (1 - ph * 3) * s;
      const puff = []; for (let i = 0; i < 18; i++) { const a = i / 18 * TAU, bump = 1 + .22 * Math.abs(Math.sin(a * 2.5)); puff.push([cx + Math.cos(a) * r * bump, cy + Math.sin(a) * r * .8 * bump]); }
      paint(puff, { wash: PAL.cream, washOp: 255 * (1 - ph * .8), ink: ph < .6 ? PAL.ink : null, sw: sw * .5 });
    } break;
    case 'bulb': {
      const gl = .5 + .5 * Math.sin(age * 10);
      glow(0, -1.4 * s, 4.5 * s, '#FFD27A', .75 + .25 * gl);
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * .45, r0 = 1.6 * s, r1 = (2.2 + .4 * gl) * s; inkLine([[Math.cos(a) * r0, -1.4 * s + Math.sin(a) * r0], [Math.cos(a) * r1, -1.4 * s + Math.sin(a) * r1]], sw * .8, PAL.ochre, 'ink', 0); }
      paint(ellPts(0, -1.4 * s, 1.15 * s, 1.2 * s, 16), { wash: '#FFE68A', fill: PAL.cream, fillOp: 90, ink: PAL.ink, sw: sw * .7 });
      paint(rectPts(-.5 * s, -.3 * s, s, .8 * s), { wash: '#9A93A8', ink: PAL.ink, sw: sw * .6 });
      break;
    }
    case 'dots': for (let i = 0; i < 3; i++) {
      const ph = frac(age / 1.8), q = backOut(clamp((ph - i * .22) * 6)); if (q < .02) continue;
      paint(ellPts((i - 1) * 1.3 * s, 0, .42 * s * q, .42 * s * q, 10), { wash: PAL.ink, ink: null });
    } break;
    case 'scribble': {
      const pts = []; for (let i = 0; i < 34; i++) { const a = i * .95, r = (1.1 + .5 * Math.sin(i * 1.7)) * s; pts.push([Math.cos(a) * r * 1.5 + jit(.2 * s), Math.sin(a) * r * .8 + jit(.2 * s)]); }
      inkLine(pts, sw * .8, PAL.ink, 'ink', .7); break;
    }
    case 'music': {
      const b = Math.sin(age * 5) * .3 * s;
      push(); translate(0, b); rotate(.1 * Math.sin(age * 5));
      paint(ellPts(0, 1.2 * s, .7 * s, .5 * s, 12, 0, -.3), { wash: PAL.ink, ink: null });
      inkLine(P([[.6, 1.1], [.6, -1.6], [1.6, -1]]), sw * .8, PAL.ink, 'ink', 0);
      pop();
      const b2 = Math.sin(age * 5 + 2) * .3 * s;
      paint(ellPts(2.2 * s, 2.2 * s + b2, .45 * s, .33 * s, 10, 0, -.3), { wash: PAL.ink, ink: null });
      inkLine([[2.6 * s, 2.15 * s + b2], [2.6 * s, .6 * s + b2]], sw * .6, PAL.ink, 'ink', 0);
      break;
    }
    case 'swirl': {
      const sp = []; for (let i = 0; i < 18; i++) { const a = i * .6 + age * 5, r = i * .09 * s; sp.push([Math.cos(a) * r, Math.sin(a) * r]); }
      inkLine(sp, sw * .7, PAL.violet, 'inkfine', .6); break;
    }
    case 'stars': for (let i = 0; i < 3; i++) {   // little stars circling the head
      const a = age * 5 + i * TAU / 3, d = .75 + .25 * Math.sin(a);
      paint(starPts(Math.cos(a) * 4.2 * s, Math.sin(a) * s, .75 * s * d, .45, 5, age * 3), { wash: PAL.ochre, fill: PAL.cream, fillOp: 60, ink: PAL.ink, sw: sw * .5 });
    } break;
    case 'cloud': {   // a little rain cloud of its own
      const bob = Math.sin(age * 2) * .15 * s, c = [];
      for (let i = 0; i < 40; i++) {
        const a = i / 40 * TAU, up = Math.sin(a) < 0, r = up ? 1 + .38 * Math.pow(Math.abs(Math.sin(a * 3)), .6) : 1;
        c.push([Math.cos(a) * 2.8 * s * (up ? r * .92 : 1), bob - .2 * s + Math.sin(a) * (up ? 1.35 : .7) * s * r]);
      }
      for (let i = 0; i < 6; i++) { const ph = frac(age * 2.4 + hash(i)), rx = (-2 + i * .8) * s, ry = (.7 + ph * 2) * s; inkLine([[rx, ry], [rx - .12 * s, ry + .7 * s]], sw * 1.1, mixCol(PAL.sky, PAL.indigo, .3), 'ink', 0); }
      paint(c, { wash: '#A3A8C4', fill: PAL.indigo, fillOp: 70, bleed: .1, ink: PAL.ink, sw: sw * .8, curv: .4 });
      break;
    }
  }
  pop();
}
// Heart outline points, centred at (cx, cy), about 2r wide.
function heartPts(cx, cy, r, n = 22) {
  const p = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; p.push([cx + 16 * Math.pow(Math.sin(a), 3) * r / 16, cy - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * r / 16]); } return p;
}

// ---------- emotions ----------
// Each emotion is a face AND a way of moving. body(t) returns pose offsets for grok(), and every one is alive: it
// moves on its own, at its own energy, locked to the beat (PROJECT.bpm). take = how big the reaction is when Grok
// switches INTO this emotion. fade = the emote is a one-off that fades out instead of staying. tip = how the slash's
// tips sit (+ droops them, - perks them up), like ears.
const _b = t => { const bp = bpOf(t), s1 = Math.sin(bp * Math.PI); return { bp, s1, ab: Math.abs(s1), hit: pulse(t), s2: Math.sin(bp * TAU), f: frac(bp) }; };
const EMO = {
  neutral:    { eyes: 'normal', take: .3, body: t => { const b = _b(t); return { dy: -.25 * b.ab, sq: .03 * b.hit, aL: .15 + .05 * b.s1, aR: .15 - .05 * b.s1 }; } },
  happy:      { tip: -.06, eyes: 'happy', mouth: 'smile', blush: .3, take: .6, body: t => { const b = _b(t); return { dy: -1.2 * b.ab, sq: .1 * b.hit, aL: .4 + .4 * b.s1, aR: .4 - .4 * b.s1 }; } },
  excited:    { tip: -.22, eyes: 'wide', mouth: 'open', emote: 'spark', take: 1, body: t => { const b = _b(t), h = Math.abs(b.s2); return { dy: -2.4 * h, sq: .16 * pulse2(t) - .06 * h, aL: 1 + .5 * Math.sin(b.bp * TAU * 2), aR: 1 - .5 * Math.sin(b.bp * TAU * 2) }; } },
  laugh:      { eyes: 'squeeze', mouth: 'laugh', blush: .45, take: .8, body: t => { const c = Math.abs(Math.sin(t * TAU * 5)); return { dy: -.45 * c, sq: .08 * c - .04, rot: -.07 + .03 * Math.sin(t * TAU * 5), aL: -.35 + .12 * c, aR: -.35 + .12 * c }; } },
  love:       { tip: -.08, eyes: 'heart', mouth: 'cat', blush: .8, tint: 'rosy', tintK: .5, emote: 'hearts', take: .7, body: t => { const b = _b(t), s = Math.sin(b.bp * Math.PI / 2); return { rot: .08 * s, dx: .5 * s, dy: -.6 * b.ab, sq: .05 * b.hit, aL: -.1 + .15 * b.s1, aR: -.1 - .15 * b.s1 }; } },
  shy:        { tip: .15, eyes: 'look', mouth: 'wobble', blush: 1, take: .3, body: t => { const b = _b(t), s = Math.sin(b.bp * Math.PI / 2); return { lookX: -.7, lookY: .8, sq: .06, rot: -.05 + .02 * s, dx: .15 * s, aL: -.55 + .15 * Math.sin(t * TAU * 1.5), aR: -.6 - .12 * Math.sin(t * TAU * 1.5) }; } },
  proud:      { tip: -.15, eyes: 'closed', mouth: 'smile', tint: 'gold', tintK: .3, emote: 'spark', take: .5, body: t => { const b = _b(t); return { sq: -.1 - .03 * b.ab, dy: -.3 * b.hit, aL: -.9, aR: -.9, rot: .02 * b.s1 }; } },
  smug:       { eyes: 'narrow', mouth: 'smirk', take: .4, body: t => { const b = _b(t), s = Math.sin(b.bp * Math.PI / 2); return { lookX: .4, rot: -.06 + .03 * s, dy: -.2 * b.ab, aL: -.5, aR: .5 + .15 * s }; } },
  relieved:   { tip: .12, eyes: 'closed', mouth: 'smile', emote: 'sweat', take: .4, body: t => { const b = _b(t), br = Math.sin(t * TAU * .35); return { sq: .05 + .05 * br, dy: -.15 * b.ab, aL: -.7 + .1 * br, aR: -.7 + .1 * br }; } },
  sad:        { tip: .42, eyes: 'sad', mouth: 'frown', tint: 'blue', tintK: .35, gloom: .35, emote: 'cloud', take: .3, body: t => { const b = _b(t), s = Math.sin(b.bp * Math.PI / 4); return { sq: .08 + .02 * s, rot: .03 * s, aL: -.75, aR: -.75, lookY: .5 }; } },
  cry:        { tip: .3, eyes: 'cry', mouth: 'wail', tint: 'blue', tintK: .2, take: .8, body: t => { const b = _b(t), sob = Math.sin(b.f * Math.PI) * Math.exp(-b.f * 2); return { sq: .14 * sob - .02, dy: -.7 * sob, aL: .9 + .15 * Math.sin(t * TAU * 6), aR: .9 - .15 * Math.sin(t * TAU * 6), rot: .03 * b.s1 }; } },
  angry:      { tip: -.15, eyes: 'angry', mouth: 'teeth', tint: 'flush', tintK: .45, emote: 'anger', take: .8, body: t => { const b = _b(t); return { dx: .1 * Math.sin(t * TAU * 18), sq: .12 * b.hit, aL: -.3 + .1 * b.hit, aR: -.3 + .1 * b.hit }; } },
  furious:    { tip: -.22, eyes: 'red', lid: .28, tint: 'flush', tintK: .85, emote: 'steam', take: 1.2, body: t => { const b = _b(t); return { dx: .22 * Math.sin(t * TAU * 20), rot: .025 * Math.sin(t * TAU * 13), sq: .2 * b.hit, dy: -.8 * Math.sin(b.f * Math.PI) * (1 - b.f), aL: 1 + .2 * Math.sin(t * TAU * 9), aR: 1 - .2 * Math.sin(t * TAU * 9) }; } },
  scared:     { tip: -.28, eyes: 'scared', mouth: 'wobble', tint: 'pale', tintK: .6, emote: 'sweat', take: 1.1, body: t => ({ dx: .1 * Math.sin(t * TAU * 22), sq: -.06, aL: 1 + .08 * Math.sin(t * TAU * 17), aR: 1 + .08 * Math.sin(t * TAU * 19), lookX: .6 * Math.sign(Math.sin(t * 2.3)) }) },
  surprised:  { tip: -.32, eyes: 'wide', mouth: 'O', emote: '!', fade: true, take: 1.3, body: t => { const b = _b(t); return { sq: -.12, dy: -.3 - .15 * b.ab, aL: 1.1 + .05 * b.s2, aR: 1.1 - .05 * b.s2 }; } },
  confused:   { tip: .08, eyes: ['narrow', 'wide'], mouth: 'wobble', emote: '?', take: .6, body: t => { const b = _b(t); return { rot: .1 * Math.sin(b.bp * Math.PI / 4), aL: .1, aR: 1.5 + .15 * Math.sin(t * TAU * 3), dy: -.15 * b.ab }; } },
  thinking:   { eyes: 'look', mouth: 'flat', emote: 'dots', take: .4, body: t => { const b = _b(t); return { lookX: .5, lookY: -.8, rot: .05, aR: .9, aL: -.3 + .25 * Math.sin(b.f * Math.PI), dy: -.1 * b.ab }; } },
  idea:       { eyes: 'shine', mouth: 'grin', emote: 'bulb', take: 1.1, body: t => { const b = _b(t); return { dy: -1 * b.ab, sq: -.05 + .1 * b.hit, aR: 1.55 + .1 * b.s2, aL: .2 + .2 * b.s1 }; } },
  determined: { tip: -.1, eyes: 'determined', mouth: 'flat', take: .7, body: t => { const b = _b(t), p1 = Math.sin(b.f * Math.PI), p2 = Math.abs(Math.cos(b.f * Math.PI)); return { rot: .06, sq: -.04 + .06 * b.hit, dy: -.3 * b.ab, aL: .1 + .7 * p1, aR: .1 + .7 * p2 }; } },
  sleepy:     { tip: .36, eyes: 'sleepy', mouth: 'o', emote: 'zzz', take: .2, body: t => { const br = Math.sin(t * TAU * .3); return { sq: .05 + .05 * br, rot: .06 * Math.sin(t * .8), aL: -.6, aR: -.6 }; } },
  bored:      { tip: .26, eyes: 'narrow', mouth: 'flat', take: .2, body: t => { const f = frac(bpOf(t) / 4), sigh = f < .3 ? ease(f / .3) : 1 - ease((f - .3) / .7); return { lookX: -.3, lookY: .4, sq: .08 - .14 * sigh, rot: -.04, aL: -.85 + .05 * Math.sin(t * 2), aR: -.85 - .05 * Math.sin(t * 2) }; } },
  nervous:    { tip: -.12, eyes: 'look', mouth: 'wobble', tint: 'pale', tintK: .2, emote: 'sweat', take: .5, body: t => { const b = _b(t); return { lookX: beatN(t) % 2 ? .8 : -.8, dx: .3 * b.s1, sq: .04, aL: -.1 + .2 * Math.sin(t * TAU * 5), aR: -.1 + .2 * Math.sin(t * TAU * 5 + 1) }; } },
  suspicious: { eyes: 'narrow', mouth: 'flat', take: .4, body: t => { const s = Math.sin(t * TAU * .25); return { lookX: s, rot: -.08 * s, dx: .4 * s, sq: .04, aL: -.4, aR: -.4 }; } },
  disgusted:  { tip: .12, eyes: 'squeeze', mouth: 'wobble', tint: 'green', tintK: .5, take: .8, body: t => { const a = frac(bpOf(t) / 2) * BEAT * 2, sh = Math.exp(-a * 6) * Math.sin(a * 45); return { rot: -.1, dx: -.3 + .15 * sh, sq: .05, aL: .7 + .2 * sh, aR: .7 - .2 * sh }; } },
  dizzy:      { eyes: 'swirl', mouth: 'wobble', emote: 'stars', take: .7, body: t => { const a = t * TAU * .8; return { rot: .12 * Math.sin(a), dx: .7 * Math.sin(a), dy: -.3 * Math.abs(Math.cos(a)), aL: .3 + .6 * Math.sin(a * 1.3), aR: .3 - .6 * Math.sin(a * 1.3) }; } },
  cool:       { eyes: 'shades', mouth: 'smirk', emote: 'music', take: .4, body: t => { const b = _b(t); return { rot: .04 * b.hit, dy: -.35 * b.hit, sq: .06 * b.hit, aL: -.4, aR: .7 + .1 * b.s1 }; } },
  starstruck: { tip: -.2, eyes: 'spark', mouth: 'open', tint: 'gold', tintK: .3, take: 1, body: t => { const b = _b(t), h = Math.abs(b.s2); return { dy: -1.6 * h, sq: .1 * pulse2(t), aL: 1.1 + .35 * Math.sin(b.bp * TAU * 2), aR: 1.1 + .35 * Math.sin(b.bp * TAU * 2) }; } },
  ko:         { tip: .55, eyes: 'x', mouth: 'wobble', tint: 'pale', tintK: .3, emote: 'stars', take: 1, body: t => ({ sq: .28 + .02 * Math.sin(t * 3), rot: .12, aL: -1, aR: -.9 }) },
  playful:    { eyes: 'wink', mouth: 'tongue', take: .6, body: t => { const b = _b(t), side = beatN(t) % 2 ? 1 : -1, k = lerp(-side, side, easeOut(clamp(b.f * 3))); return { dx: .8 * k, dy: -1.4 * b.ab, rot: .1 * k, sq: .1 * b.hit, aL: .65 + .55 * k, aR: .65 - .55 * k }; } },
  mischief:   { eyes: 'narrow', mouth: 'grin', gloom: .3, take: .5, body: t => { const r = Math.sin(t * TAU * 4); return { lookX: .3, sq: .07, rot: .04, aL: -.05 + .15 * r, aR: -.05 - .15 * r, dy: -.1 * Math.abs(r) }; } },
  hopeful:    { tip: -.1, eyes: 'shine', mouth: 'cat', blush: .35, take: .5, body: t => { const b = _b(t); return { sq: -.06 - .02 * b.ab, dy: -.25 * b.ab, lookY: -.4, aL: .5 + .05 * b.s1, aR: .5 - .05 * b.s1, rot: .03 * Math.sin(b.bp * Math.PI / 2) }; } },
};

// One emotion, alive at time t: face, colour and body motion together. Spread it into grok():
//   grok(x, y, u, feel('happy', t))       grok(x, y, u, { ...feel('sad', t), view: 'q', hat: 'beanie' })
function feel(name, t, over = {}) {
  const E = EMO[name] || EMO.neutral;
  return { eyes: E.eyes, mouth: E.mouth, tint: E.tint, tintK: E.tintK ?? 1, blush: E.blush || 0, gloom: E.gloom || 0,
           lid: E.lid || 0, tip: E.tip || 0, emote: E.emote, ...(E.body ? E.body(t) : {}), ...over };
}

// An emotion timeline with ACTED changes: keys = [[t0, 'neutral'], [t1, 'surprised'], [t2, 'happy', { emote: 'music' }]].
// Around each change the eyes squeeze shut and the body squashes just before (anticipation), and the face swaps
// under the squint. Then a take fires (a squash-stretch the size of the new emotion's `take`), the body settles into
// its new motion with overshoot, colour, blush and gloom cross-fade, and the new emote pops in. o.take scales every take.
// Spread the result into grok() and add any other pose: grok(x, y, u, { ...emotions(t, keys), view: 'q' }).
function emotions(t, keys, o = {}) {
  let i = 0; while (i + 1 < keys.length && t >= keys[i + 1][0]) i++;
  const [tc, name, over] = keys[i], age = t - tc, cur = feel(name, t, over);
  const tn = i + 1 < keys.length ? keys[i + 1][0] : Infinity, tkS = o.take ?? 1;
  const E = EMO[name] || EMO.neutral;
  let squint = cur.squint || 0;
  if (tn - t < .1) squint = Math.max(squint, 1 - (tn - t) / .1);
  if (i > 0 && age < .14) squint = Math.max(squint, 1 - age / .14);
  const prev = i > 0 ? feel(keys[i - 1][1], t, keys[i - 1][2]) : null;
  if (prev && age < .5) {
    const base = { dy: 0, sq: 0, aL: .2, aR: .2, rot: 0, dx: 0, lookX: 0, lookY: 0, tip: 0 };
    const k = backOut(seg(age, 0, .4)), kc = ease(seg(age, 0, .3));
    for (const f in base) cur[f] = lerp(prev[f] ?? base[f], cur[f] ?? base[f], k);
    const a = tintCols(prev), b = tintCols(cur);
    cur.col = mixCol(a.col, b.col, kc); cur.dk = mixCol(a.dk, b.dk, kc); cur.lt = mixCol(a.lt, b.lt, kc); cur.tint = null;
    for (const f of ['blush', 'gloom', 'lid']) cur[f] = lerp(prev[f] || 0, cur[f] || 0, kc);
  }
  // takes: the one this key fires, plus the anticipation squash of the next one
  const t1 = prev ? take(t, tc, (E.take ?? .6) * tkS) : { sq: 0, dy: 0 };
  const En = i + 1 < keys.length ? EMO[keys[i + 1][1]] || EMO.neutral : null, t2 = En ? take(t, tn, (En.take ?? .6) * tkS) : { sq: 0, dy: 0 };
  cur.sq = (cur.sq || 0) + t1.sq + t2.sq; cur.dy = (cur.dy || 0) + t1.dy + t2.dy;
  cur.squint = squint;
  // the emote pops in after the swap (it carries on if the emote didn't change); one-off emotes fade out
  const same = prev && prev.emote === cur.emote;
  cur.emoteK = same ? 1 : seg(age, .06, .32) * (E.fade && !(over && over.emote) ? 1 - seg(age, 1.4, 1.8) : 1);
  cur.emoteAge = age;
  return cur;
}

// ---------- moves ----------
// Beat-locked dances: bounce, hop, roof (arms up), sway, spin (a drawn spin through the key views, once a bar), wave,
// walk, run, idle, stomp, shimmy, mix (changes every two bars). Returns pose offsets; spread into grok().
function move(style, t, seed = 0) {
  const bp = bpOf(t), bi = Math.floor(bp), bf = bp - bi, hit = Math.max(0, 1 - bf * 3.5), s1 = Math.sin(bp * Math.PI), ab = Math.abs(s1);
  const o = { dy: 0, sq: 0, aL: .2, aR: .2, rot: 0, walk: null, dx: 0 };
  if (style === 'mix') style = ['bounce', 'roof', 'sway', 'spin', 'hop', 'wave'][(Math.floor(bp / 8) + seed) % 6];
  switch (style) {
    case 'bounce': o.dy = -ab * 1.6; o.sq = hit * .12; o.aL = .4 + s1; o.aR = .4 - s1; break;
    case 'hop': o.dy = -ab * 4; o.sq = hit * .18; o.aL = o.aR = .3 + ab * 1.1; break;
    case 'roof': o.dy = -ab * 1.2; o.sq = hit * .1; o.aL = o.aR = 1.25 + .3 * Math.sin(bp * TAU); break;
    case 'sway': o.dx = s1 * 3; o.rot = s1 * .12; o.aL = .5 + .6 * s1; o.aR = .5 - .6 * s1; o.sq = hit * .08; break;
    case 'spin': {
      const ph = (((bi % 4) + 4) % 4 === 3) ? bf : 0;
      Object.assign(o, spinView(ph)); o.smear = ph > .1 && ph < .9 ? .5 : 0; o.smearDir = 0;
      o.dy = -Math.sin(ph * Math.PI) * 3 - ab; o.aL = o.aR = .6 + ph; o.sq = hit * .1; break;
    }
    case 'wave': o.dy = -ab; o.aL = 1.1 + .5 * Math.sin(bp * TAU * 2); o.aR = -.2; o.sq = hit * .08; break;
    case 'walk': o.walk = bp / 2; o.dy = -ab * .6; o.aL = .3 * s1; o.aR = -o.aL; break;
    case 'run': o.walk = bp * 1.5; o.dy = -Math.abs(Math.sin(bp * TAU)); o.aL = .8 * Math.sin(bp * TAU * 1.5); o.aR = -o.aL; o.rot = -.08; break;
    case 'idle': o.dy = -ab * .5; o.sq = hit * .05; break;
    case 'stomp': o.dy = -Math.max(0, Math.sin(bp * TAU)) * 1.4; o.sq = hit * .2; o.rot = (bi % 2 ? 1 : -1) * .06 * hit; o.aL = o.aR = -.3 + hit * .9; break;
    case 'shimmy': o.dx = Math.sin(bp * TAU * 2) * .6; o.rot = Math.sin(bp * TAU * 2) * .05; o.aL = .9 + .4 * Math.sin(bp * TAU * 2); o.aR = .9 - .4 * Math.sin(bp * TAU * 2); o.dy = -ab * .5; break;
  }
  return o;
}
function dancer(x, y, u, style, t, extra = {}) { grok(x, y, u, { ...move(style, t, extra.seed || 0), ...extra }); }
