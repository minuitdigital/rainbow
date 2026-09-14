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
| `field.png` | champ hypsométrique, 8192 × 4096 — 0 fosses, 0.5 côte, 1 sommets |
| `earth.jpg` | relief ombré, 8192 × 4096 — seconde lecture, touche `r` |
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
- **Il n'y a de butée nulle part.** La navigation est une rotation libre de
  la sphère, façon boule de commande : le point saisi reste exactement sous
  le doigt, partout, y compris aux pôles. Aucune singularité, aucune limite.
  Le nord ne reste pas en haut — c'est le comportement d'un globe.
- **Les aplats sont nets à n'importe quelle échelle.** Les paliers ne sont pas
  stockés, ils sont découpés par le shader dans un champ continu, et leurs
  bords sont anticrénelés par les dérivées d'écran. Pas d'escalier de pixels.
- **Le cadrage couvre toujours l'écran.** Le zoom minimum remplit la fenêtre ;
  la silhouette de la projection reste hors champ.

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
| curseur bas | vitesse du temps simulé (0 = figé, jusqu'à ×100 000) |
| `r` | aplats ↔ relief ombré |
| `f` | plein écran |

Les flèches existent pour préparer le mini-joystick : le réticule central est le
curseur, la carte se déplace sous lui.

## État de l'algorithme

Trois facteurs entrent dans l'indice affiché :

1. **Géométrie solaire — réelle.** Hauteur du soleil calculée pour chaque point.
   En dessous de l'horizon ou au-dessus de **42°**, aucun arc n'est possible : le
   centre de l'arc, à l'opposé du soleil, passe sous l'horizon.
2. **Pluie — simulée.** Bruit fractal cohérent sur la sphère, dérivant avec le
   temps simulé. À remplacer par les précipitations horaires d'Open-Meteo.
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
python3 build/make_field.py     # field.png
python3 build/make_coast.py     # coast.js
```

## Sources

Relief et vecteurs : Natural Earth (domaine public).
Projection : Equal Earth, Šavrič, Patterson & Jenny (2018).

## Les paliers

Terre et mer viennent d'**ETOPO 2022** (60 arc-secondes, surface de la glace),
sous-échantillonné à 2 km de maille. Huit paliers sur terre, sept en mer :

```
terre  0   100   300   700  1200  2000  3000  4200  5600 m
mer    0  -200 -1000 -2500 -3500 -4500 -5500 -7000 m
```

Les seuils sont **cuits dans la texture** : `make_field.py` stocke déjà la
fraction de palier, si bien que le découpage uniforme du shader tombe pile sur
ces altitudes. Pour changer la hypsométrie, on modifie les deux listes en tête
de `make_field.py` et on régénère — le shader n'a pas à savoir.

Le trait de côte ne vient pas du signe de l'altitude mais de Natural Earth :
les polders restent des terres, la Caspienne reste une eau, et la valeur 0,5
suit exactement le trait vectoriel dessiné par-dessus.

Le fichier source ETOPO (444 Mo) n'est pas dans ce dossier — il ne sert qu'à
la génération. On le récupère sur le site du NCEI (NOAA) :
`ETOPO_2022_v1_60s_N90W180_surface.tif`.

## Le temps simulé

Le curseur du bas accélère l'horloge. Le soleil tourne pour de vrai — déclinaison
et point subsolaire recalculés — et le champ de pluie dérive avec lui. À ×3 600,
une seconde vaut une heure : on voit l'anneau crépusculaire faire le tour du
globe en vingt secondes. À 0, tout se fige.

**Attention à la précision.** Le décalage du bruit doit rester petit. Une version
antérieure y injectait `Date.now()` converti en heures, soit ~45 000 : en float32
il ne restait que deux décimales, le bruit se cassait en blocs et le champ était
tranché par de longues droites verticales. Le décalage est maintenant relatif au
démarrage et borné à 512.

## Les icônes

Un arc-en-ciel est dessiné là où l'indice dépasse 0,88. Les maxima sont cherchés
sur une grille d'écran puis écartés les uns des autres pour qu'ils ne se
chevauchent pas. L'arc va du rouge à l'extérieur au violet à l'intérieur —
l'ordre réel d'un arc-en-ciel, à rebours de la rampe thermique du champ.
