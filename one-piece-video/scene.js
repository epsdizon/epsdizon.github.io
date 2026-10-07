/* Light-painting renderer for "Where is the One Piece?".
 * Everything on screen is a pure function of time t (seconds), so the
 * HyperFrames renderer can seek any frame in any order. */
(function () {
  "use strict";
  var W = 1920, H = 1080, FOCAL = 1150, DUR = 32;

  // ------------------------------------------------------------ utilities
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };
  var smooth = function (k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mixc(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function rgba(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + clamp(a, 0, 1).toFixed(3) + ")"; }

  // piecewise-linear keyframes [[t, value(s)]...]
  function keys(list, t) {
    if (t <= list[0][0]) return list[0][1];
    for (var i = 1; i < list.length; i++) {
      if (t <= list[i][0]) {
        var a = list[i - 1], b = list[i], k = (t - a[0]) / (b[0] - a[0]);
        if (typeof a[1] === "number") return lerp(a[1], b[1], k);
        return mixc(a[1], b[1], k);
      }
    }
    return list[list.length - 1][1];
  }

  // ------------------------------------------------------------ 2D shape helpers
  function cr(pts, n) { // Catmull-Rom through control points
    n = n || 10; var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
      for (var k = 0; k < n; k++) {
        var t = k / n, t2 = t * t, t3 = t2 * t, o = [];
        for (var d = 0; d < 2; d++) {
          o.push(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3));
        }
        out.push(o);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function lin(pts, step) { // straight segments, subdivided
    step = step || 0.06; var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (var k = 0; k < n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function ell(cx, cy, rx, ry, a0, sweep, n) {
    a0 = a0 === undefined ? -Math.PI / 2 : a0; sweep = sweep === undefined ? Math.PI * 2 : sweep; n = n || 48;
    var out = [];
    for (var i = 0; i <= n; i++) { var a = a0 + sweep * i / n; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return out;
  }
  function cat() { return [].concat.apply([], arguments); }
  // place 2D outline on a vertical wall plane (u→x, v→y) at depth z
  function wall(pts, ox, oy, oz, s) { s = s || 1; return pts.map(function (p) { return [ox + p[0] * s, oy + p[1] * s, oz]; }); }
  // place on the floor (u→x, v→z)
  function floor(pts, ox, oz, s) { s = s || 1; return pts.map(function (p) { return [ox + p[0] * s, 0.02, oz + p[1] * s]; }); }

  // ------------------------------------------------------------ palette
  var C = {
    amber: [255, 186, 112], white: [255, 238, 214], red: [255, 72, 52], blue: [130, 200, 255],
    gold: [255, 206, 96], cyan: [150, 230, 255], parch: [255, 222, 170], hatband: [255, 60, 60],
  };

  // ------------------------------------------------------------ groups (rigid motion + dimming)
  var shipDx = function (t) { return t < 12 ? 0 : 0.85 * (Math.min(t, 24) - 12); };
  var G = {
    flourish: { dim: [[0, 1], [2.2, 1], [3.6, 0]] },
    exec: { dim: [[0, 1], [7.9, 1], [8.05, 2.2], [9.4, 0.75], [12.5, 0.35]] },
    crowd: { dim: [[0, 0.75], [7.9, 0.75], [8.05, 1.5], [9.4, 0.8], [13, 0.4]] },
    arms: { dim: [[0, 1], [11.5, 1], [13.5, 0.4]] },
    sea: { dim: [[0, 1], [17, 1], [19, 0.5]] },
    ship: { dim: [[0, 1], [17, 1], [19, 0.6]], off: function (t) { return [shipDx(t), 0.05 * Math.sin(t * 3.1), 0]; } },
    map: { dim: [[0, 0.9], [23, 0.9], [25, 0.35]] },
    glyph: { dim: [[0, 1], [22.9, 1], [23.0, 1.8], [23.6, 1], [25, 0.5]] },
    isle: { dim: [[0, 1], [26.0, 1], [26.1, 1.6], [27, 1], [28, 1.5], [29, 1.1]] },
    hat: { dim: [[0, 1], [27.95, 1], [28.05, 1.9], [29.5, 1.25]] },
  };

  // ------------------------------------------------------------ strokes
  var S = [];
  function add(pts, t0, t1, col, group, opt) {
    opt = opt || {};
    S.push({ pts: pts, t0: t0, t1: t1, col: col, g: G[group], pen: opt.pen !== false, w: opt.w || 1, a: opt.a || 1, refl: opt.refl !== false, xfp: opt.xfp });
  }

  // flourish: the light swoops in and spirals down to the scaffold
  add(cat(cr([[-8, 3.4], [-6.2, 2.9], [-4.9, 2.4], [-4.4, 1.6], [-5.0, 1.0], [-5.4, 1.5], [-4.9, 1.9]], 12), cr([[-4.9, 1.9], [-4.2, 1.2], [-3.4, 0.0]], 10)).map(function (p, i, arr) {
    return [p[0], p[1], 11 - 3 * i / arr.length];
  }), 0.5, 1.55, C.amber, "flourish");

  // -- Loguetown execution platform (wall plane z = 8)
  var Z1 = 8;
  add(wall(lin([[-3.4, 0], [-3.4, 0.27], [-3.1, 0.27], [-3.1, 0.53], [-2.8, 0.53], [-2.8, 0.8], [-2.5, 0.8], [-2.5, 1.07], [-2.2, 1.07], [-2.2, 1.33], [-1.9, 1.33], [-1.9, 1.6], [2.1, 1.6], [2.1, 0]]), 0, 0, Z1), 1.6, 2.5, C.amber, "exec");
  add(wall(lin([[-1.9, 0], [-1.9, 1.45], [2.1, 1.45]]), 0, 0, Z1), 2.52, 2.8, C.amber, "exec");
  add(wall(lin([[-1.9, 0.05], [0.1, 1.4], [2.1, 0.05]]), 0, 0, Z1), 2.82, 3.05, C.amber, "exec", { a: 0.7 });

  // Gol D. Roger, kneeling, coat over his shoulders, the famous moustache
  var DECK = 1.6;
  add(wall(cr([[-0.55, 0.0], [-0.52, 0.3], [-0.45, 0.62], [-0.36, 0.86], [-0.15, 0.95], [-0.07, 1.0], [0.07, 1.0], [0.15, 0.95], [0.36, 0.86], [0.45, 0.62], [0.52, 0.3], [0.55, 0.0], [0.2, 0.0], [0.0, 0.07], [-0.2, 0.0], [-0.55, 0.0]], 8), 0, DECK, Z1), 3.1, 4.0, C.white, "exec");
  add(wall(cat(cr([[-0.14, 0.94], [-0.08, 0.55], [-0.05, 0.12]], 8)), 0, DECK, Z1), 4.02, 4.18, C.white, "exec", { a: 0.8 });
  add(wall(cat(cr([[0.14, 0.94], [0.08, 0.55], [0.05, 0.12]], 8)), 0, DECK, Z1), 4.2, 4.36, C.white, "exec", { a: 0.8 });
  add(wall(ell(0, 1.16, 0.16, 0.16, Math.PI / 2, Math.PI * 2, 40), 0, DECK, Z1), 4.4, 4.75, C.white, "exec");
  add(wall(cr([[-0.3, 1.2], [-0.2, 1.09], [-0.07, 1.07], [0, 1.1], [0.07, 1.07], [0.2, 1.09], [0.3, 1.2]], 8), 0, DECK, Z1), 4.78, 5.0, C.white, "exec");

  function human(h) { // front-facing standing silhouette, feet at origin
    var s = h / 1.75;
    return cr([[-0.2, 0], [-0.17, 0.45], [-0.19, 0.85], [-0.27, 0.82], [-0.3, 1.0], [-0.27, 1.32], [-0.21, 1.45], [-0.07, 1.5], [-0.11, 1.6], [-0.05, 1.74], [0.05, 1.74], [0.11, 1.6], [0.07, 1.5], [0.21, 1.45], [0.27, 1.32], [0.3, 1.0], [0.27, 0.82], [0.19, 0.85], [0.17, 0.45], [0.2, 0], [0.06, 0], [0.03, 0.72], [-0.03, 0.72], [-0.06, 0], [-0.2, 0]], 6)
      .map(function (p) { return [p[0] * s, p[1] * s]; });
  }
  function spear(a, b) {
    var d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]); d = [d[0] / l, d[1] / l];
    var n = [-d[1], d[0]], B = [b[0] - d[0] * 0.22, b[1] - d[1] * 0.22];
    return cat(lin([a, b], 0.05), lin([b, [B[0] + n[0] * 0.07, B[1] + n[1] * 0.07], [B[0] - n[0] * 0.07, B[1] - n[1] * 0.07], b], 0.03));
  }
  add(wall(human(1.75), -1.25, DECK, Z1), 5.05, 5.65, C.amber, "exec");
  add(wall(spear([-0.97, 0.15], [0.62, 2.62]), 0, DECK, Z1), 5.68, 5.95, C.white, "exec");
  add(wall(human(1.75), 1.25, DECK, Z1), 6.0, 6.6, C.amber, "exec");
  add(wall(spear([0.97, 0.15], [-0.62, 2.62]), 0, DECK, Z1), 6.63, 6.9, C.white, "exec");

  // the crowd watching the execution (two rows in front of the platform)
  var rnd = mulberry32(42), crowdHeads = [];
  function crowdRow(x0, x1, z, spacing) {
    var pts = [];
    for (var x = x0; x <= x1; x += spacing) {
      var h = (rnd() - 0.5) * 0.18 - 0.62, base = 0.0;
      crowdHeads.push([x, h, z]);
      pts = pts.concat(cr([[x - 0.22, 0.98 + h + base], [x - 0.17, 1.12 + h], [x - 0.07, 1.19 + h]], 4),
        ell(x, 1.29 + h, 0.1, 0.11, Math.PI * 0.62, Math.PI * 1.76, 14),
        cr([[x + 0.07, 1.19 + h], [x + 0.17, 1.12 + h], [x + 0.22, 0.98 + h]], 4));
    }
    return wall(pts, 0, 0, z);
  }
  add(crowdRow(-4.0, 4.0, 3.4, 0.46), 7.0, 7.75, C.amber, "crowd", { a: 0.6 });
  add(crowdRow(-4.6, 4.6, 4.3, 0.5), 7.1, 7.8, C.amber, "crowd", { a: 0.4, pen: false });

  // raised fists & swords: the Great Pirate Era begins
  var r2 = mulberry32(7);
  crowdHeads.forEach(function (c, i) {
    if (r2() < 0.6) {
      var x = c[0] + (r2() < 0.5 ? 0.17 : -0.17), h = c[1], side = x > c[0] ? 1 : -1, st = 10.0 + r2() * 0.9;
      var arm = cr([[x, 1.12 + h], [x + side * 0.08, 1.4 + h], [x + side * 0.1, 1.62 + h]], 6);
      var pts = cat(arm, ell(x + side * 0.1, 1.67 + h, 0.05, 0.05, Math.PI / 2, Math.PI * 2, 10));
      if (r2() < 0.4) pts = cat(pts, lin([[x + side * 0.1, 1.72 + h], [x + side * 0.16, 2.3 + h]], 0.05));
      add(wall(pts, 0, 0, c[2]), st, st + 0.35, C.gold, "arms", { pen: false, a: 0.85 });
    }
  });

  // -- the sea and the ship
  function waveLine(x0, x1, v, amp, wl, ph) {
    var pts = [];
    for (var x = x0; x <= x1; x += 0.05) pts.push([x, v + amp * Math.sin((x + ph) * 2 * Math.PI / wl) + amp * 0.35 * Math.sin((x + ph) * 5.1)]);
    return pts;
  }
  add(wall(waveLine(3.2, 27, 0.28, 0.1, 1.3, 0), 0, 0, 7.4), 10.3, 11.95, C.blue, "sea");
  var SX = 10, SZ = 8.3, SS = 1.15, ship = { xfp: null };
  function shipAdd(pts, t0, t1, col, o) { add(wall(pts, SX, 0.05, SZ, SS), t0, t1, col, "ship", o); }
  shipAdd(lin([[-1.75, 1.05], [-1.6, 0.35], [-1.3, 0.05], [1.1, 0.05], [1.55, 0.35], [1.95, 0.95], [1.5, 0.72], [-1.05, 0.72], [-1.25, 1.05], [-1.75, 1.05]]), 12.0, 12.65, C.white);
  shipAdd(cat(ell(2.03, 1.06, 0.11, 0.1, Math.PI, Math.PI * 2, 18), ell(2.0, 1.17, 0.05, 0.05, 0, Math.PI * 2, 10)), 12.67, 12.8, C.white);
  shipAdd(lin([[0, 0.72], [0, 3.2]]), 12.82, 12.98, C.white);
  shipAdd(cat(lin([[-0.95, 2.95], [0.95, 2.95]]), cr([[0.95, 2.95], [1.08, 2.1], [0.85, 1.25]], 10), lin([[0.85, 1.25], [-0.85, 1.25]]), cr([[-0.85, 1.25], [-1.08, 2.1], [-0.95, 2.95]], 10)), 13.0, 13.6, C.white);
  shipAdd(lin([[0, 3.2], [0.58, 3.12], [0.52, 2.98], [0, 3.02]], 0.04), 13.62, 13.85, C.white);
  shipAdd(lin([[-1.75, 1.05], [0, 3.2], [1.95, 0.95]], 0.06), 13.6, 13.95, C.amber, { pen: false, a: 0.45 });
  // jolly roger: skull + straw hat + crossbones
  shipAdd(cat(ell(0, 2.03, 0.26, 0.25, Math.PI * 0.7, Math.PI * 1.6, 30), lin([[-0.13, 1.83], [-0.13, 1.69], [0.13, 1.69], [0.13, 1.83]], 0.03)), 13.95, 14.25, C.white);
  shipAdd(ell(-0.1, 2.02, 0.055, 0.06, 0, Math.PI * 2, 12), 14.27, 14.33, C.white);
  shipAdd(ell(0.1, 2.02, 0.055, 0.06, 0, Math.PI * 2, 12), 14.35, 14.41, C.white);
  shipAdd(cat(ell(0, 2.25, 0.45, 0.075, Math.PI, Math.PI * 2, 30), cr([[-0.24, 2.27], [-0.22, 2.45], [0, 2.52], [0.22, 2.45], [0.24, 2.27]], 8)), 14.45, 14.85, C.gold);
  shipAdd(lin([[-0.5, 1.52], [0.5, 1.82]], 0.04), 14.88, 15.0, C.white);
  shipAdd(lin([[0.5, 1.52], [-0.5, 1.82]], 0.04), 15.02, 15.14, C.white);
  add(wall(waveLine(5, 27, 0.22, 0.12, 1.6, 0.7), 0, 0, 9.6), 15.3, 16.7, C.cyan, "sea", { a: 0.7 });

  // -- the world map on the floor, Red Line + Grand Line + 4 Road Poneglyphs
  var MX = 34, MZ = 12;
  var border = [];
  [[-6, -4, 6, -4], [6, -4, 6, 4], [6, 4, -6, 4], [-6, 4, -6, -4]].forEach(function (e) {
    for (var k = 0; k <= 40; k++) {
      var u = lerp(e[0], e[2], k / 40), v = lerp(e[1], e[3], k / 40);
      border.push([u + 0.06 * Math.sin(k * 1.7 + e[1]), v + 0.06 * Math.cos(k * 1.3 + e[0])]);
    }
  });
  add(floor(border, MX, MZ), 17.55, 18.45, C.parch, "map", { refl: false, a: 0.6 });
  add(floor(cat(lin([[-0.3, -4], [-0.3, 4], [0.3, 4], [0.3, -4]], 0.1)), MX, MZ), 18.5, 19.0, C.red, "map", { refl: false, w: 1.5 });
  add(floor(cat(lin([[-6, 0.5], [6, 0.5], [6, -0.5], [-6, -0.5]], 0.1)), MX, MZ), 19.05, 19.7, C.cyan, "map", { refl: false });
  var PG = [[1.6, 1.3], [5.4, 1.4], [1.8, -1.3], [5.6, -1.2]], P = [3.6, 0.05];
  function cube(u, v) {
    var x = MX + u, z = MZ + v, a = 0.24, h = 0.75;
    var b = [[x - a, 0, z - a], [x + a, 0, z - a], [x + a, 0, z + a], [x - a, 0, z + a]];
    var tp = b.map(function (p) { return [p[0], h, p[2]]; });
    var order = [b[0], b[1], b[2], b[3], b[0], tp[0], tp[1], b[1], tp[1], tp[2], b[2], tp[2], tp[3], b[3], tp[3], tp[0]];
    var out = [];
    for (var i = 0; i < order.length - 1; i++) for (var k = 0; k < 6; k++) out.push([lerp(order[i][0], order[i + 1][0], k / 6), lerp(order[i][1], order[i + 1][1], k / 6), lerp(order[i][2], order[i + 1][2], k / 6)]);
    out.push(order[order.length - 1]);
    return out;
  }
  PG.forEach(function (p, i) { add(cube(p[0], p[1]), 20.0 + i * 0.5, 20.35 + i * 0.5, C.red, "glyph", { w: 1.2 }); });
  add(floor(lin([PG[0], PG[3]], 0.08), MX, MZ), 21.9, 22.4, C.gold, "glyph", { refl: false, w: 1.3 });
  add(floor(lin([PG[1], PG[2]], 0.08), MX, MZ), 22.42, 22.92, C.gold, "glyph", { refl: false, w: 1.3 });
  add(floor(ell(P[0], P[1], 0.4, 0.4, -Math.PI / 2, Math.PI * 2, 36), MX, MZ), 23.0, 23.3, C.gold, "glyph", { refl: false, w: 1.4 });

  // -- Laugh Tale: island, palm, treasure chest, and the straw hat
  var LX = 47, LZ = 9;
  add(wall(cr([[-3.2, 0], [-2.5, 0.35], [-1.6, 0.62], [-0.7, 1.02], [0.3, 1.18], [1.2, 1.02], [1.9, 0.7], [2.6, 0.32], [3.3, 0]], 10), LX, 0, LZ), 23.55, 24.45, C.parch, "isle");
  add(wall(cat(cr([[-1.6, 0.62], [-1.55, 1.3], [-1.38, 1.95], [-1.25, 2.3]], 8),
    cr([[-1.25, 2.3], [-1.75, 2.35], [-2.15, 2.0]], 6), cr([[-2.15, 2.0], [-1.7, 2.22], [-1.25, 2.3]], 6),
    cr([[-1.25, 2.3], [-0.75, 2.4], [-0.35, 2.05]], 6), cr([[-0.35, 2.05], [-0.8, 2.25], [-1.25, 2.3]], 6),
    cr([[-1.25, 2.3], [-1.3, 2.75], [-1.0, 2.95]], 6)), LX, 0, LZ), 24.5, 25.0, C.gold, "isle", { a: 0.85 });
  var CX = LX + 0.3, CY = 1.15;
  add(wall(lin([[-0.38, 0], [0.38, 0], [0.38, 0.42], [-0.38, 0.42], [-0.38, 0], [-0.38, 0.21], [0.38, 0.21]], 0.04), CX, CY, LZ), 25.05, 25.5, C.gold, "isle");
  var hingeY = CY + 0.42;
  function lidXf(t, p) {
    var a = 1.95 * smooth((t - 26.0) / 0.5), dy = p[1] - hingeY, dz = p[2] - LZ;
    return [p[0], hingeY + dy * Math.cos(a) - dz * Math.sin(a), LZ + dy * Math.sin(a) + dz * Math.cos(a)];
  }
  add(wall(cat(cr([[-0.38, 0], [-0.33, 0.17], [0, 0.26], [0.33, 0.17], [0.38, 0]], 8), lin([[0.38, 0], [-0.38, 0]], 0.04)), CX, hingeY, LZ), 25.52, 25.88, C.gold, "isle", { xfp: lidXf });
  // god rays from the open chest
  var r3 = mulberry32(99);
  for (var i = 0; i < 14; i++) {
    var ang = Math.PI * (0.12 + 0.76 * i / 13) + (r3() - 0.5) * 0.08, L = 1.6 + r3() * 1.6;
    add(wall(lin([[0.42 * Math.cos(ang), 0.55 + 0.42 * Math.sin(ang)], [L * Math.cos(ang), 0.55 + L * Math.sin(ang)]], 0.08), CX, CY, LZ - 0.05), 26.05 + r3() * 0.25, 26.6 + r3() * 0.3, C.gold, "isle", { pen: false, a: 0.35 });
  }
  var HX = CX, HY = 2.75;
  add(wall(ell(0, 0, 1.2, 0.21, Math.PI / 2, Math.PI * 2, 64), HX, HY, LZ - 0.2), 26.4, 26.95, C.gold, "hat", { w: 1.4 });
  add(wall(cr([[-0.62, 0.06], [-0.6, 0.46], [-0.41, 0.72], [0, 0.8], [0.41, 0.72], [0.6, 0.46], [0.62, 0.06]], 10), HX, HY, LZ - 0.2), 26.97, 27.45, C.gold, "hat", { w: 1.4 });
  add(wall(cr([[-0.61, 0.22], [0, 0.3], [0.61, 0.22]], 10), HX, HY, LZ - 0.2), 27.48, 27.68, C.hatband, "hat", { w: 1.6 });
  add(wall(cr([[-0.6, 0.4], [0, 0.48], [0.6, 0.4]], 10), HX, HY, LZ - 0.2), 27.7, 27.9, C.hatband, "hat", { w: 1.6 });

  // precompute arc lengths
  S.forEach(function (s) {
    var acc = [0];
    for (var i = 1; i < s.pts.length; i++) acc.push(acc[i - 1] + Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1], s.pts[i][2] - s.pts[i - 1][2]));
    s.acc = acc; s.len = acc[acc.length - 1] || 1e-6;
  });
  var PEN = S.filter(function (s) { return s.pen; }).sort(function (a, b) { return a.t0 - b.t0; });

  function xform(s, p, t) {
    var q = p;
    if (s.xfp) q = s.xfp(t, q);
    if (s.g && s.g.off) { var o = s.g.off(t); q = [q[0] + o[0], q[1] + o[1], q[2] + o[2]]; }
    return q;
  }
  function pointAt(s, k, t) { // point at fraction k of stroke length
    var d = k * s.len, a = s.acc, lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (a[m] < d) lo = m; else hi = m; }
    var seg = a[hi] - a[lo] || 1, f = clamp((d - a[lo]) / seg, 0, 1), p0 = s.pts[lo], p1 = s.pts[hi];
    return { i: lo, p: xform(s, [lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f), lerp(p0[2], p1[2], f)], t) };
  }

  // ------------------------------------------------------------ pen
  var PEN_START = [-10, 3.8, 12], PEN_END = [HX, HY + 1.0, LZ - 0.4];
  function penPos(t) {
    if (t <= PEN[0].t0) {
      var k = smooth((t - 0.2) / (PEN[0].t0 - 0.2)), e = pointAt(PEN[0], 0, t).p;
      return [lerp(PEN_START[0], e[0], k), lerp(PEN_START[1], e[1], k), lerp(PEN_START[2], e[2], k)];
    }
    for (var i = 0; i < PEN.length; i++) {
      var s = PEN[i];
      if (t >= s.t0 && t <= s.t1) return pointAt(s, (t - s.t0) / (s.t1 - s.t0), t).p;
      var n = PEN[i + 1];
      if (n && t > s.t1 && t < n.t0) {
        var a = pointAt(s, 1, t).p, b = pointAt(n, 0, t).p, kk = smooth((t - s.t1) / (n.t0 - s.t1));
        var lift = Math.sin(Math.PI * kk) * Math.min(1.2, 0.25 * Math.hypot(b[0] - a[0], b[2] - a[2]) + 0.15);
        return [lerp(a[0], b[0], kk), lerp(a[1], b[1], kk) + lift, lerp(a[2], b[2], kk)];
      }
    }
    var last = PEN[PEN.length - 1], le = pointAt(last, 1, t).p, kf = smooth((t - last.t1) / 1.2);
    var hover = [PEN_END[0] + 0.15 * Math.sin(t * 1.3), PEN_END[1] + 0.1 * Math.sin(t * 1.9), PEN_END[2]];
    return [lerp(le[0], hover[0], kf), lerp(le[1], hover[1], kf), lerp(le[2], hover[2], kf)];
  }
  function penColor(t) {
    for (var i = 0; i < PEN.length; i++) if (t <= PEN[i].t1) return PEN[i].col;
    return C.gold;
  }

  // ------------------------------------------------------------ camera
  var CAM = [
    [0, [-1.2, 1.5, -3.5], [0, 1.6, 8]],
    [2.5, [-0.8, 1.7, -1.5], [0, 1.7, 8]],
    [4.6, [0, 2.3, 2.6], [0, 2.4, 8]],
    [6.6, [0, 2.0, 0.5], [0, 2.2, 8]],
    [7.8, [0, 1.7, -1.5], [0, 2.0, 8]],
    [9.6, [0, 1.8, -0.8], [0, 2.2, 8]],
    [11.5, [6, 1.5, -1.0], [8, 1.5, 8]],
    [14, [10.8, 1.9, -0.5], [12, 1.9, 8]],
    [16.5, [15.5, 2.1, -0.5], [17, 1.8, 8]],
    [18.6, [31, 8.5, 2.5], [32.5, 0, 12.5]],
    [21.6, [34.5, 7.2, 4], [35.2, 0, 12.2]],
    [23.2, [37.6, 3.0, 6.0], [38.5, 0.5, 12]],
    [25.2, [46.4, 2.1, 2.8], [47.2, 1.8, 9]],
    [27.5, [47.0, 2.6, 2.6], [47.3, 2.6, 9]],
    [32, [47.2, 2.6, 4.2], [47.3, 2.6, 9]],
  ];
  function crv(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(function (d) {
      return 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
    });
  }
  function camAt(t) {
    var i = 0;
    while (i < CAM.length - 2 && t > CAM[i + 1][0]) i++;
    var a = CAM[i], b = CAM[i + 1], k = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    k = k * k * (3 - 2 * k) * 0.35 + k * 0.65; // gentle ease without full stops
    var pa = CAM[i - 1] || a, pb = CAM[i + 2] || b;
    var pos = crv(pa[1], a[1], b[1], pb[1], k), tg = crv(pa[2], a[2], b[2], pb[2], k);
    // handheld drift
    pos[0] += 0.03 * Math.sin(t * 0.9); pos[1] += 0.02 * Math.sin(t * 1.3 + 1);
    var f = norm(sub(tg, pos)), r = norm(cross([0, 1, 0], f)), u = cross(f, r);
    return { pos: pos, f: f, r: r, u: u };
  }
  function proj(cam, p, scale) {
    var d = sub(p, cam.pos), z = dot(d, cam.f);
    if (z < 0.25) return null;
    scale = scale || 1;
    return [(W / 2 + FOCAL * dot(d, cam.r) / z) * scale, (H / 2 - FOCAL * dot(d, cam.u) / z) * scale, z];
  }

  // ------------------------------------------------------------ particles / bursts
  var BURSTS = [
    { t: 8.0, p: [0, 3.26, 8], n: 260, col: C.white, speed: 3.2, up: 0.6, life: 1.8, flash: 0.5 },
    { t: 10.0, p: [1.0, 4.1, 9], n: 170, col: C.amber, speed: 4.0, up: 0, life: 1.4, flash: 0 },
    { t: 10.5, p: [4.4, 4.5, 10], n: 170, col: C.gold, speed: 4.2, up: 0, life: 1.4, flash: 0 },
    { t: 11.0, p: [7.6, 4.1, 10], n: 170, col: C.red, speed: 4.0, up: 0, life: 1.4, flash: 0 },
    { t: 22.95, p: [MX + P[0], 0.15, MZ + P[1]], n: 120, col: C.gold, speed: 2.2, up: 1.4, life: 1.3, flash: 0.2 },
    { t: 26.05, p: [CX, CY + 0.55, LZ], n: 260, col: C.gold, speed: 2.6, up: 2.2, life: 2.0, flash: 0.5 },
    { t: 28.0, p: [LX - 1.6, 4.6, LZ + 1], n: 110, col: C.gold, speed: 1.7, up: 0, life: 1.6, flash: 0.45 },
    { t: 28.45, p: [LX + 2.3, 4.9, LZ + 1.5], n: 110, col: C.hatband, speed: 1.7, up: 0, life: 1.6, flash: 0 },
  ];
  BURSTS.forEach(function (b, bi) {
    var r = mulberry32(1000 + bi);
    b.parts = [];
    for (var i = 0; i < b.n; i++) {
      var th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1), sp = b.speed * (0.35 + 0.65 * r());
      b.parts.push({ v: [sp * Math.sin(ph) * Math.cos(th), sp * Math.cos(ph) + b.up * r(), sp * Math.sin(ph) * Math.sin(th) * 0.6], life: b.life * (0.5 + 0.5 * r()), tw: r() * 20 });
    }
  });
  function partPos(b, q, dt) {
    var drag = (1 - Math.exp(-1.6 * dt)) / 1.6;
    return [b.p[0] + q.v[0] * drag, b.p[1] + q.v[1] * drag - 0.9 * dt * dt, b.p[2] + q.v[2] * drag];
  }

  // ------------------------------------------------------------ backdrop data
  var rb = mulberry32(5), BOKEH = [];
  for (var bi2 = 0; bi2 < 70; bi2++) BOKEH.push({ p: [-14 + rb() * 80, 0.6 + rb() * 3.8, 16 + rb() * 16], r: 0.07 + rb() * 0.12, ph: rb() * 6.28, a: 0.35 + rb() * 0.65 });
  var BG = [[0, [26, 17, 10]], [10, [26, 17, 10]], [12.5, [7, 17, 30]], [17, [7, 17, 30]], [19, [22, 8, 10]], [23, [22, 8, 10]], [25, [28, 19, 8]], [32, [30, 20, 8]]];
  var BOK = [[0, [255, 168, 90]], [10, [255, 168, 90]], [12.5, [120, 180, 255]], [17, [120, 180, 255]], [19, [255, 90, 70]], [23, [255, 90, 70]], [25, [255, 196, 110]], [32, [255, 196, 110]]];

  // ------------------------------------------------------------ canvases
  var main, ctx, lines, lctx, refl, rctx, bloom, bctx, grain;
  function mk(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function init(canvas) {
    main = canvas; ctx = main.getContext("2d");
    lines = mk(W, H); lctx = lines.getContext("2d");
    refl = mk(W / 2, H / 2); rctx = refl.getContext("2d");
    bloom = mk(W / 4, H / 4); bctx = bloom.getContext("2d");
    grain = mk(256, 256);
    var g = grain.getContext("2d"), id = g.createImageData(256, 256), rg = mulberry32(3);
    for (var i = 0; i < id.data.length; i += 4) { var v = 128 + (rg() - 0.5) * 120; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    g.putImageData(id, 0, 0);
  }

  // stroke drawing ------------------------------------------------------
  function strokeLayer(c, cam, t, scale, mirror, gain) {
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round"; c.lineJoin = "round";
    for (var si = 0; si < S.length; si++) {
      var s = S[si];
      if (t < s.t0) continue;
      if (mirror && !s.refl) continue;
      var dim = (s.g ? keys(s.g.dim, t) : 1) * s.a * gain;
      if (dim <= 0.01) continue;
      var prog = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1), end = pointAt(s, prog, t);
      var path = new Path2D(), started = false, zsum = 0, zn = 0;
      for (var i = 0; i <= end.i + 1; i++) {
        var p = i <= end.i ? xform(s, s.pts[i], t) : end.p;
        if (mirror) p = [p[0], -p[1], p[2]];
        var q = proj(cam, p, scale);
        if (!q) { started = false; continue; }
        if (!started) { path.moveTo(q[0], q[1]); started = true; } else path.lineTo(q[0], q[1]);
        zsum += q[2]; zn++;
      }
      if (!zn) continue;
      var zf = clamp(7 / (zsum / zn), 0.35, 2.2) * scale * s.w;
      // fresh trails burn hotter for a moment
      var hot = 1 + 0.6 * Math.exp(-(t - s.t1 > 0 ? t - s.t1 : 0) * 2.5);
      c.strokeStyle = rgba(s.col, 0.07 * dim * hot); c.lineWidth = 22 * zf; c.stroke(path);
      c.strokeStyle = rgba(s.col, 0.22 * dim * hot); c.lineWidth = 8 * zf; c.stroke(path);
      c.strokeStyle = rgba(mixc(s.col, [255, 255, 255], 0.55), 0.85 * Math.min(dim, 1.3)); c.lineWidth = 2.6 * zf; c.stroke(path);
    }
  }

  function glowDot(c, x, y, r, col, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba([255, 255, 255], a)); g.addColorStop(0.12, rgba(mixc(col, [255, 255, 255], 0.5), a * 0.8));
    g.addColorStop(0.4, rgba(col, a * 0.25)); g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }

  function render(t) {
    if (!ctx) return;
    var cam = camAt(t), bgc = keys(BG, t), bok = keys(BOK, t);
    var fade = smooth(t / 0.6) * (1 - smooth((t - 31.0) / 0.95));

    // flash & global energy from bursts
    var flash = 0;
    BURSTS.forEach(function (b) { if (t >= b.t) flash += b.flash * Math.exp(-(t - b.t) * 7); });

    // -- background
    ctx.globalCompositeOperation = "source-over"; ctx.filter = "none"; ctx.globalAlpha = 1;
    var hz = proj(cam, [cam.pos[0] + cam.f[0] * 60, 0, cam.pos[2] + cam.f[2] * 60]);
    var hy = hz ? clamp(hz[1], -200, H + 200) : H * 0.6;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(mixc(bgc, [0, 0, 0], 0.65), 1));
    g.addColorStop(clamp(hy / H, 0.05, 0.95), rgba(bgc, 1));
    g.addColorStop(1, rgba(mixc(bgc, [0, 0, 0], 0.4), 1));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // back wall panels (stage curtains)
    for (var px = -24; px < 84; px += 3.2) {
      var a1 = proj(cam, [px, 0, 34]), a2 = proj(cam, [px + 1.3, 0, 34]), a3 = proj(cam, [px + 1.3, 16, 34]), a4 = proj(cam, [px, 16, 34]);
      if (!a1 || !a2 || !a3 || !a4) continue;
      ctx.fillStyle = rgba(mixc(bgc, [255, 255, 255], 0.08), 0.35);
      ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.lineTo(a3[0], a3[1]); ctx.lineTo(a4[0], a4[1]); ctx.fill();
    }
    // floor sheen
    var fg = ctx.createLinearGradient(0, hy, 0, H);
    fg.addColorStop(0, rgba(mixc(bgc, [255, 255, 255], 0.12), 0.55)); fg.addColorStop(1, rgba([0, 0, 0], 0.5));
    ctx.fillStyle = fg; ctx.fillRect(0, Math.max(0, hy), W, H - Math.max(0, hy));

    // bokeh lights + their wet-floor smears
    ctx.globalCompositeOperation = "lighter";
    BOKEH.forEach(function (b) {
      var q = proj(cam, b.p);
      if (!q || q[0] < -100 || q[0] > W + 100) return;
      var rr = clamp(FOCAL * b.r / q[2], 3, 40) + 6, fl = b.a * (0.75 + 0.25 * Math.sin(t * 1.7 + b.ph));
      glowDot(ctx, q[0], q[1], rr * 2.2, bok, 0.3 * fl);
      var m = proj(cam, [b.p[0], -b.p[1], b.p[2]]);
      if (m) { ctx.save(); ctx.translate(m[0], m[1]); ctx.scale(0.6, 2.4); glowDot(ctx, 0, 0, rr * 1.6, bok, 0.08 * fl); ctx.restore(); }
    });

    // -- reflections (half-res, blurred)
    rctx.globalCompositeOperation = "source-over"; rctx.clearRect(0, 0, W / 2, H / 2);
    strokeLayer(rctx, cam, t, 0.5, true, 0.55);
    var pp = penPos(t), pc = penColor(t), penA = smooth((t - 0.25) / 0.4) * (1 - smooth((t - 31.0) / 0.8));
    var pm = proj(cam, [pp[0], -pp[1], pp[2]], 0.5);
    if (pm && penA > 0) { rctx.save(); rctx.translate(pm[0], pm[1]); rctx.scale(0.5, 2.2); glowDot(rctx, 0, 0, 40, pc, 0.5 * penA); rctx.restore(); }
    ctx.globalCompositeOperation = "lighter"; ctx.filter = "blur(5px)"; ctx.globalAlpha = 0.55;
    ctx.drawImage(refl, 0, 0, W, H);
    ctx.filter = "none"; ctx.globalAlpha = 1;

    // -- light strokes, pen and particles
    lctx.globalCompositeOperation = "source-over"; lctx.clearRect(0, 0, W, H);
    strokeLayer(lctx, cam, t, 1, false, 1 + flash * 0.6);
    // particles
    BURSTS.forEach(function (b) {
      var dt0 = t - b.t; if (dt0 < 0 || dt0 > b.life + 0.1) return;
      lctx.lineCap = "round";
      b.parts.forEach(function (q) {
        if (dt0 > q.life) return;
        var a = proj(cam, partPos(b, q, dt0)), c2 = proj(cam, partPos(b, q, Math.max(0, dt0 - 0.06)));
        if (!a || !c2) return;
        var al = (1 - dt0 / q.life) * (0.6 + 0.4 * Math.sin(dt0 * 30 + q.tw));
        lctx.strokeStyle = rgba(mixc(b.col, [255, 255, 255], 0.5), al);
        lctx.lineWidth = clamp(14 / a[2], 0.8, 4);
        lctx.beginPath(); lctx.moveTo(c2[0], c2[1]); lctx.lineTo(a[0], a[1]); lctx.stroke();
      });
    });
    // pen: motion trail + flare
    if (penA > 0) {
      lctx.globalCompositeOperation = "lighter";
      var prev = null;
      for (var k = 10; k >= 0; k--) {
        var tp = proj(cam, penPos(Math.max(0, t - k * 0.012)));
        if (tp && prev) { lctx.strokeStyle = rgba(pc, 0.5 * (1 - k / 11) * penA); lctx.lineWidth = 5 * (1 - k / 12) + 1; lctx.beginPath(); lctx.moveTo(prev[0], prev[1]); lctx.lineTo(tp[0], tp[1]); lctx.stroke(); }
        prev = tp;
      }
      var q = proj(cam, pp);
      if (q) {
        var flick = 0.9 + 0.1 * Math.sin(t * 47) * Math.sin(t * 31);
        glowDot(lctx, q[0], q[1], 70 * flick, pc, 0.95 * penA);
        glowDot(lctx, q[0], q[1], 16, [255, 255, 255], penA);
        lctx.save(); lctx.translate(q[0], q[1]); lctx.scale(9, 0.22); glowDot(lctx, 0, 0, 40, pc, 0.35 * penA); lctx.restore();
      }
    }
    // composite lines + bloom
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(lines, 0, 0);
    bctx.globalCompositeOperation = "source-over"; bctx.clearRect(0, 0, W / 4, H / 4);
    bctx.filter = "blur(6px)"; bctx.drawImage(lines, 0, 0, W / 4, H / 4); bctx.filter = "none";
    ctx.globalAlpha = 0.9; ctx.drawImage(bloom, 0, 0, W, H);
    ctx.globalAlpha = 0.5; ctx.filter = "blur(10px)"; ctx.drawImage(bloom, 0, 0, W, H); ctx.filter = "none";
    ctx.globalAlpha = 1;

    // haze lit by the pen
    var qh = proj(cam, pp);
    if (qh && penA > 0) glowDot(ctx, qh[0], qh[1], 520, pc, 0.12 * penA);
    // atmospheric haze band at the horizon
    var hb = ctx.createLinearGradient(0, hy - 260, 0, hy + 120);
    hb.addColorStop(0, rgba(bok, 0)); hb.addColorStop(0.7, rgba(bok, 0.05)); hb.addColorStop(1, rgba(bok, 0));
    ctx.fillStyle = hb; ctx.fillRect(0, hy - 260, W, 380);

    // flash
    if (flash > 0.002) { ctx.fillStyle = rgba([255, 244, 225], Math.min(0.9, flash)); ctx.fillRect(0, 0, W, H); }

    // vignette, grain, fades
    ctx.globalCompositeOperation = "source-over";
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    var fr = Math.round(t * 30), gr = mulberry32(fr + 17);
    ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = 0.09;
    ctx.save(); ctx.translate(-gr() * 256, -gr() * 256);
    ctx.fillStyle = ctx.createPattern(grain, "repeat"); ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (fade < 1) { ctx.fillStyle = rgba([0, 0, 0], 1 - fade); ctx.fillRect(0, 0, W, H); }
  }

  window.LightScene = { init: init, render: render, DUR: DUR };
})();
