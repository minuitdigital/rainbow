// =========================================================================
//  LE SHADER
//
//  Deux chaînes de GLSL, rien d'autre. Aucune logique JavaScript ici : le
//  fichier se lit comme le programme qu'il contient.
//
//  Le principe fondamental de toute la carte tient dans le fragment : pour
//  CHAQUE PIXEL de l'écran, le processeur graphique remonte aux coordonnées
//  Equal Earth, inverse la projection par Newton, applique la rotation de
//  la sphère, obtient une latitude et une longitude, et va chercher les
//  valeurs dans des textures en plate carrée.
//
//  Rien n'est déplacé, tout est recalculé. D'où : le zoom précise au lieu
//  de flouter, et les aplats ont des bords calculés donc nets à toute
//  échelle.
//
//  La deuxième moitié du fragment est le MIROIR de src/sky.js. Les deux
//  doivent dire la même chose, sinon le chiffre lu sous le réticule cesse
//  de décrire la couleur qu'on a sous les yeux.
// =========================================================================

/** Places réservées pour les hauts lieux de la croyance. */
export const MAX_LEGENDS = 48;

export const VERTEX = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform float uScale, uMode;
uniform mat3  uRot;
uniform float uDecl, uSublon, uDrift, uDriftC, uDetail;
uniform float uSat, uTache, uGrey;     // l'allure : teinte, force, encodage
uniform vec3  uBelief;                 // météo, légende, chance — somme = 1
uniform int   uLegN;
uniform vec4  uLegP[${MAX_LEGENDS}];   // xyz = vecteur unitaire, w = force
uniform float uLegQ[${MAX_LEGENDS}];   // rayon au carré, en cordes
uniform sampler2D uEarth, uField, uMask;
out vec4 fragColor;

const float A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const float M   = 0.86602540378;
const float PI  = 3.14159265359;
const float YMAX = 1.31736275916;
const float NSEA = 7.0, NLAND = 8.0;

const float SUN_MAX = 42.0;
const float GAIN = 1.8;
const float LEGEND_FLOOR = 0.09;
const float FIELD_FREQ = 3.6;
const float CHANCE_FREQ = 0.62;
const float BANDS = 6.0;

float fyf (float t){ float a=t*t, b=a*a*a; return t*(A1 + A2*a + b*(A3 + A4*a)); }
float fypf(float t){ float a=t*t, b=a*a*a; return A1 + 3.0*A2*a + b*(7.0*A3 + 9.0*A4*a); }

float hash31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                 mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                 mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  return 0.56 * vnoise(p) + 0.29 * vnoise(p * 2.13) + 0.15 * vnoise(p * 4.37);
}

// LA TRAME ORDONNÉE. La matrice de Bayer 8×8, engendrée par la même
// récurrence que d'habitude mais calculée bit à bit : à chaque niveau, le
// quadrant (qx, qy) vaut 2·(qx⊕qy) + qy. Pas de tableau constant, pas
// d'indexation dynamique, et le motif ne se lit pas comme une grille.
//
// Des POINTS et non des hachures : une hachure impose une direction, et
// sur une carte toute direction finit par avoir l'air de signifier
// quelque chose. La part de cases noircies vaut exactement l'intensité —
// c'est littéralement ce que fera le tramage de l'e-ink.
float bayer8(ivec2 p){
  int v = 0;
  for(int b = 2; b >= 0; b--){
    int qx = (p.x >> b) & 1, qy = (p.y >> b) & 1;
    v = (v << 2) | (2 * (qx ^ qy) + qy);
  }
  return (float(v) + 0.5) / 64.0;
}

// LA LÉGENDE. Le plancher, relevé par le haut lieu le plus proche. Un
// maximum et non une somme : deux traditions voisines ne s'additionnent
// pas, on croit à la plus forte des deux. On compare des cordes plutôt
// que des angles — à ces distances l'écart est sous le pixel, et ça
// épargne un arc-cosinus par point et par pixel.
float legendAt(vec3 g){
  float v = LEGEND_FLOOR;
  for(int i = 0; i < ${MAX_LEGENDS}; i++){
    if(i >= uLegN) break;
    vec3 d = g - uLegP[i].xyz;
    v = max(v, uLegP[i].w * exp(-dot(d, d) / uLegQ[i]));
  }
  return min(v, 1.0);
}

void main(){
  float x = (gl_FragCoord.x - uRes.x * 0.5) / uScale;
  float y = (gl_FragCoord.y - uRes.y * 0.5) / uScale;

  // --- inverse de la projection (Newton sur theta)
  float th = asin(clamp(y / YMAX, -1.0, 1.0) * M);
  for(int i = 0; i < 6; i++) th -= (fyf(th) - y) / fypf(th);

  float sn  = sin(th) / M;
  float lam = M * x * fypf(th) / cos(th);

  // couverture du contour : lam et sn vivent avant la rotation, donc continus
  float cov = min(clamp((PI  - abs(lam)) / max(fwidth(lam), 1e-6) + 0.5, 0.0, 1.0),
                  clamp((1.0 - abs(sn))  / max(fwidth(sn),  1e-6) + 0.5, 0.0, 1.0));

  // --- rotation libre de la sphère
  float phiR = asin(clamp(sn, -1.0, 1.0));
  float cp = cos(phiR);
  vec3 g = uRot * vec3(cp * cos(lam), cp * sin(lam), sin(phiR));

  float lat = degrees(asin(clamp(g.z, -1.0, 1.0)));
  float lon = degrees(atan(g.y, g.x));

  // --- échantillonnage sans couture : u saute au méridien opposé, donc on
  // calcule le gradient sur deux versions décalées d'un demi-tour et on
  // garde le plus petit, sinon le mipmap s'effondre le long de la couture.
  float v  = (lat + 90.0) / 180.0;
  float u1 = lon / 360.0 + 0.5;
  float u2 = fract(u1 + 0.5);
  vec2 d1 = vec2(dFdx(u1), dFdy(u1));
  vec2 d2 = vec2(dFdx(u2), dFdy(u2));
  vec2 du = dot(d1, d1) < dot(d2, d2) ? d1 : d2;
  vec2 dv = vec2(dFdx(v), dFdy(v));
  vec2 uv = vec2(u1, v);
  vec2 gx = vec2(du.x, dv.x), gy = vec2(du.y, dv.y);

  // --- APLATS : paliers découpés dans le champ (0 = fosses, .5 = côte, 1 = sommets)
  float f = textureGrad(uField, uv, gx, gy).r;
  float bS = clamp((0.5 - f) * 2.0, 0.0, 1.0) * NSEA;
  float bL = clamp((f - 0.5) * 2.0, 0.0, 1.0) * NLAND;
  float wS = max(fwidth(bS), 1e-4), wL = max(fwidth(bL), 1e-4);
  float qS = (floor(bS) + smoothstep(1.0 - wS, 1.0, fract(bS))) / NSEA;
  float qL = (floor(bL) + smoothstep(1.0 - wL, 1.0, fract(bL))) / NLAND;
  float wC = max(fwidth(f), 1e-5);
  float isLand = smoothstep(0.5 - wC, 0.5 + wC, f);

  // --- LE LUSTRE. earth.jpg n'est pas une carte de reflets, c'est une carte
  // d'OMBRES : à pleine amplitude elle réimprime tout le relief par-dessus
  // les aplats. Elle ne sert donc qu'à creuser légèrement les versants.
  float shaded = textureGrad(uEarth, uv, gx, gy).r;
  float shade = 1.0 - clamp((shaded - 0.54) / 0.46, 0.0, 1.0);

  vec3 sea  = mix(vec3(0.948, 0.954, 0.964), vec3(0.792, 0.806, 0.830), qS);
  vec3 land = mix(vec3(0.995, 0.996, 1.000), vec3(0.655, 0.667, 0.688), qL);
  land *= 1.0 - shade * 0.14;

  vec3 ground = mix(sea, land, isLand);
  vec3 alt = mix(vec3(0.90, 0.912, 0.928), vec3(shaded), isLand);
  ground = mix(ground, alt, uMode);
  float m = texture(uMask, uv).r;

  // ====================================================== LA PORTE
  float field = 0.0;
  vec3  hue   = vec3(1.0);

  float d = radians(uDecl), pl = radians(lat), Hh = radians(lon - uSublon);
  float h = degrees(asin(clamp(sin(pl) * sin(d) + cos(pl) * cos(d) * cos(Hh), -1.0, 1.0)));

  if(h > 0.4 && h < SUN_MAX){
    // Le soleil ouvre la fenêtre, et rien d'autre ne peut l'ouvrir.
    float S = pow(1.0 - h / SUN_MAX, 1.3) * smoothstep(0.0, 6.5, h);

    float ccl = cos(pl);
    vec3 sp = vec3(ccl * cos(radians(lon)), ccl * sin(radians(lon)), sin(pl)) * FIELD_FREQ;

    // ---- MÉTÉO : la pluie et la trouée
    float rain = smoothstep(0.44, 0.70, fbm(sp + vec3(uDrift, 0.0, 0.0)));
    float a = (lat - uDecl * 0.45) / 9.5;
    float b = (abs(lat) - 48.0) / 15.0;
    float gap = (0.14 + 0.92 * exp(-a * a) + 0.74 * exp(-b * b)) * m;
    float MET = 1.0 - exp(-rain * (gap / 1.2) * 6.0);

    // ---- LÉGENDE : le plancher, et les hauts lieux
    float LEG = legendAt(g);

    // ---- CHANCE : plus lente, plus large, et sans rapport avec la météo.
    // Seuillée serré : ce ne sont pas des voiles mais des poches.
    float CHA = smoothstep(0.46, 0.76,
                  fbm(sp * CHANCE_FREQ + vec3(uDriftC + 41.0, 17.0, 7.0)));

    // ---- le partage de la croyance
    float belief = uBelief.x * MET + uBelief.y * LEG + uBelief.z * CHA;
    float t = clamp(S * belief * GAIN, 0.0, 1.0);

    // LE GRAIN. Le bruit de base n'a rien de plus fin que ~400 km : passé
    // ×10 on regardait un aplat uniforme, et s'approcher ne montrait rien.
    // Deux octaves fines entrent progressivement. Elles ne DÉPLACENT pas la
    // tache — elles la dépolissent : la structure, donc l'indice lu, reste
    // celle du champ. C'est de la matière, pas de la donnée.
    if(uDetail > 0.002){
      float grain = (vnoise(sp *  6.1) - 0.5) * 1.10
                  + (vnoise(sp * 15.7) - 0.5) * 0.60;
      t = clamp(t * (1.0 + uDetail * 0.55 * grain), 0.0, 1.0);
    }

    // Et elle s'efface en s'approchant. Vue du monde, la tache est un
    // signal qu'on lit d'un continent à l'autre ; de près, on est DANS le
    // paysage et l'arc n'est plus qu'un indice — sinon la couleur noie le
    // relief et zoomer revient à se coller à un vitrail.
    //
    // uTache n'entre QUE là : c'est un gain sur la force de la tache, pas
    // sur la valeur t. La teinte, elle, continue de dire la même chose.
    float fv = clamp(pow(t, 1.15) * 0.98 * mix(1.0, 0.40, uDetail) * uTache, 0.0, 1.0);

    if(uGrey > 0.5){
      // EN DÉGRADÉ, la force ne peut plus passer par la teinte : elle
      // passe par la DENSITÉ, découpée en paliers — le même langage que
      // les aplats du relief. Pas de trait d'iso-valeur : la marche entre
      // deux paliers se voit toute seule, et un trait par-dessus faisait
      // carte géologique.
      float band = floor(fv * BANDS) / BANDS;
      float v = 1.0 - pow(band, 0.85) * 0.50;

      // Il faut bien quelque chose de plus : en couleur la teinte suffit
      // à séparer la tache du fond, en gris elle entre en concurrence
      // avec le relief, lui aussi gris et lui aussi lisse.
      if(bayer8(ivec2(gl_FragCoord.xy)) < clamp((fv - 0.12) / 0.88, 0.0, 1.0))
        v -= 0.20;

      hue = vec3(v);
      field = 1.0;          // la densité REMPLACE la teinte, elle ne s'y ajoute pas
    } else {
      field = fv;

      // Irisation : palette cosinus parcourue plusieurs fois, décalée par un
      // bruit lent. On obtient des bandes imbriquées, comme de l'huile sur
      // l'eau, plutôt qu'un simple dégradé chaud-froid.
      float k = t * 1.35 + vnoise(sp * 0.55) * 0.40 + uDrift * 0.03;
      vec3 c = 0.5 + 0.5 * cos(6.28318 * k + vec3(0.0, 2.0944, 4.1888));
      c = mix(vec3(dot(c, vec3(0.3333))), c, uSat);      // saturation
      // plancher relevé : sur papier blanc, une teinte trop basse vire à la boue
      hue = clamp(0.10 + 0.90 * c, 0.0, 1.0);
    }
  }

  // Multiplication : sur le papier, les taches teintent au lieu d'éclairer.
  // Si le fond redevenait sombre, il faudrait repasser en additif.
  vec3 col = ground * mix(vec3(1.0), hue, field);
  fragColor = vec4(mix(vec3(1.0), col, cov), 1.0);
}`;
