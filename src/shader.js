// =========================================================================
//  LE SHADER — deux chaînes de GLSL. Pour chaque pixel : Equal Earth
//  inversée, rotation de la sphère, puis lecture des textures. Tout est
//  recalculé, donc net à toute échelle.
//  La porte et la croyance sont le MIROIR de src/sky.js (build/check_mirror.mjs).
// =========================================================================

/** Places réservées pour les hauts lieux de la croyance. */
export const MAX_LEGENDS = 48;

export const VERTEX = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAGMENT = `#version 300 es
precision highp float;

// sampler2DArray n'a pas de precision par defaut en GLSL ES 3.00. Sans
// cette ligne le shader ne compile pas et l'ecran reste NOIR, sans erreur.
precision highp sampler2DArray;

uniform vec2  uRes;
uniform float uScale;
uniform float uOx;                     // decalage du centre, en pixels du calque
uniform mat3  uRot;
uniform float uDecl, uSublon, uDrift, uDriftC, uDetail;
uniform float uFine;                   // la finesse : 0 au monde, plein de près
uniform float uSeuil;                  // sous cette presence, du papier
uniform float uFranges;                // tours de palette — l'ordre d'interférence
uniform float uSat, uTache, uGrey;     // l'allure : teinte, force, encodage
uniform float uPorte;                  // 1 = tracer le couloir du soleil
uniform vec2  uCouloir;                // x = ecart des points, y = epaisseur
uniform float uSea, uLand;             // profondeur d'encre des aplats
uniform vec3  uBelief;                 // météo, légende, chance — somme = 1
uniform vec3  uHere;                   // le réticule : là où se tient le piéton
uniform int   uLegN;
// Coupures de l'admin, bit a bit : 1 relief, 2 tache, 4 chance, 8 meteo,
// 16 legendes, 32 grain. Uniformes : la branche coupee ne coute rien.
uniform int   uOff;
// PIXEL — la tache en gros pixels (option P, a l'essai contre A). uPass :
//   0  tout en direct ;
//   1  la tache seule, un fragment par bloc de uPixN pixels, dans uPix ;
//   2  le fond net, la tache relue dans uPix sans lissage.
// Tout ce qui porte le mot PIXEL se retire d'un bloc quand on aura choisi.
uniform int   uPass;
uniform float uPixN;
uniform sampler2D uPix;
uniform float uPal;                    // PALETTE : teintes par tour, 0 = continue
uniform float uCoast;                  // COTES : epaisseur en pixels du calque, 0 = rien
uniform vec4  uLegP[${MAX_LEGENDS}];   // xyz = vecteur unitaire, w = force
uniform float uLegQ[${MAX_LEGENDS}];   // rayon au carré, en cordes
uniform float uLegR[${MAX_LEGENDS}];   // au-dela (corde au carre), sous le plancher
uniform sampler2D uField, uMask;

// La meteo Open-Meteo, un pas de trois heures par couche. Des couches
// plutot qu'un damier : un damier bave d'une case a l'autre au filtrage.
//      R   la pluie du voisinage, dilatee d'une case par le script
//      G   la clarte directe : des rayons non interceptes arrivent-ils ici
//      B   la pluie locale, lue par personne
uniform sampler2DArray uWx;
uniform float uWxOn;                   // 0 = le bruit fractal, 1 = la grille
uniform float uSlot, uWxN;             // ou l'on en est, et combien de pas
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
const float LUCK_NEAR = 10.0, LUCK_FAR = 48.0;
const float SPILL_AMP = 0.55, SPILL_DEG = 18.0;

// Aplats : le papier, et l'encre du palier le plus profond.
// Pas d'accent grave dans ce fichier : le GLSL vit dans un gabarit de chaine.
const vec3 SEA_LIGHT  = vec3(0.948, 0.954, 0.964);
const vec3 SEA_DEEP   = vec3(0.792, 0.806, 0.830);
const vec3 LAND_LIGHT = vec3(0.995, 0.996, 1.000);
const vec3 LAND_DEEP  = vec3(0.655, 0.667, 0.688);
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

// Trame de Bayer 8x8 calculee bit a bit (quadrant = 2*(qx^qy) + qy) :
// ni tableau ni indexation dynamique. Des points plutot que des hachures,
// qui imposeraient une direction.
float bayer8(ivec2 p){
  int v = 0;
  for(int b = 2; b >= 0; b--){
    int qx = (p.x >> b) & 1, qy = (p.y >> b) & 1;
    v = (v << 2) | (2 * (qx ^ qy) + qy);
  }
  return (float(v) + 0.5) / 64.0;
}

// LA LEGENDE : un maximum et non une somme, on croit a la plus forte.
// Des cordes plutot que des angles : l'ecart est sous le pixel, et on
// epargne un arc-cosinus.
float legendAt(vec3 g){
  float v = LEGEND_FLOOR;
  for(int i = 0; i < ${MAX_LEGENDS}; i++){
    if(i >= uLegN) break;
    vec3 d = g - uLegP[i].xyz;
    // Au-dela de uLegR on serait sous le plancher : l'exponentielle est sautee.
    float dd = dot(d, d);
    if(dd < uLegR[i]) v = max(v, uLegP[i].w * exp(-dd / uLegQ[i]));
  }
  return min(v, 1.0);
}

void main(){
  // PIXEL : en passe 1, le fragment i vaut le centre du bloc ;
  // uRes, uScale et uOx restent ceux de l'ecran.
  vec2 fc = uPass == 1 ? gl_FragCoord.xy * uPixN : gl_FragCoord.xy;
  float x = (fc.x - uRes.x * 0.5 - uOx) / uScale;
  float y = (fc.y - uRes.y * 0.5) / uScale;

  // --- inverse de la projection (Newton sur theta)
  float th = asin(clamp(y / YMAX, -1.0, 1.0) * M);
  // Deux pas suffisent : un millionieme de degre d'ecart.
  for(int i = 0; i < 2; i++) th -= (fyf(th) - y) / fypf(th);

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

  // --- couture du meridien : u y saute de 1 a 0. Gradient pris sur deux
  // versions decalees d'un demi-tour, on garde le plus petit, sinon le
  // mipmap s'effondre le long de la couture.
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
  float f = 0.62;
  if((uOff & 1) == 0) f = textureGrad(uField, uv, gx, gy).r;
  float bS = clamp((0.5 - f) * 2.0, 0.0, 1.0) * NSEA;
  float bL = clamp((f - 0.5) * 2.0, 0.0, 1.0) * NLAND;
  float wS = max(fwidth(bS), 1e-4), wL = max(fwidth(bL), 1e-4);
  float qS = (floor(bS) + smoothstep(1.0 - wS, 1.0, fract(bS))) / NSEA;
  float qL = (floor(bL) + smoothstep(1.0 - wL, 1.0, fract(bL))) / NLAND;
  float wC = max(fwidth(f), 1e-5);
  float isLand = smoothstep(0.5 - wC, 0.5 + wC, f);

  // Profondeur d'encre : le papier reste fixe, seul le palier profond
  // bouge. Eclaircir toute la gamme rapprocherait les paliers, et la
  // marche entre eux est toute la lecture du relief.
  vec3 seaInk  = max(SEA_LIGHT  + (SEA_DEEP  - SEA_LIGHT)  * uSea,  vec3(0.0));
  vec3 landInk = max(LAND_LIGHT + (LAND_DEEP - LAND_LIGHT) * uLand, vec3(0.0));
  vec3 sea  = mix(SEA_LIGHT,  seaInk,  qS);
  vec3 land = mix(LAND_LIGHT, landInk, qL);

  vec3 ground = mix(sea, land, isLand);
  float m = texture(uMask, uv).r;

  // ====================================================== LA PORTE
  float field = 0.0;
  vec3  hue   = vec3(1.0);

  float d = radians(uDecl), pl = radians(lat), Hh = radians(lon - uSublon);
  float h = degrees(asin(clamp(sin(pl) * sin(d) + cos(pl) * cos(d) * cos(Hh), -1.0, 1.0)));

  // Seul le soleil ouvre la porte. La fuite ne sert qu'a la chance :
  // pleine au bord de la fenetre, eteinte SPILL_DEG plus loin.
  float S = (h > 0.4 && h < SUN_MAX)
          ? pow(1.0 - h / SUN_MAX, 1.3) * smoothstep(0.0, 6.5, h)
          : 0.0;
  float dOut = max(max(0.4 - h, h - SUN_MAX), 0.0);
  float spill = SPILL_AMP * (1.0 - smoothstep(0.0, SPILL_DEG, dOut));
  float gateC = max(S, spill * uBelief.z);

  if((uOff & 2) != 0){ S = 0.0; gateC = 0.0; }   // tache coupee (admin)
  if(uPass == 2){
    // PIXEL : la tache deja calculee, un bloc par texel ; texelFetch ne
    // filtre pas, d'ou des carres francs.
    vec4 px = texelFetch(uPix, ivec2(gl_FragCoord.xy / uPixN), 0);
    hue = px.rgb;
    field = px.a;
  } else if(S > 0.0 || gateC > 0.002){
    float ccl = cos(pl);
    vec3 sp = vec3(ccl * cos(radians(lon)), ccl * sin(radians(lon)), sin(pl)) * FIELD_FREQ;

    // ---- CHANCE : des poches, multipliees par la flaque autour du
    // pieton. D'ou une fuite en taches isolees, pas en anneau.
    float CHA = 0.0;
    if((uOff & 4) == 0)
      CHA = smoothstep(0.46, 0.76,
              fbm(sp * CHANCE_FREQ + vec3(uDriftC + 41.0, 17.0, 7.0)));
    vec3 dh = g - uHere;
    float lr = radians(mix(LUCK_NEAR, LUCK_FAR, uBelief.z));
    float luck = exp(-dot(dh, dh) / (lr * lr));

    float belief = uBelief.z * CHA * luck * gateC;

    // ---- METEO et LEGENDE n'existent que porte ouverte.
    if(S > 0.0){
      float rain, gap;

      // Grille ou bruit : branche UNIFORME, la branche non prise ne coute rien.
      if((uOff & 8) != 0){
        rain = 0.0; gap = 0.0;
      } else if(uWxOn > 0.5){
        float k0 = floor(uSlot);
        float k1 = min(k0 + 1.0, uWxN - 1.0);
        vec4 w0 = texture(uWx, vec3(uv, k0));
        vec4 w1 = texture(uWx, vec3(uv, k1));
        vec4 w  = mix(w0, w1, uSlot - k0);
        rain = w.r;
        // Meme course que la branche du bruit, mais sans masque littoral :
        // la mer s'allume, il y pleut vraiment.
        gap = 0.14 + 1.66 * w.g;
      } else {
        rain = smoothstep(0.44, 0.70, fbm(sp + vec3(uDrift, 0.0, 0.0)));
        float a = (lat - uDecl * 0.45) / 9.5;
        float b = (abs(lat) - 48.0) / 15.0;
        gap = (0.14 + 0.92 * exp(-a * a) + 0.74 * exp(-b * b)) * m;
      }

      float MET = 1.0 - exp(-rain * (gap / 1.2) * 6.0);
      float LEG = (uOff & 16) == 0 ? legendAt(g) : 0.0;
      belief += S * (uBelief.x * MET + uBelief.y * LEG);
    }

    float t = clamp(belief * GAIN, 0.0, 1.0);

    // LE GRAIN : le bruit de base s'arrete vers 400 km. Ces octaves
    // depolissent la tache sans la deplacer : de la matiere, pas de la
    // donnee, d'ou leur absence dans sky.js.
    if(uDetail > 0.002 && (uOff & 32) == 0){
      float grain = (vnoise(sp *  6.1) - 0.5) * 1.10
                  + (vnoise(sp * 15.7) - 0.5) * 0.60;

      // 47, 19 et 8 km, par uFine seul : au monde entier elles ne
      // feraient qu'un fourmillement sous le pixel.
      if(uFine > 0.002){
        grain += ((vnoise(sp *  38.0) - 0.5) * 0.46
                + (vnoise(sp *  92.0) - 0.5) * 0.30
                + (vnoise(sp * 221.0) - 0.5) * 0.18) * uFine;
      }
      t = clamp(t * (1.0 + uDetail * 0.55 * grain), 0.0, 1.0);
    }

    // La force ne baisse pas au zoom. uTache agit sur la force, pas sur
    // t : la teinte continue de dire la meme chose.
    float fv = clamp(pow(t, 1.15) * 0.98 * uTache, 0.0, 1.0);

    // LE SEUIL, a toute echelle : en dessous, du papier. Ce qui depasse
    // est reetale a partir de 0,30, sinon le bord de la tache serait blanc.
    // fwidth BORNE PAR LE HAUT (piege n. 35) : pris dans une branche non
    // uniforme, la derivee n'est plus garantie ; sur le Pi elle explosait
    // au bord de la porte et tracait des traits roses.
    if(uSeuil > 0.001){
      float w = clamp(fwidth(fv), 1e-4, 0.08);
      float edge = smoothstep(uSeuil - w, uSeuil + w, fv);
      float over = clamp((fv - uSeuil) / max(1.0 - uSeuil, 1e-3), 0.0, 1.0);
      fv = edge * mix(0.30, 1.0, over);
    }

    if(uGrey > 0.5){
      // EN GRIS, la force passe par la densite, en paliers comme le relief.
      float band = floor(fv * BANDS) / BANDS;
      float v = 1.0 - pow(band, 0.85) * 0.50;

      // La trame separe la tache du relief, gris et lisse lui aussi.
      if(bayer8(ivec2(gl_FragCoord.xy)) < clamp((fv - 0.12) / 0.88, 0.0, 1.0))
        v -= 0.20;

      hue = vec3(v);
      field = 1.0;          // la densité REMPLACE la teinte, elle ne s'y ajoute pas
    } else {
      field = fv;

      // Irisation : palette cosinus parcourue uFranges fois, decalee par un
      // bruit lent, comme de l'huile sur l'eau. Le nombre de tours ne
      // suit pas le zoom.
      float k = t * uFranges + vnoise(sp * 0.55) * 0.40 + uDrift * 0.03;
      // PALETTE : phase arrondie a uPal crans par tour, en bandes franches.
      if(uPal > 0.5) k = floor(k * uPal + 0.5) / uPal;
      vec3 c = 0.5 + 0.5 * cos(6.28318 * k + vec3(0.0, 2.0944, 4.1888));
      c = mix(vec3(dot(c, vec3(0.3333))), c, uSat);      // saturation
      // plancher releve : sur papier blanc, une teinte trop basse vire a la boue
      hue = clamp(0.10 + 0.90 * c, 0.0, 1.0);
    }
  }

  // PIXEL : la passe 1 s'arrete ici ; fond et couloir en passe 2.
  if(uPass == 1){ fragColor = vec4(hue, field); return; }

  // Multiplication : sur le papier, les taches teintent au lieu d'eclairer.
  vec3 col = ground * mix(vec3(1.0), hue, field);

  // ====================================================== LES COTES
  // L'iso-ligne 0,5 du relief : distance en pixels = ecart a 0,5 divise
  // par le gradient a l'ecran. Les lacs n'y sont pas.
  if(uCoast > 0.0 && (uOff & 1) == 0){
    float gf = max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
    float cl = clamp(0.5 * uCoast + 0.5 - abs(f - 0.5) / gf, 0.0, 1.0)
             * min(uCoast, 1.0);
    col = mix(col, vec3(0.078, 0.086, 0.102), cl * 0.92);
  }

  // ====================================================== LE COULOIR
  // Deux pointilles, a 0,4 et 42 degres : sans eux, on ne sait pas si
  // l'absence de couleur vient de la pluie ou du soleil. Le trait suit
  // l'iso-hauteur h ; son epaisseur passe par le gradient de h a l'ecran.
  if(uPorte > 0.5){
    vec2 gh = vec2(dFdx(h), dFdy(h));
    float gn = length(gh);
    float lw = max(gn, 1e-4);

    // Pres des poles et sur la couture, le gradient explose : on efface
    // le trait plutot que de mentir sur sa position.
    float sane = 1.0 - smoothstep(2.0, 6.0, lw);

    float tw = lw * 1.6 * uCouloir.y;
    float line = max(1.0 - smoothstep(0.0, tw, abs(h - 0.4)),
                     1.0 - smoothstep(0.0, tw, abs(h - SUN_MAX)));

    // Phase prise LE LONG DE LA COURBE (tangente = gradient tourne d'un
    // quart de tour) et non de l'ecran : une trame d'ecran fait du moire
    // la ou la courbe court dans sa direction.
    vec2 tang = gn > 1e-9 ? vec2(-gh.y, gh.x) / gn : vec2(1.0, 0.0);

    // Tiret plus long de pres, ou les courbes sont droites. uDetail et
    // non uFine : couper la finesse ne doit pas figer le pointille.
    float step_px = mix(12.0, 26.0, clamp(uDetail, 0.0, 1.0)) * uCouloir.x;

    // Une sinusoide et non un creneau : pas de bord franc, pas de moire.
    float s = dot(gl_FragCoord.xy, tang) / step_px;
    float dash = smoothstep(0.18, 0.62, 0.5 + 0.5 * sin(6.28318 * s));

    col = mix(col, vec3(0.42, 0.45, 0.50), line * dash * sane * 0.85);
  }

  fragColor = vec4(mix(vec3(1.0), col, cov), 1.0);
}`;
