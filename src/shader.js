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

// LES TABLEAUX DE TEXTURES N'ONT PAS DE PRECISION PAR DEFAUT. En GLSL ES
// 3.00, la ligne ci-dessus couvre les flottants, et sampler2D s'en tire
// avec une precision implicite — mais sampler2DArray, sampler3D et leurs
// variantes entieres exigent la leur, explicitement. Sans cette ligne le
// shader ne compile pas, initMap leve, et le canvas reste NOIR sans un
// mot : l'ecran noir de septembre 2026, une demi-heure de recherche.
precision highp sampler2DArray;

uniform vec2  uRes;
uniform float uScale;
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
uniform vec4  uLegP[${MAX_LEGENDS}];   // xyz = vecteur unitaire, w = force
uniform float uLegQ[${MAX_LEGENDS}];   // rayon au carré, en cordes
uniform sampler2D uField, uMask;

// LA VRAIE METEO, en couches : un pas de temps par couche, trente-deux
// pas de trois heures. Un sampler2DArray plutot qu'un damier dans une
// seule image, parce qu'un damier fait baver les tuiles l'une dans
// l'autre au filtrage bilineaire et qu'il faudrait border chaque case.
//
//      R   la pluie DU VOISINAGE, dilatee d'une case par le script
//      G   la clarte directe : des rayons non interceptes arrivent-ils ici
//      B   la pluie locale — les etiquettes s'en servent, pas le shader
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

// Les deux gammes des aplats : le papier, et l'encre du palier le plus
// profond. uSea et uLand disent de combien on charge cette encre : 1,0
// est le tirage d'origine. (Pas d'accent grave dans ce fichier — tout le
// GLSL vit dans un gabarit de chaîne, et le premier le refermerait.)
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

  // LE LUSTRE A ETE RETIRE, et avec lui data/earth.jpg — 3,9 Mo sur 13,
  // une texture de 8192 pixels en memoire et une lecture de plus par
  // pixel, pour creuser les versants de quatorze pour cent. La carte
  // assume ses aplats : des bords calcules, nets a toute echelle, et rien
  // d'imprime par-dessus. La touche « r » qui fondait vers le relief
  // ombre s'en va par la meme occasion.

  // LA PROFONDEUR D'ENCRE. Le papier ne bouge pas — c'est le palier le
  // plus profond qui monte ou descend, comme on charge une plaque. À 1,0
  // on retrouve exactement la carte d'origine ; à 0 il ne reste que le
  // papier, et les paliers s'effacent sans se déplacer.
  //
  // Pourquoi ne pas simplement éclaircir tout l'aplat : parce que tirer
  // toute la gamme vers le blanc rapproche les paliers les uns des
  // autres, et la marche entre deux altitudes — qui est TOUTE la lecture
  // du relief ici — se perd. En tenant le papier fixe, l'écart entre
  // deux paliers reste proportionnel à l'encre, donc lisible.
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

  // Le soleil ouvre la fenêtre, et rien d'autre ne peut l'ouvrir — pour
  // ce qui a une raison. La fuite, elle, ne sert qu'à la chance : pleine
  // au bord de la fenêtre, éteinte SPILL_DEG plus loin.
  float S = (h > 0.4 && h < SUN_MAX)
          ? pow(1.0 - h / SUN_MAX, 1.3) * smoothstep(0.0, 6.5, h)
          : 0.0;
  float dOut = max(max(0.4 - h, h - SUN_MAX), 0.0);
  float spill = SPILL_AMP * (1.0 - smoothstep(0.0, SPILL_DEG, dOut));
  float gateC = max(S, spill * uBelief.z);

  if(S > 0.0 || gateC > 0.002){
    float ccl = cos(pl);
    vec3 sp = vec3(ccl * cos(radians(lon)), ccl * sin(radians(lon)), sin(pl)) * FIELD_FREQ;

    // ---- CHANCE : plus lente, plus large, et sans rapport avec la météo.
    // Seuillée serré : ce ne sont pas des voiles mais des poches. Puis
    // multipliée par LA FLAQUE — ce que le piéton porte. Loin de lui elle
    // ne vaut rien, et c'est pour ça que la fuite ne fait pas un anneau
    // plus gras mais des taches isolées, autour de nous.
    float CHA = smoothstep(0.46, 0.76,
                  fbm(sp * CHANCE_FREQ + vec3(uDriftC + 41.0, 17.0, 7.0)));
    vec3 dh = g - uHere;
    float lr = radians(mix(LUCK_NEAR, LUCK_FAR, uBelief.z));
    float luck = exp(-dot(dh, dh) / (lr * lr));

    float belief = uBelief.z * CHA * luck * gateC;

    // ---- MÉTÉO et LÉGENDE n'existent que porte ouverte. Ce qui est vrai
    // et ce qu'on raconte ont toujours besoin du soleil.
    if(S > 0.0){
      float rain, gap;

      // DEUX SOURCES POUR LA MEME CHOSE. La branche est UNIFORME : tous
      // les pixels prennent le meme chemin, le processeur graphique ne
      // diverge pas, et la branche non prise ne coute rien.
      //
      // Et il se trouve que la vraie meteo est la MOINS chere des deux :
      // deux lectures de texture au lieu de vingt-quatre hachages. Brancher
      // Open-Meteo accelere la carte, ce qui n'allait pas de soi.
      if(uWxOn > 0.5){
        float k0 = floor(uSlot);
        float k1 = min(k0 + 1.0, uWxN - 1.0);
        vec4 w0 = texture(uWx, vec3(uv, k0));
        vec4 w1 = texture(uWx, vec3(uv, k1));
        vec4 w  = mix(w0, w1, uSlot - k0);
        rain = w.r;
        // La clarte mesuree, remise sur la course de l'ancienne formule :
        // meme plancher, meme amplitude. Le masque littoral DISPARAIT ici
        // — il servait a rattraper une climatologie inventee, et il n'y a
        // plus rien a rattraper. La mer s'allume donc pour de bon : il y
        // pleut vraiment, et les etiquettes disent deja qu'il n'y a
        // personne pour voir.
        gap = 0.14 + 1.66 * w.g;
      } else {
        rain = smoothstep(0.44, 0.70, fbm(sp + vec3(uDrift, 0.0, 0.0)));
        float a = (lat - uDecl * 0.45) / 9.5;
        float b = (abs(lat) - 48.0) / 15.0;
        gap = (0.14 + 0.92 * exp(-a * a) + 0.74 * exp(-b * b)) * m;
      }

      float MET = 1.0 - exp(-rain * (gap / 1.2) * 6.0);
      float LEG = legendAt(g);
      belief += S * (uBelief.x * MET + uBelief.y * LEG);
    }

    float t = clamp(belief * GAIN, 0.0, 1.0);

    // LE GRAIN. Le bruit de base n'a rien de plus fin que ~400 km : passé
    // x10 on regardait un aplat uniforme, et s'approcher ne montrait rien.
    // Deux octaves fines entrent progressivement. Elles ne DÉPLACENT pas la
    // tache — elles la dépolissent : la structure, donc l'indice lu, reste
    // celle du champ. C'est de la matière, pas de la donnée.
    if(uDetail > 0.002){
      float grain = (vnoise(sp *  6.1) - 0.5) * 1.10
                  + (vnoise(sp * 15.7) - 0.5) * 0.60;

      // LES OCTAVES PROFONDES. Les deux du dessus valent 290 et 113 km :
      // à x32 l'écran fait 1 250 km de large, elles y sont encore des
      // masses. Trois octaves de plus — 47, 19 et 8 km — pour que
      // s'approcher continue de RÉVÉLER au lieu d'agrandir.
      //
      // Elles n'entrent qu'au-delà de x6, et par uFine seul : au monde
      // entier elles ne feraient qu'un fourmillement sous le pixel, et
      // elles mentiraient sur la lecture d'ensemble.
      if(uFine > 0.002){
        grain += ((vnoise(sp *  38.0) - 0.5) * 0.46
                + (vnoise(sp *  92.0) - 0.5) * 0.30
                + (vnoise(sp * 221.0) - 0.5) * 0.18) * uFine;
      }
      t = clamp(t * (1.0 + uDetail * 0.55 * grain), 0.0, 1.0);
    }

    // Elle NE S'EFFACE PLUS en s'approchant. Le facteur 0,40 qui tenait
    // ici partait d'un constat juste — de près la couleur noyait le
    // relief — mais il traitait le symptôme : ce qui saturait l'écran,
    // c'était un aplat de couleur agrandi, pas la couleur elle-même. Ce
    // sont les octaves profondes qui règlent ça, en donnant à la tache
    // une structure à regarder. La force, elle, reste celle du monde
    // entier : zoomer précise, ça ne doit rien retirer.
    //
    // uTache n'entre QUE là : c'est un gain sur la force de la tache, pas
    // sur la valeur t. La teinte, elle, continue de dire la même chose.
    float fv = clamp(pow(t, 1.15) * 0.98 * uTache, 0.0, 1.0);

    // LE SEUIL. Sous cette presence, du papier — rien du tout.
    //
    // La premiere version montait ce seuil AVEC LE ZOOM et ne coupait
    // qu'a 36 % au mieux : elle ne faisait rien avant x6, et pas grand
    // chose apres. Le defaut qu'elle visait est pourtant reel, et il est
    // pire de pres : un pays entier sous une nappe de couleur, ou le
    // regard n'a aucun bord a saisir.
    //
    // Le seuil vaut donc maintenant A TOUTE ECHELLE, et il est franc.
    //
    // ET LA GAMME QUI RESTE EST REETALEE. C'est le second temps, et il
    // compte autant : garder les valeurs telles quelles ne laisserait
    // qu'une plage etroite entre le seuil et un, donc des taches toutes
    // pareilles. On etire ce qui depasse sur toute la course de la
    // couleur — mais en partant de 0,30 et non de zero, sans quoi le bord
    // de la tache serait blanc et l'on ne verrait plus sa forme.
    //
    // Le bord est calcule par les derivees d'ecran : net a toute echelle,
    // jamais crenele. Meme methode que les paliers du relief.
    if(uSeuil > 0.001){
      float w = max(fwidth(fv), 1e-4);
      float edge = smoothstep(uSeuil - w, uSeuil + w, fv);
      float over = clamp((fv - uSeuil) / max(1.0 - uSeuil, 1e-3), 0.0, 1.0);
      fv = edge * mix(0.30, 1.0, over);
    }

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
      //
      // LE NOMBRE DE TOURS EST UN RÉGLAGE, et il ne monte plus avec le
      // zoom. Je l'avais lié à la finesse : plus on s'approchait, plus la
      // palette bouclait — bleu, vert, jaune, orange, rose, puis cyan et
      // ça recommence. Un arc-en-ciel de trop par-dessus le sujet. La
      // complexité de près doit venir des TROUS, qui donnent une forme à
      // lire ; la teinte, elle, gagne à tourner moins.
      float k = t * uFranges + vnoise(sp * 0.55) * 0.40 + uDrift * 0.03;
      vec3 c = 0.5 + 0.5 * cos(6.28318 * k + vec3(0.0, 2.0944, 4.1888));
      c = mix(vec3(dot(c, vec3(0.3333))), c, uSat);      // saturation
      // plancher relevé : sur papier blanc, une teinte trop basse vire à la boue
      hue = clamp(0.10 + 0.90 * c, 0.0, 1.0);
    }
  }

  // Multiplication : sur le papier, les taches teintent au lieu d'éclairer.
  // Si le fond redevenait sombre, il faudrait repasser en additif.
  vec3 col = ground * mix(vec3(1.0), hue, field);

  // ====================================================== LE COULOIR
  // DEUX POINTILLES, et la fenetre du soleil entre eux : 0 degre d'un
  // cote, 42 de l'autre. Sans ce trace, on ne sait pas si l'absence de
  // couleur quelque part vient d'un manque de pluie ou d'un soleil trop
  // haut — et c'est toute la difference entre une carte qui se lit et une
  // carte qu'on croit sur parole.
  //
  // Le trait suit l'ISO-HAUTEUR : la meme grandeur h que la porte, donc
  // rigoureusement au bon endroit. Sa largeur passe par le GRADIENT DE h
  // A L'ECRAN — combien de degres de hauteur par pixel — ce qui lui donne
  // une epaisseur constante a toute echelle, et nette.
  if(uPorte > 0.5){
    vec2 gh = vec2(dFdx(h), dFdy(h));
    float gn = length(gh);
    float lw = max(gn, 1e-4);

    // La ou la hauteur bascule d'un coup — pres des poles, et sur la
    // couture de la carte — le gradient explose et le trait deviendrait
    // une nappe. On l'efface plutot que de mentir sur sa position.
    float sane = 1.0 - smoothstep(2.0, 6.0, lw);

    // L'EPAISSEUR EST UN REGLAGE. Un trait de 1,6 pixel se lit sur un
    // ecran d'atelier ; sur le tramage de l'e-ink il disparaitra, et il
    // faudra pouvoir le charger sans toucher au code.
    float tw = lw * 1.6 * uCouloir.y;
    float line = max(1.0 - smoothstep(0.0, tw, abs(h - 0.4)),
                     1.0 - smoothstep(0.0, tw, abs(h - SUN_MAX)));

    // ---- LE POINTILLE, ET POURQUOI IL SUIT LA COURBE
    //
    // La premiere version decoupait le trait avec une trame diagonale de
    // l'ecran : fract((x + y) * k). Elle a un defaut fatal et invisible
    // tant qu'on ne tourne pas le globe — la ou la courbe court ELLE AUSSI
    // en diagonale, la phase de la trame ne change plus le long du trait.
    // Des portions entieres du couloir passaient alors tout allumees ou
    // tout eteintes, et entre les deux naissaient les longues franges
    // qu'on appelle un moire.
    //
    // La phase se prend donc LE LONG DE LA COURBE et non de l'ecran. Le
    // gradient de h pointe perpendiculairement a l'iso-hauteur ; sa
    // perpendiculaire est donc la tangente au trait. En projetant le pixel
    // sur cette tangente, on obtient une abscisse curviligne : elle avance
    // toujours quand on suit le trait, jamais quand on le traverse. Plus
    // aucune orientation n'est privilegiee, et le moire n'a plus de quoi
    // se former.
    vec2 tang = gn > 1e-9 ? vec2(-gh.y, gh.x) / gn : vec2(1.0, 0.0);

    // LA LONGUEUR DU TIRET SUIT LE ZOOM. Au monde entier, les deux courbes
    // sont serrees et tres incurvees : un tiret court les epouse. De pres
    // elles sont presque droites, et le meme tiret court devient un
    // gresillement — on l'allonge.
    //
    // uDetail et non uFine : uDetail est la rampe du zoom toute seule,
    // quand uFine est cette rampe MULTIPLIEE par le curseur « finesse ».
    // Couper la finesse aurait fige le pointille au monde entier, et
    // personne n'aurait fait le rapprochement.
    // Et l'ECART est un reglage aussi : uCouloir.x multiplie la course
    // entiere, zoom compris. Un pointille trop serre fait un trait plein.
    float step_px = mix(12.0, 26.0, clamp(uDetail, 0.0, 1.0)) * uCouloir.x;

    // UNE SINUSOIDE PLUTOT QU'UN CRENEAU. Un step() sur un fract() a des
    // bords francs a l'echelle du pixel : c'est la seconde source de
    // moire, et celle-la se voit meme sur un trait bien oriente. La
    // sinusoide n'a aucun bord — le point s'ouvre et se ferme en douceur,
    // et le rendu reste propre a n'importe quelle densite d'ecran.
    float s = dot(gl_FragCoord.xy, tang) / step_px;
    float dash = smoothstep(0.18, 0.62, 0.5 + 0.5 * sin(6.28318 * s));

    col = mix(col, vec3(0.42, 0.45, 0.50), line * dash * sane * 0.85);
  }

  fragColor = vec4(mix(vec3(1.0), col, cov), 1.0);
}`;
