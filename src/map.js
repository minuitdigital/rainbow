// =========================================================================
//  LA CARTE PEINTE
//
//  Le contexte WebGL, les trois textures, et une image. C'est toute la
//  plomberie du projet, tenue dans un seul fichier pour que le shader
//  d'à côté reste lisible comme un texte.
//
//  Un seul triangle couvre l'écran : pas de maillage, pas de géométrie,
//  pas de bibliothèque. Toute la carte est un calcul par pixel.
// =========================================================================

import { view, scale, drift, driftChance, detail, fine, holes,
         beliefWeights, centreVec } from './view.js';
import { VERTEX, FRAGMENT, MAX_LEGENDS } from './shader.js';
import { LEGEND_POINTS } from './sky.js';
import { weatherPixels } from './weather.js';

let gl = null;
const U = {};

// ====================================================== LE CHRONOMÈTRE GPU
//  `performance.now()` autour de `drawArrays` ne mesure RIEN : l'appel rend
//  la main aussitôt, la carte graphique travaille encore après. Le seul
//  chiffre honnête vient du pilote lui-même, par une requête posée autour
//  du tracé et relue quelques images plus tard.
//
//  L'extension n'est pas toujours là — retirée des navigateurs pendant des
//  années pour cause de fuite d'information par le temps, puis rendue en
//  WebGL 2. Absente, on rend `null` et le panneau écrit un tiret plutôt
//  qu'un chiffre inventé.
//
//  UNE SEULE REQUÊTE EN VOL. Une par image saturerait le pilote et
//  fausserait précisément ce qu'on cherche à mesurer ; on en pose une, on
//  attend qu'elle revienne, on en repose une. À soixante images par seconde
//  on en relève encore plus de dix — largement assez pour une moyenne.
let timerExt = null, timerQuery = null, timerBusy = false, gpuLast = null;

/** Le dernier temps de shader mesuré, en millisecondes. Null si inconnu. */
export const gpuMs = () => gpuLast;

function timerStart() {
  if (!timerExt || timerBusy) return false;
  if (!timerQuery) timerQuery = gl.createQuery();
  gl.beginQuery(timerExt.TIME_ELAPSED_EXT, timerQuery);
  return true;
}

/**
 * La requête posée deux images plus tôt est-elle revenue ? On ne bloque
 * JAMAIS en attendant : `QUERY_RESULT_AVAILABLE` est une lecture non
 * bloquante, et tant qu'elle dit non on garde l'ancienne valeur. Lire le
 * résultat de force ici viderait le tuyau graphique à chaque image et
 * coûterait plus cher que ce qu'on mesure.
 *
 * `GPU_DISJOINT_EXT` signale que le pilote a été interrompu pendant la
 * mesure — changement de fréquence, préemption par une autre fenêtre. Le
 * chiffre est alors faux, et il se jette.
 */
function timerRead() {
  if (!timerBusy || !timerQuery) return;
  if (!gl.getQueryParameter(timerQuery, gl.QUERY_RESULT_AVAILABLE)) return;
  if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) {
    const ms = gl.getQueryParameter(timerQuery, gl.QUERY_RESULT) / 1e6;
    gpuLast = gpuLast == null ? ms : gpuLast + (ms - gpuLast) * 0.12;
  }
  timerBusy = false;
}

const UNIFORMS = ['uRes', 'uScale', 'uRot', 'uDecl', 'uSublon',
                  'uDrift', 'uDriftC', 'uDetail', 'uFine', 'uHoles', 'uFranges',
                  'uBelief', 'uHere',
                  'uSat', 'uTache', 'uGrey', 'uSea', 'uLand',
                  'uLegN', 'uLegP', 'uLegQ', 'uField', 'uMask',
                  'uWx', 'uWxOn', 'uSlot', 'uWxN'];

/**
 * Les textures arrivent quand elles arrivent. On lie donc des textures
 * BLANCHES de 1×1 dès le départ : sans elles, le canvas reste noir tant
 * que la plus grosse image n'est pas décodée. Et surtout, on ne
 * conditionne jamais le tracé à un compteur de chargement — la petite
 * texture arrive toujours avant la grosse.
 */
function placeholder(unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
                new Uint8Array([255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function upload(unit, img, mip) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // Certaines cartes plafonnent en deçà de 8192 : on réduit plutôt que
  // d'échouer, la carte sera un peu plus molle mais elle existera.
  let src = img;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (img.width > max) {
    const c = document.createElement('canvas');
    c.width = max;
    c.height = Math.round(img.height * max / img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    src = c;
  }

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mip) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
}

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src.replace(/^\s+/, ''));
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

/**
 * Rend false si WebGL 2 manque — la page affiche alors son repli.
 * onReady est appelé chaque fois qu'une texture finit d'arriver.
 */
export function initMap(canvas, onReady, note = () => {}) {
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return false;

  // Facultative, et c'est très bien ainsi : le tableau doit marcher sans.
  timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  for (const n of UNIFORMS) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uField, 1);
  gl.uniform1i(U.uMask, 2);
  gl.uniform1i(U.uWx, 3);

  // L'unite 0 n'est plus utilisee depuis le retrait de earth.jpg.
  placeholder(1); placeholder(2);
  emptyWeather();
  uploadLegends();

  // ON PASSE PAR fetch ET NON PAR img.src DIRECTEMENT, pour une seule
  // raison : une balise image ne dit pas où elle en est. Huit mégaoctets
  // de relief arrivent en silence, et sur une connexion lente la page
  // reste blanche sans que rien n'explique pourquoi.
  //
  // Mais on REDONNE les octets à une vraie balise image par un blob : le
  // versement WebGL se comporte alors exactement comme avant, avec le même
  // UNPACK_FLIP_Y. Passer par createImageBitmap aurait été plus direct et
  // aurait changé l'orientation sur certains pilotes — c'est-à-dire la
  // carte à l'envers, pour un compteur de progression.
  const load = async (src, unit, mip, nom) => {
    let url = null;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(src + ' : ' + res.status);

      // Sans content-length (compression au vol, serveur bavard), on
      // compte quand même les octets reçus : le total reste inconnu, et
      // l'affichage se contente de dire ce qui est arrivé.
      const total = +res.headers.get('content-length') || 0;
      const chunks = [];
      let got = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        note(nom, { got, total });
      }

      url = URL.createObjectURL(new Blob(chunks));
      await new Promise((ok, ko) => {
        const img = new Image();
        img.onload = () => {
          try { upload(unit, img, mip); } catch (e) { /* on garde le blanc */ }
          ok();
        };
        img.onerror = ko;
        img.src = url;
      });
      // Arrivee, et versee. La ligne s'efface.
      note(nom, null);
    } catch (e) {
      // Une texture manquante n'arrete rien : le blanc 1x1 tient la place
      // (piege n°2), et la carte existe quand meme. Mais elle n'est plus
      // la meme carte — sans le relief, plus d'aplats d'altitude — et
      // c'est exactement ce que la ligne rouge doit dire.
      console.warn('%s n a pas pu etre charge (%s)', src, e.message);
      note(nom, { err: 'introuvable' });
    } finally {
      if (url) URL.revokeObjectURL(url);
      onReady();
    }
  };
  load('data/field.png', 1, true, 'relief');
  load('data/mask.png', 2, false, 'masque');

  return true;
}

// ================================================== LA GRILLE MÉTÉO
//  Une texture EN COUCHES : un pas de temps par couche. Le fichier est un
//  atlas vertical, donc chaque couche y est déjà contiguë — on verse le
//  tableau d'un seul bloc, sans découper ni recopier quoi que ce soit.
//  C'est la raison d'être de ce format, et elle ne se voit qu'ici.

let wxTex = null, wxLayers = 0;

/** Le nombre de pas de temps versés. Le shader en a besoin pour borner. */
export const weatherLayers = () => wxLayers;

function bindWeather() {
  gl.activeTexture(gl.TEXTURE0 + 3);
  if (!wxTex) wxTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, wxTex);
}

/**
 * Une couche blanche de 1×1 dès le départ. Un sampler2DArray laissé sans
 * texture rend un résultat indéfini — sur certains pilotes du noir, sur
 * d'autres un plantage de compilation au premier tracé. Même précaution
 * que le piège n°2, pour la même raison.
 */
function emptyWeather() {
  bindWeather();
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * Appelé quand la grille arrive, et à chaque relevé suivant. Rend false
 * si la carte graphique ne veut pas d'autant de couches — la page retombe
 * alors sur son bruit, ce qui est laid mais vivant.
 */
export function uploadWeather() {
  const w = weatherPixels();
  if (!w || !gl) return false;

  const max = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  if (w.nt > max) {
    console.warn('météo : %d couches demandées, %d disponibles', w.nt, max);
    return false;
  }

  bindWeather();
  // Pas de retournement : le fichier est déjà rangé sud en premier, et le
  // shader lit v = (lat + 90) / 180. UNPACK_FLIP_Y ne s'applique de toute
  // façon pas à un versement depuis un tableau d'octets.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w.nx, w.ny, w.nt, 0,
                gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array(w.px.buffer, w.px.byteOffset, w.px.length));

  // LA LONGITUDE S'ENROULE, la latitude non : sans REPEAT en S, une bande
  // d'un demi-degré à l'antiméridien irait chercher la couleur du bord au
  // lieu de celle d'en face. Aucun mipmap — la grille est déjà bien plus
  // grossière que l'écran, en fabriquer des versions plus floues n'aurait
  // aucun sens.
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  wxLayers = w.nt;
  return true;
}

/**
 * Les hauts lieux de la croyance ne bougent jamais : on les verse une
 * fois pour toutes. Quarante-huit places réservées dans le shader — s'il
 * en faut davantage, changer MAX_LEGENDS dans shader.js.
 */
function uploadLegends() {
  const n = Math.min(LEGEND_POINTS.length, MAX_LEGENDS);
  const pos = new Float32Array(MAX_LEGENDS * 4);
  const rad = new Float32Array(MAX_LEGENDS);
  for (let i = 0; i < n; i++) {
    const l = LEGEND_POINTS[i];
    pos[i*4] = l.v[0]; pos[i*4+1] = l.v[1]; pos[i*4+2] = l.v[2];
    pos[i*4+3] = l.f;
    rad[i] = l.q;
  }
  gl.uniform1i(U.uLegN, n);
  gl.uniform4fv(U.uLegP, pos);
  gl.uniform1fv(U.uLegQ, rad);
  if (LEGEND_POINTS.length > MAX_LEGENDS)
    console.warn('légendes : %d au-delà de la place réservée, ignorées',
                 LEGEND_POINTS.length - MAX_LEGENDS);
}

export function paint(canvas, sun, slot) {
  // On relève AVANT de poser la suivante : la requête lue ici est celle
  // d'une image précédente, déjà digérée par le pilote.
  timerRead();
  const timed = timerStart();

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.uRes, canvas.width, canvas.height);
  gl.uniform1f(U.uScale, scale() * view.dpr);
  gl.uniformMatrix3fv(U.uRot, false, view.R);
  gl.uniform1f(U.uDecl, sun.decl);
  gl.uniform1f(U.uSublon, sun.sublon);
  gl.uniform1f(U.uDrift, drift());
  gl.uniform1f(U.uDriftC, driftChance());
  gl.uniform1f(U.uDetail, detail());
  gl.uniform1f(U.uFine, fine());
  gl.uniform1f(U.uHoles, holes());
  gl.uniform1f(U.uFranges, view.look.franges);
  const w = beliefWeights();
  gl.uniform3f(U.uBelief, w.m, w.l, w.c);
  // Où se tient le piéton : le centre de la flaque de chance. C'est la
  // première ligne de la rotation, donc le centre exact de l'écran.
  const p = centreVec();
  gl.uniform3f(U.uHere, p[0], p[1], p[2]);
  gl.uniform1f(U.uSat, view.look.sat);
  gl.uniform1f(U.uTache, view.look.tache);
  gl.uniform1f(U.uGrey, view.look.grey);
  gl.uniform1f(U.uSea, view.look.sea);
  gl.uniform1f(U.uLand, view.look.land);

  // La grille n'est en service que si elle est arrivée ET versée. Un slot
  // nul veut dire « mode dev » : le shader reprend son bruit fractal.
  const wxOk = slot != null && wxLayers > 0;
  gl.uniform1f(U.uWxOn, wxOk ? 1 : 0);
  gl.uniform1f(U.uSlot, wxOk ? slot : 0);
  gl.uniform1f(U.uWxN, wxLayers || 1);

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (timed) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); timerBusy = true; }
}
