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

import { view, scale, drift, detail } from './view.js';
import { VERTEX, FRAGMENT } from './shader.js';

let gl = null;
const U = {};

const UNIFORMS = ['uRes', 'uScale', 'uMode', 'uRot', 'uDecl', 'uSublon',
                  'uDrift', 'uDetail', 'uEarth', 'uField', 'uMask'];

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
export function initMap(canvas, onReady) {
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return false;

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
  gl.uniform1i(U.uEarth, 0);
  gl.uniform1i(U.uField, 1);
  gl.uniform1i(U.uMask, 2);

  placeholder(0); placeholder(1); placeholder(2);

  const load = (src, unit, mip) => {
    const img = new Image();
    img.onload = () => {
      try { upload(unit, img, mip); } catch (err) { /* on garde le blanc */ }
      onReady();
    };
    img.onerror = onReady;
    img.src = src;
  };
  load('data/field.png', 1, true);
  load('data/mask.png', 2, false);
  load('data/earth.jpg', 0, true);

  return true;
}

export function paint(canvas, sun) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.uRes, canvas.width, canvas.height);
  gl.uniform1f(U.uScale, scale() * view.dpr);
  gl.uniform1f(U.uMode, view.mode);
  gl.uniformMatrix3fv(U.uRot, false, view.R);
  gl.uniform1f(U.uDecl, sun.decl);
  gl.uniform1f(U.uSublon, sun.sublon);
  gl.uniform1f(U.uDrift, drift());
  gl.uniform1f(U.uDetail, detail());
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
