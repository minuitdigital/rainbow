# Estimateur d'arcs-en-ciel

Carte mondiale en projection **Equal Earth**, fond noir et blanc, sans frontières —
seulement le relief, les côtes et la mer. Des taches spectrales marquent les zones
où un arc-en-ciel est géométriquement possible et météorologiquement plausible.

## Tester en local

Un double-clic sur `index.html` ne marche pas : en `file://` le navigateur
refuse de charger une image dans une texture WebGL. Il faut un serveur :

```bash
cd estimateur-arcs-en-ciel
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000`.

## Mettre en ligne (GitHub Pages)

```bash
git init
git add .
git commit -m "Estimateur d'arcs-en-ciel"
git branch -M main
git remote add origin git@github.com:<compte>/<depot>.git
git push -u origin main
```

Puis dans le dépôt : **Settings → Pages → Source : Deploy from a branch → `main` / `/ (root)`**.
La page est servie sur `https://<compte>.github.io/<depot>/` en une minute environ.
Aucune dépendance, aucun build : quatre fichiers statiques. WebGL 2 requis.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | toute la page : shader, projection, navigation, estimation |
| `earth.jpg` | relief gris en plate carrée, 8192 × 4096 — texture source |
| `mask.png` | coefficient de surface (mer / littoral / intérieur), 720 × 360 |
| `coast.js` | traits de côte et lacs (Natural Earth 1:50 m, ~55 000 points) |

## Comment la carte est dessinée

Rien n'est déplacé : à chaque image, **le processeur graphique reprojette la
carte pixel par pixel**. Pour chaque pixel de l'écran il remonte aux
coordonnées Equal Earth, inverse la projection par la méthode de Newton,
obtient une latitude et une longitude, et va chercher la valeur dans la
texture en plate carrée. Le champ spectral est calculé dans le même passage.

Deux conséquences :

- **Le zoom précise au lieu de flouter.** On rééchantillonne la source
  8192 × 4096 à chaque échelle, on n'agrandit jamais une image déjà rendue.
- **Il n'y a de butée nulle part.** La navigation n'est pas une translation
  mais une vraie rotation de sphère sur deux axes. La silhouette de la
  projection reste fixe ; la Terre tourne derrière elle. On peut filer vers
  l'ouest indéfiniment, et vers le nord jusqu'à passer par-dessus le pôle
  et redescendre de l'autre côté — la carte se retourne alors, comme sur
  un globe. Aux latitudes obliques on obtient une Equal Earth inclinée.

Les traits de côte restent vectoriels, dessinés sur un canvas 2D par-dessus :
ils sont nets à toutes les échelles.

## Navigation

| Entrée | Effet |
|---|---|
| glisser / flèches | déplacer la carte (avec inertie) |
| molette / pincement | zoom continu vers le curseur |
| double-clic | zoom ×2 (maj : ×0,5) |
| `+` `−` | zoom |
| `0` | recentrer |
| `f` | plein écran |

Les flèches existent pour préparer le mini-joystick : le réticule central est le
curseur, la carte se déplace sous lui.

## État de l'algorithme

Trois facteurs entrent dans l'indice affiché :

1. **Géométrie solaire — réelle.** Hauteur du soleil calculée pour chaque point.
   En dessous de l'horizon ou au-dessus de **42°**, aucun arc n'est possible : le
   centre de l'arc, à l'opposé du soleil, passe sous l'horizon.
2. **Pluie — simulée.** Bruit fractal cohérent sur la sphère, dérivant lentement.
   À remplacer par les précipitations horaires d'Open-Meteo.
3. **Trouée — approximée.** Climatologie grossière (ZCIT, rails dépressionnaires,
   littoraux). À remplacer par le rayonnement direct et la couverture nuageuse.

La bande où la géométrie est favorable forme un anneau qui fait deux fois le tour
de la Terre chaque jour, à l'aube et au crépuscule. C'est l'intersection de cet
anneau avec la pluie qui produit les taches.

## Régénérer les données

Les scripts de `build/` reconstruisent `earth.jpg`, `mask.png` et `coast.js`
à partir du relief ombré Natural Earth et des vecteurs `ne_50m_*`.

```bash
pip install pyproj numpy pillow
python3 build/make_texture.py   # earth.jpg + mask.png
python3 build/make_coast.py     # coast.js
```

## Sources

Relief et vecteurs : Natural Earth (domaine public).
Projection : Equal Earth, Šavrič, Patterson & Jenny (2018).
