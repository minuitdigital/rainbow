// =========================================================================
//  LA SPHÈRE ET SA MISE À PLAT
//
//  Mathématiques pures, sans état ni dépendance. Projection Equal Earth
//  (Šavrič, Patterson & Jenny, 2018), aller et retour, et rotations 3×3 :
//  la carte ne glisse pas, le globe tourne sous un plan de projection fixe.
// =========================================================================

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// Les quatre coefficients du polynôme d'Equal Earth, et √3/2.
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
export const M = Math.sqrt(3) / 2;

/** y de la projection, en fonction de l'angle auxiliaire θ. */
export const fy = t => { const a = t*t, b = a*a*a; return t * (A1 + A2*a + b*(A3 + A4*a)); };

/** Sa dérivée : pour Newton et pour l'échelle. */
export const fyp = t => { const a = t*t, b = a*a*a; return A1 + 3*A2*a + b*(7*A3 + 9*A4*a); };

/** Demi-largeur et demi-hauteur du monde entier, en unités de projection. */
export const XMAX = Math.PI / (M * A1);
export const YMAX = fy(Math.asin(M));

export const clamp1 = v => v < -1 ? -1 : v > 1 ? 1 : v;

/** Ramène un écart d'angle dans ]−180, 180]. */
export const wrap180 = d => { d = (d + 180) % 360; return (d < 0 ? d + 360 : d) - 180; };

/**
 * Plan → (longitude, latitude) en radians, avant toute rotation. Pas de
 * forme close : Newton sur θ, comme le shader. null hors du monde.
 */
export function inverseEE(x, y) {
  let th = Math.asin(clamp1(y / YMAX) * M);
  for (let i = 0; i < 7; i++) th -= (fy(th) - y) / fyp(th);
  const s = Math.sin(th) / M;
  if (s < -1 || s > 1) return null;
  const lam = M * x * fyp(th) / Math.cos(th);
  if (lam < -Math.PI || lam > Math.PI) return null;
  return [lam, Math.asin(s)];
}

/** (longitude, latitude) en degrés vers un vecteur unitaire. */
export const geoVec = (lon, lat) => {
  const cp = Math.cos(lat * DEG);
  return [cp * Math.cos(lon * DEG), cp * Math.sin(lon * DEG), Math.sin(lat * DEG)];
};

/**
 * Vecteur géographique → repère de la vue (Rt) → plan. Rend [x, y, lon
 * relative en degrés] ; un saut de +180 à −180 dit de lever le crayon.
 */
export function flatten(Rt, v) {
  const q = matVec(Rt, v);
  const lam = Math.atan2(q[1], q[0]);
  const th = Math.asin(M * clamp1(q[2]));
  return [lam * Math.cos(th) / (M * fyp(th)), fy(th), lam * RAD];
}

/** Distance angulaire en degrés entre (lon, lat) et un centre [lon, lat]. */
export function angDist(lon, lat, c) {
  const a = lat * DEG, b = c[1] * DEG, dl = (lon - c[0]) * DEG;
  return Math.acos(clamp1(
    Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl))) * RAD;
}

// ------------------------------------------------------------- algèbre 3×3
// Colonnes majeures, comme uniformMatrix3fv : pas de transposition.

export const matMul = (A, B) => {
  const O = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += A[k*3 + r] * B[c*3 + k];
    O[c*3 + r] = s;
  }
  return O;
};

export const matVec = (A, v) => [
  A[0]*v[0] + A[3]*v[1] + A[6]*v[2],
  A[1]*v[0] + A[4]*v[1] + A[7]*v[2],
  A[2]*v[0] + A[5]*v[1] + A[8]*v[2]
];

export const matT = A => {
  const O = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) O[c*3 + r] = A[r*3 + c];
  return O;
};

export const identity = () => new Float32Array([1,0,0, 0,1,0, 0,0,1]);

export const cross = (a, b) =>
  [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];

export const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

/** Rotation d'angle th autour de l'axe unitaire n. */
export const rodrigues = (n, th) => {
  const c = Math.cos(th), s = Math.sin(th), k = 1 - c, [x, y, z] = n;
  return new Float32Array([
    c + x*x*k,   y*x*k + z*s, z*x*k - y*s,
    x*y*k - z*s, c + y*y*k,   z*y*k + x*s,
    x*z*k + y*s, y*z*k - x*s, c + z*z*k
  ]);
};

/**
 * Les rotations composées dérivent et le globe finit par cisailler :
 * on redresse de temps en temps (voir view.bump).
 */
export function orthonormalize(A) {
  let c0 = [A[0], A[1], A[2]], c1 = [A[3], A[4], A[5]];
  let n = Math.hypot(...c0); c0 = c0.map(v => v / n);
  const d = dot3(c1, c0);
  c1 = c1.map((v, i) => v - d * c0[i]);
  n = Math.hypot(...c1); c1 = c1.map(v => v / n);
  return new Float32Array([...c0, ...c1, ...cross(c0, c1)]);
}

/**
 * Rotation minimale de a vers b : le point saisi reste sous le doigt,
 * pôles compris. null si a et b sont confondus.
 */
export function between(a, b) {
  const ax = cross(a, b), s = Math.hypot(...ax), d = dot3(a, b);
  if (s < 1e-9) return null;
  return rodrigues(ax.map(v => v / s), Math.atan2(s, d));
}
