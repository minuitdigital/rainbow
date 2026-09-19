# Estimateur d'arcs-en-ciel — reprise de projet

> Fichier de contexte à donner en début de conversation pour reprendre le
> travail.
>
> **Dépôt de travail** : `C:\00 - CREATIONS\RAINBOW ESTIMATEUR\GIT\rainbow`
> On y travaille directement, il n'y a plus qu'à commiter et pousser.

---

## 1. Ce qu'est le projet

Une **œuvre** — un tableau — pas un produit. Le support est une plaque
d'**aluminium brossé / anodisé**. Dessus, un **écran e-ink 10,3 pouces**
piloté par un micro-contrôleur. L'écran affiche une carte du monde où
s'allument les endroits du globe où un arc-en-ciel est sur le point
d'apparaître. Un **mini-joystick** permet de s'y déplacer, un **bouton** de
déposer un indice ou un emoji à un endroit.

L'auteur fait ce type de compositions : matière et écran, à l'intersection de
l'informatique et de la peinture. Des tableaux vivants.

Le sujet — un estimateur d'arcs-en-ciel — est **poétique avant d'être
scientifique**. Mais l'algorithme doit reposer sur de vraies conditions météo.

**Étape en cours : l'application web.** C'est elle qui sera affichée en plein
écran, et c'est elle qui, plus tard, sera rendue en image pour l'e-ink.

---

## 2. Architecture technique

```
               data/field.png ─┐
               data/earth.jpg ─┼──► src/shader ──► src/map ──► <canvas id="gl">
                data/mask.png ─┘                                      │
                                                                      │
                data/coast.js ─┐                                      │
              data/terrain.js ─┼──► src/ink ────────────────► <canvas id="ink">
               data/cities.js ─┘                                      ▼
                                                                  la page
```

**L'ordre de dépendance, à sens unique.** Aucun cycle : on lit de haut en
bas sans jamais revenir en arrière. C'est ce qui rend le code lisible à
quelqu'un d'autre, bien plus que le nombre de lignes.

```
src/projection.js  ← rien                     maths pures, sans état
src/sky.js         ← projection               soleil, bruit, indice, durée
src/ground.js      ← projection, données      terrain, villes, plus proche lieu
src/view.js        ← projection               LE seul module qui se souvienne
src/history.js     ← view, sky                les 24 h passées, RECALCULÉES
src/zones.js       ← sky, ground, view        ce qui vit d'une image à l'autre
src/shader.js      ← rien                     le GLSL, rien d'autre
src/map.js         ← view, shader             contexte WebGL, textures, une image
src/ink.js         ← projection, view, zones, ground   le calque 2D
src/panel.js       ← view, sky, history       les quatre registres de droite
src/chrome.js      ← projection, view         la main : glissé, molette, touches
src/main.js        ← tous                     l'assemblage et la boucle
```

### Où agir — la table de correspondance

Pour ne pas relire tout le projet à chaque modification :

| Ce qu'on veut changer | Le fichier, et lui seul |
|---|---|
| une croyance, un lieu, une phrase de légende | `src/legends.js` |
| la formule de la présence | `src/sky.js` **et** `src/shader.js`, puis `node build/check_mirror.mjs` |
| les paliers d'altitude, le lustre, le grain | `src/shader.js` |
| l'encodage en dégradé de gris (paliers, trame) | `src/shader.js`, bloc `uGrey` |
| les phrases des étiquettes de la carte | `src/zones.js` |
| le dessin sur la carte : villes, glyphes, réticule | `src/ink.js` |
| la mise en page du panneau, les graphes, les réglages | `src/panel.js` + `style.css` |
| ce que couvrent les 24 h, la finesse de l'axe du temps | `src/history.js` |
| le glissé, le zoom, les touches | `src/chrome.js` |
| l'état : zoom maximal, vitesse, allure par défaut | `src/view.js` |
| la structure de la page et le texte d'explication | `index.html` |

Un module touché ne demande **pas** de relire les autres, à une exception
près : le miroir shader / JavaScript ci-dessous.

**Deux règles tiennent l'ensemble**, et le recolleur en dépend :
tous les exports sont **nommés** (pas d'`export default`, pas
d'`import * as`), et **les noms sont uniques dans tout le projet**. C'est
pourquoi `map.js` exporte `initMap` et `paint` plutôt que `init` et
`draw`.

**Le principe fondamental : rien n'est déplacé, tout est recalculé.** À chaque
image, pour chaque pixel de l'écran, le processeur graphique remonte aux
coordonnées Equal Earth, inverse la projection par la méthode de Newton,
applique la rotation de la sphère, obtient une latitude et une longitude, et
va chercher les valeurs dans des textures en plate carrée.

Conséquences : le zoom précise au lieu de flouter, la navigation n'a de butée
nulle part, et les aplats ont des bords calculés donc nets à toute échelle.

**Aucune dépendance.** Pas de bibliothèque, pas de clé d'API, pas de serveur.
Des fichiers statiques. C'est délibéré : l'objet doit tourner des années sur un
mur.

---

## 3. Les fichiers

### Le site (à déployer)

Écrit à la main :

| Fichier | Rôle |
|---|---|
| `index.html` | la structure de la page, et rien d'autre — 2 Ko |
| `style.css` | le registre : papier, encre, spectre |
| `src/projection.js` | Equal Earth, aller et retour, et l'algèbre de la sphère |
| `src/legends.js` | les hauts lieux de la croyance — écrits à la main, à tailler |
| `src/sky.js` | la porte du soleil, et le partage de la croyance |
| `src/ground.js` | relief accessible, villes, plus proche lieu |
| `src/view.js` | où l'on regarde, de quelle distance, quand, et de quelle allure |
| `src/history.js` | les 24 dernières heures sous le réticule, recalculées |
| `src/zones.js` | détection des taches, suivi, les cinq observateurs |
| `src/shader.js` | le GLSL, rien d'autre |
| `src/map.js` | contexte WebGL, textures, une image |
| `src/ink.js` | le calque 2D et sa liste d'encombrement |
| `src/panel.js` | les quatre registres : estimateur, croyance, légendes, réglages |
| `src/chrome.js` | la main : glissé, molette, touches, feuille d'explication |
| `src/main.js` | l'assemblage et la boucle d'images |

Généré, dans `data/` :

| Fichier | Taille | Rôle |
|---|---|---|
| `field.png` | 8 Mo | champ hypsométrique 8192×4096 — 0 fosses, 0,5 côte, 1 sommets |
| `earth.jpg` | 3,9 Mo | carte d'**ombres** 8192×4096 (voir piège n°5) |
| `mask.png` | 48 Ko | coefficient de surface mer / littoral / intérieur, 720×360 |
| `coast.js` | 888 Ko | traits de côte et lacs, Natural Earth 1:50 m, ~55 000 points |
| `cities.js` | 118 Ko | 4 235 lieux habités gradués par palier de zoom, Natural Earth 1:10 m |
| `terrain.js` | 86 Ko | accessibilité + dégagement de l'horizon, 1 octet par degré carré |

`README.md` — présentation publique : résumé, navigation, algorithme.

### Les scripts de génération (`build/`, inutiles en ligne)

| Script | Produit |
|---|---|
| `make_field.py` | `field.png` depuis ETOPO 2022 |
| `make_texture.py` | `earth.jpg` + `mask.png` depuis le relief ombré Natural Earth |
| `make_terrain.py` | `terrain.js` depuis ETOPO + masque terre/mer |
| `make_coast.py` | `coast.js` depuis les vecteurs Natural Earth |
| `make_cities.py` | `cities.js` depuis les lieux habités Natural Earth |
| `bundle.py` | `dist/index.html` — tout recollé en un seul fichier |
| `eqearth.py` | formules de la projection, utilisé par les autres |

**Modules ES natifs**, aucune bibliothèque, aucune étape de construction pour
faire tourner la page. Il faut la servir par HTTP — mais il le fallait déjà
(piège n°3).

`python build/bundle.py` recolle tout en un `dist/index.html` autonome : pour
l'Artifact Claude, et plus tard pour le rendu serveur vers l'e-ink, où il n'y
aura ni serveur HTTP ni résolution d'imports. Ce fichier est **un produit,
jamais une source à éditer** — il est dans `.gitignore`.

### Les sources (non incluses, à retélécharger si besoin)

- **ETOPO 2022, 60 arc-secondes, surface de la glace** — `ETOPO_2022_v1_60s_N90W180_surface.tif`, 444 Mo, sur le site du NCEI (NOAA). Prendre `surface`, pas `bed`.
- **Natural Earth** — `ne_50m_land`, `ne_50m_lakes`, `ne_10m_populated_places`, `ne_50m_admin_0_countries` en GeoJSON, depuis `raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/`. Les scripts les attendent dans `build/`, sous leur nom d'origine.
- **Relief ombré** — extrait du paquet PyPI `basemap-data` (`shadedrelief.jpg`)

Dépendances Python : `numpy`, `pillow`, `tifffile`, `imagecodecs`, `pyproj`.

---

## 4. Décisions déjà prises — ne pas rediscuter

**Projection Equal Earth.** Celle que l'ONU a recommandée par résolution le
4 septembre 2026, après la campagne *Correct The Map* de l'Union africaine :
elle rétablit la taille réelle de l'Afrique. C'est le cœur conceptuel du
projet. MapLibre GL a été envisagé et **écarté pour cette seule raison** — il
ne fait que Mercator et le globe 3D, Equal Earth est un ticket ouvert chez eux
jamais implémenté.

**Navigation par rotation libre de la sphère** (quaternion, façon boule de
commande). Le point saisi reste sous le doigt partout, y compris aux pôles.
Le nord ne reste pas en haut — c'est assumé, c'est le comportement d'un globe.

**Cadrage « couvrir »** : le zoom minimum remplit l'écran, on ne voit jamais la
silhouette de la projection ni le monde entier d'un coup.

**Aplats** plutôt que relief ombré : paliers d'altitude découpés par le shader
dans un champ continu, bords anticrénelés par les dérivées d'écran.

**Registre clair** : papier blanc, aplats de gris, traits de côte noirs.
Un **registre sombre a été essayé puis abandonné** — océan noir et terres
lustrées : spectaculaire, mais ça ne servait pas la lecture de la carte.
Ne pas y revenir sans raison nouvelle.

**Taches irisées** : palette cosinus type interférence (film d'huile), pas un
dégradé thermique. Composées en **multiplication** puisque le fond est clair —
si le fond redevenait sombre il faudrait repasser en additif.

**Étiquettes en gris uniquement** : un petit arc dessiné à la main, quatre
bandes du noir au gris clair. Pas d'emoji — un emoji couleur deviendrait un
pâté au tramage de l'e-ink, et le contraste était insuffisant.

**Le pourcentage est poétique**, la durée est exacte. Voir §6.

**Le soleil n'est pas un curseur.** Les trois curseurs partagent une
croyance finie ; le soleil, lui, reste une porte. Voir §6.

**Pas de frontières, des villes.** Une frontière est une convention et elle ne
dit pas où se tient quelqu'un ; une ville si. La carte n'affiche donc aucune
limite politique — elle nomme des lieux, gradués par palier de zoom (capitales
dès le monde entier, le reste en s'approchant), et chaque étiquette d'arc porte
une troisième ligne : *à 185 km d'Oulan-Oudé, Russie*. Les villes se placent
dans ce que les étiquettes d'arc ont laissé libre : une ville qui gêne un arc
disparaît, jamais l'inverse.

**Plafond de zoom : ×32.** Le zoom ne coûte aucun octet — rien n'est chargé,
tout est recalculé. Le plafond est celui de la *donnée*, pas du moteur : au-delà
de ×32 les sommets de `coast.js` (1:50 m, un point tous les 1 à 4 km)
deviennent des polygones visibles. Monter plus haut demande Natural Earth
1:10 m, +2,5 Mo.

**Dix modules, dépendances à sens unique.** `index.html` avait atteint
1 300 lignes où quatre natures de code partageaient une même portée : des
maths pures, un état mutable, de la plomberie GPU et le mobilier de la
page. Ce n'était pas la longueur le problème, c'était qu'aucune ligne ne
disait ce qui dépendait de quoi. Voir le graphe en §2 — et la règle des
noms uniques, dont dépend `build/bundle.py`.

**La tache s'efface quand on s'approche** (facteur 0,40 à plein zoom). Vue du
monde, elle est un signal qu'on lit d'un continent à l'autre ; de près, on est
*dans* le paysage et l'arc n'est plus qu'un indice. Voir piège n°10.

---

## 5. Pièges rencontrés — à ne pas refaire

1. **`<canvas>` en `position: fixed`** garde sa taille intrinsèque 300×150
   malgré `inset: 0`. Il faut `width: 100%; height: 100%` explicites.

2. **Texture pas encore chargée = canvas noir.** Lier des textures blanches
   1×1 dès le départ, et ne jamais conditionner le tracé à un compteur de
   chargement — la petite texture arrive avant la grosse.

3. **`file://` ne marche pas.** Chrome refuse de charger une image locale dans
   une texture WebGL. Il faut un serveur : `python3 -m http.server 8000`.

4. **Précision float32 du bruit.** Une version injectait `Date.now()` converti
   en heures (~45 000) dans les coordonnées du bruit : il ne restait que deux
   décimales, le champ se cassait en blocs et la carte était tranchée par de
   longues droites verticales. Le décalage doit rester **relatif au démarrage
   et borné** (modulo 512).

5. **`earth.jpg` est une carte d'OMBRES, pas de reflets.** L'appliquer à pleine
   amplitude réimprime tout le relief par-dessus les aplats — on ne voit plus
   qu'elle. Elle ne sert qu'à creuser légèrement les versants (facteur 0,18).

6. **Couture de la texture à l'antiméridien.** `u` saute de 1 à 0, ce qui fait
   s'effondrer le mipmap le long de la couture. Solution : calculer le gradient
   sur deux versions décalées d'un demi-tour, garder le plus petit, et
   échantillonner avec `textureGrad`.

7. **Le JPEG couleur d'ETOPO n'est pas décodable en altitude** — l'ombrage
   corrompt les teintes, le Sahara à 800 m a la même couleur que l'Himalaya à
   6 000 m. Il faut le vrai GeoTIFF float32.

8. **Limite de transfert de 400 Mo par fichier** vers l'environnement Claude.
   Les 444 Mo d'ETOPO ont dû être découpés en huit morceaux puis recollés.

9. **Le glyphe de l'arc se referme en pâté** si l'écart entre les bandes n'est
   pas nettement supérieur à leur épaisseur. Quatre bandes espacées de 2,5 px
   pour 1,25 px de trait — pas cinq bandes serrées.

10. **En zoomant, la tache noie le relief.** À ×4 on est déjà *dans* une seule
    tache : l'écran devient un vitrail saturé et la carte disparaît. Deux
    correctifs, pilotés par `uDetail` (nul au monde entier, plein à partir de
    ×10) : l'intensité tombe à 0,40, et deux octaves de bruit fines entrent
    pour donner du grain. Le grain **ne déplace pas** la tache, il la dépolit —
    la structure, donc l'indice lu, reste celle du champ.

11. **Le bruit de base n'a rien de plus fin que ~400 km.** Les trois octaves
    sont à 1 770, 830 et 405 km. Sans octaves fines, s'approcher ne montre rien
    de nouveau : c'est un aplat de couleur qui grandit.

12. **« de Oulan-Oudé ».** Une carte française qui n'élide pas n'est plus une
    œuvre, c'est un export. Voir `de()` dans `src/ground.js`. Et pas
    d'élision devant « y » : on dit « de York », « de Yinchuan ».

13. **`data/` était dans le `.gitignore`.** Hérité de l'époque où ce dossier
    contenait les sources lourdes. Le jour où le site y a emménagé, plus
    rien n'est parti sur GitHub Pages : page blanche, aucun message. Le
    `.gitignore` porte maintenant un avertissement en tête.

14. **Un module ES qui ne se charge pas échoue EN SILENCE.** Pas d'erreur
    à l'écran, pas de repli, rien : du blanc. C'est un net recul par
    rapport aux balises `<script>` classiques, où seule la partie
    manquante disparaissait. Sur un tableau accroché à un mur, c'est la
    pire des pannes. D'où la VEILLE en bas d'`index.html` : un script
    classique, huit secondes, et si `window.__rainbow` n'est pas levé
    elle écrit les trois causes probables. Ne pas la retirer.

15. **Le double-clic est passé de « dégradé » à « mort ».** Avant les
    modules, ouvrir la page en `file://` donnait une carte sans textures.
    Maintenant `file://` bloque les modules eux-mêmes : écran blanc. La
    veille le dit, mais autant le savoir.

16. **Le cache du navigateur mélange deux versions.** Douze modules qui
    s'importent : si le navigateur en reprend un seul de son cache pendant
    qu'il recharge les autres, la page tourne avec un assemblage qui n'a
    jamais existé. Symptôme observé : la veille se déclenchait sur une page
    parfaitement saine, parce qu'elle venait du nouvel `index.html` et
    attendait un drapeau posé par un `main.js` encore ancien. Une heure
    perdue. D'où `serve.py` et son `no-store`.

17. **Vérifier chez l'auteur, pas dans un bac à sable.** Le rendu validé
    ailleurs ne prouve rien sur la machine où l'œuvre vit. Le navigateur
    intégré atteint `localhost` de ce poste : s'en servir avant de dire
    que c'est fait.

18. **L'horloge simulée doit S'ACCUMULER.** Elle se déduisait du temps réel
    écoulé multiplié par la vitesse. Tant que rien ne regardait en arrière
    c'était sans conséquence ; depuis que le panneau trace les vingt-quatre
    dernières heures, toucher au curseur du temps réécrivait tout le passé
    d'un coup — à ×10 000, un cran en arrière ramenait la date de plusieurs
    jours. `advanceClock(dt)` est appelé une fois par image dans `main.js`,
    et nulle part ailleurs.

19. **Le miroir shader / JavaScript est la SEULE duplication du projet.**
    Elle ne peut pas être supprimée : on ne fait pas tourner du GLSL au
    réticule, ni du JavaScript par pixel. Elle est surveillée :

        node build/check_mirror.mjs

    Le script lit les deux sources comme du texte et compare toutes les
    constantes de la formule. À lancer après **toute** modification de
    `src/sky.js` ou de `src/shader.js`. S'il dit « motif introuvable »,
    c'est que la formule a été réécrite : relire les deux fichiers, puis
    corriger le motif dans le script — jamais l'inverse.

20. **Les étiquettes de la carte s'écrivaient sous le panneau.** Elles
    étaient imprimées puis masquées : du bruit, et surtout une place
    volée à une ville visible. L'emprise du panneau est mesurée dans
    `rescale()` (une fois par redimensionnement, pas par image) et versée
    dans la liste d'encombrement de `src/ink.js`.

---

## 6. L'algorithme actuel

**Une porte, puis une croyance.**

```
présence = SOLEIL × ( wMétéo·M + wLégende·L + wChance·C )
                     avec wM + wL + wC = 1
```

**La porte, exacte et sans curseur.** Le soleil doit se tenir entre
l'horizon et 42° ; au-delà, le centre de l'arc passe sous l'horizon. Porte
fermée : zéro, et aucun réglage ne peut rien y faire. On ne croit pas en la
hauteur du soleil, on la calcule — c'est ce qui empêche la pièce de devenir
un jouet. `S = (1 − h/42)^1,3 × montée douce de 0° à 6,5°`, plafond ≈ 0,80.

**Une SOMME à l'intérieur, pas un produit.** Avec un produit, un seul zéro
éteindrait tout : le spectateur qui ne croit qu'aux légendes ne verrait
rien nulle part. Avec une somme pondérée, il voit une carte allumée à ses
hauts lieux, et c'est ce que la pièce a à dire.

**Les trois parts.**

- **Météo** — `1 − exp(−pluie × trouée/1,2 × 6)`. Le bruit fractal et la
  climatologie grossière d'avant, ramenés entre 0 et 1. *À remplacer par
  Open-Meteo, voir §7.*
- **Légende** — un plancher de 0,09 partout, relevé par le haut lieu le
  plus proche : `max(plancher, force × exp(−corde²/rayon²))`. Un **maximum**
  et non une somme, deux traditions voisines ne s'additionnent pas.
  Les points sont dans `src/legends.js`, versés au shader comme un tableau
  d'uniformes (48 places réservées).
- **Chance** — un second bruit, plus lent (`×0,62`, ~2 850 km) et avec sa
  propre horloge, seuillé serré à `smoothstep(0,46 · 0,76)` : des poches,
  pas un voile.

`GAIN = 1,8` ramène le plein au plein, puis `field = t^1,15 × 0,98`.

**Une croyance FINIE, en simplexe.** Pousser un curseur pousse
**physiquement** les deux autres, au prorata de ce qu'ils valaient : les
poignées bougent et la somme reste 100 %. La première version gardait les
poignées immobiles et ne redistribuait que le pourcentage affiché —
l'arbitrage était juste, mais invisible. Voir `pushBelief` dans
`src/panel.js`.

**Quand la légende porte le chiffre, la légende parle** : la phrase de
l'étiquette devient la croyance du lieu — « K'uychi, on ne montre pas
l'arc du doigt » — au lieu d'un résumé. Voir `phraseFor` dans `zones.js`.

### Le panneau

Quatre registres dans une colonne à droite, et **tout y décrit le
réticule** — le centre exact de l'écran. Le panneau ne choisit pas un
lieu, il décrit celui qu'on regarde ; les pastilles des hauts lieux ne
sélectionnent rien, elles y **amènent** le réticule.

| Registre | Ce qu'il fait |
|---|---|
| ESTIMATEUR | position, heure, **héliodon** (hauteur du soleil) et **présence** |
| CROYANCE | les trois curseurs en simplexe |
| LÉGENDES | les pastilles, la foi au réticule, et ce qu'on dit du lieu |
| RÉGLAGES | l'allure — mémorisé dans `localStorage` |

**Les quatre registres se replient sur leur bandeau**, et l'état est
mémorisé. À l'usine, ESTIMATEUR et CROYANCE sont ouverts, LÉGENDES et
RÉGLAGES fermés : les deux premiers se lisent, les deux autres
s'appellent. Un bandeau replié continue de dire l'essentiel — la foi du
lieu reste lisible sans déplier les vingt pastilles. Replier libère aussi
de la place sur la carte : l'emprise versée dans `ink.js` est l'union des
boîtes, pas la colonne, et `measureRail()` la reprend à chaque pli.

**La clé de stockage porte un numéro** (`estimateur.reglages.2`). Changer
une valeur par défaut dans `index.html` ne sert à rien si la page relit
l'ancienne : quand un défaut doit s'imposer, on incrémente.

**Le passé est recalculé, pas mémorisé.** `src/history.js` reconstruit à
chaque image les vingt-quatre dernières heures simulées sous le réticule :
le ciel est une fonction pure du lieu et de l'instant, donc son passé se
calcule aussi bien qu'il s'observe. C'est le même principe que la carte, et
c'est ce qui permet de déplacer le réticule sans perdre l'histoire du lieu
— un tampon aurait montré vingt-quatre heures d'un endroit où l'on n'est
plus. 320 points, espacés selon l'axe et non selon le temps.

**L'axe du temps est logarithmique**, emprunté aux moniteurs de débit : la
dernière minute occupe la moitié de la largeur, la dernière journée
l'autre moitié. Sans quoi, à ×100 000, la dernière heure serait un cheveu
contre le bord droit.

**Les poids sont appliqués au dessin**, pas à l'échantillonnage : bouger un
curseur repondère toute l'histoire d'un coup, sans rien recalculer.

**L'allure vit dans `view.look`** — saturation, force de la tache,
encodage en gris, taille des glyphes. Ce ne sont pas des données : deux
réglages différents décrivent le même ciel. Le shader lit `uSat`,
`uTache`, `uGrey` ; `ink.js` lit `view.look.icon`.

**Le dégradé de gris est un ENCODAGE, pas une teinte en moins.** En
couleur, la teinte suffit à séparer la tache du fond ; en gris elle entre
en concurrence avec le relief, lui aussi gris et lui aussi lisse. La force
passe donc par la densité : six paliers — le même langage que les aplats
du relief, et pas de trait d'iso-valeur, la marche se voit toute seule —
plus une **trame ordonnée de Bayer 8×8** à la résolution de l'affichage.
Des points et non des hachures : une hachure impose une direction, et sur
une carte toute direction finit par avoir l'air de signifier quelque
chose. La part de cases noircies vaut exactement l'intensité. C'est
littéralement ce que fera le tramage de l'e-ink.

### L'ancien assemblage, pour mémoire

Trois conditions devaient se rencontrer au même endroit.

**La géométrie du soleil — exacte.** Le soleil doit se tenir entre l'horizon et
**42°**. Au-delà, le centre de l'arc, situé à l'opposé du soleil, passe sous
l'horizon. Cette contrainte dessine un anneau qui fait deux fois le tour de la
Terre chaque jour, à l'aube et au crépuscule.

**Des gouttes — simulée.** Bruit fractal cohérent sur la sphère, qui dérive
avec le temps. *À remplacer par Open-Meteo.*

**Une trouée — approximée.** Du soleil direct malgré l'averse. Climatologie
grossière : ZCIT, rails dépressionnaires, prime aux littoraux. *À remplacer.*

### Les paliers d'altitude

Cuits dans `field.png` par `make_field.py` — le shader découpe des paliers
réguliers, c'est le script qui distord la valeur pour qu'ils tombent pile sur
ces altitudes. Changer l'hypsométrie = modifier ces deux listes et régénérer.

```python
LAND = [0, 100, 300, 700, 1200, 2000, 3000, 4200, 5600]   # mètres
SEA  = [0, 200, 1000, 2500, 3500, 4500, 5500, 7000]
```

Le trait de côte vient de Natural Earth, **pas du signe de l'altitude** :
sinon les polders passeraient sous l'eau et la Caspienne deviendrait une terre.

### Les étiquettes

Une zone porte **de une à cinq** étiquettes selon sa taille à l'écran, **huit
maximum** à l'écran, jamais de chevauchement, les quatre coins de l'interface
interdits. Les zones sont suivies d'une passe à l'autre : elles apparaissent et
disparaissent en fondu plutôt que de clignoter.

Ce ne sont pas cinq mesures du même endroit mais **cinq observateurs
différents** — celui qui est sur la crête voit l'arc, celui du fond de la
vallée non. C'est le sujet même du projet : un arc-en-ciel n'existe pas *à un
endroit*, il existe *pour un observateur*.

Chaque étiquette porte :

- **un pourcentage** — composite et volontairement poétique : ce que la carte
  affiche, le dégagement de l'horizon, l'accessibilité du lieu, et une part de
  **chance** qui oscille sans raison, propre à chaque point. Il est fait pour
  osciller et déplacer le regard d'une zone à l'autre.
- **une durée** — exacte, elle ne dépend que du soleil : temps restant avant
  qu'il ne monte au-dessus de 42° ou ne touche l'horizon.
- **une phrase** qui dit ce qui porte le chiffre : *le soleil perce*, *averse
  en cours*, *l'averse s'éloigne*, *soleil rasant*, *horizon ouvert*, *depuis
  la crête*, *au hasard*, *un pressentiment*, *rien ne le justifie*,
  *imminent*, et — sur une zone forte mais déserte — ***personne pour voir***.

---

## 7. Prochaine étape : brancher la vraie météo

**L'obstacle** n'est pas la donnée, c'est sa forme. La carte calcule un champ
continu sur tout le globe ; Open-Meteo répond par points.

**La solution** : un petit travail périodique fabrique une image, la page lit
l'image.

```
Open-Meteo ──► script ──► weather.png (quelques Ko) ──► la page ──► le shader
```

**Le budget tient**, parce qu'un appel rend 48 heures de prévision d'un coup.
On n'interroge donc pas chaque heure mais deux fois par jour.

- grille **5°** sur tout le globe = 2 592 points
- trois variables : précipitations, couverture nuageuse, rayonnement direct
- deux passages par jour = **5 200 appels**, sous le plafond gratuit de 10 000/jour
- image résultante : 72 × 36 cases, 48 pas de temps en damier, trois canaux

**Où ça tourne : GitHub Actions.** Un `cron` deux fois par jour, le script
recommite le PNG dans le dépôt, Pages le sert. Aucun serveur, aucun coût.

**Ce que ça change dans le code** : une ligne du shader — `fbm(...)` devient
`texture(uWeather, ...)`.

**Deux points d'attention :**

- 5° font 550 km. Garder le bruit fractal actuel comme **texture haute
  fréquence par-dessus la vraie donnée** : le grand mouvement est vrai, le
  détail est inventé mais organique. **Prévoir de pouvoir monter en précision
  plus tard** (2,5° = compte payant) — la résolution doit rester une constante
  unique dans le script.
- Open-Meteo est en **CC-BY 4.0** : une ligne de crédit sera nécessaire sur la
  page, et probablement sur le tableau.

**Et le curseur change de nature** : il n'accélérera plus un faux temps mais
fera défiler la prévision réelle sur 48 heures.

**La recette** — c'est-à-dire le dosage entre averse, trouée et angle du
soleil — reste à fixer. Aujourd'hui les coefficients sont inventés au jugé, ce
qui n'a aucune importance tant que la pluie est fausse. Méthode de validation
prévue : chercher un endroit où il y a eu un arc-en-ciel un jour donné,
remonter la météo de ce moment, vérifier que la carte l'avait vu.

---

## 8. Ce qui reste, par ordre

**A — Esthétique web** (en cours)
Densité et intensité des taches · nombre de cycles dans l'irisation · format
cible 4:3 pour coller au 10,3" · retirer `earth.jpg` et la touche `r` une fois
le choix arrêté (−3,9 Mo).

*Ouvert depuis les curseurs de croyance :*
- La liste de `src/legends.js` est un premier jet de vingt entrées. Les
  traditions vivantes — terre d'Arnhem, Aotearoa, Dinétah, Cusco, Wallmapu —
  méritent d'être relues par quelqu'un qui les connaît mieux qu'une ligne.
- Faut-il une seconde famille de points, non mythologiques : les lieux où
  l'arc est physiquement chez lui (Mosi-oa-Tunya, Hilo, Niagara) ? C'est
  une autre catégorie, elle brouillerait peut-être le mot « légende ».
- Le glyphe à la baguette n'a pas encore été jugé au tramage e-ink.

*Ouvert depuis l'intégration du panneau :*
- `#box-est` fait 33 vh : les deux graphes sont justes en hauteur sur un
  écran court. À revoir sur le 10,3" réel, qui sera en 4:3.
- Le noir de la trame de Bayer est à 0,20. Faut-il descendre à 0,12 ?
- La transparence par défaut (0,77) a été relevée : à 0,56 les noms de
  villes traversaient les boîtes. À réévaluer sur l'écran du tableau.
- Les vingt pastilles occupent beaucoup de place. Faut-il n'afficher que
  les plus proches, ou les laisser toutes — c'est aussi un index de
  l'œuvre ?

*Ouvert depuis le test des villes :*
- À ×32, les cinq observateurs d'une même zone disent presque la même chose
  (« 89 % · Tchita », « 88 % · Tchita »…). Le grain n'est appliqué que dans le
  shader, pas dans `index()`. S'il l'était aussi côté JS, les cinq chiffres
  divergeraient et les étiquettes cesseraient de se répéter. À trancher : le
  grain est-il de la matière (shader seul) ou de la donnée (les deux) ?
- `coast.js` tient mieux que prévu à ×32. Le 1:10 m n'est pas urgent.
- Palier 5 des villes (> 50 000 hab.) = 1 723 entrées, 40 % du fichier.
  `MAX_TIER = 4` dans `make_cities.py` ramène `cities.js` à ~65 Ko.
- Faut-il nommer le pays sur la troisième ligne, ou la ville seule suffit-elle ?

**B — Données réelles** — voir §7.

**C — Interaction du tableau**
Joystick : navigation par sauts, réticule central comme curseur (les flèches du
clavier préparent déjà ça) · bouton : déposer un indice ou un emoji · où vivent
ces dépôts — partagés entre spectateurs, ou locaux au tableau ?

**D — Pipeline e-ink**
Rendu serveur → PNG 1872×1404 en 16 gris · **le tramage peut remettre en cause
tout le A** : les taches irisées deviendront des densités de trame · cadence de
rafraîchissement.

**E — Matériel**
Écran, board, alimentation, joystick, intégration dans l'aluminium.

**Contrainte à garder en tête** : un e-ink 10" met ~0,5 à 1 s en rafraîchissement
partiel, 2 à 3 s en complet. Pas de glissement fluide possible — la navigation
du tableau devra se faire par sauts. Ce n'est pas un défaut : ça impose un
rythme contemplatif qui convient à un tableau.

---

## 9. Manipulations

**Tester en local** — le double-clic ne marche pas (voir piège n°3), et les
modules ES exigent eux aussi un serveur :

```bash
cd "C:\00 - CREATIONS\RAINBOW ESTIMATEUR\GIT\rainbow"
python serve.py
```

**Pas `python -m http.server`** : il laisse le navigateur mettre les modules
en cache, et il suffit qu'un seul des douze soit repris de l'ancienne
version pendant que les autres sont rechargés pour que la page mélange deux
états. Voir piège n°16. `serve.py` répond `no-store` et corrige au passage
les types MIME sous Windows.

puis `http://localhost:8000`

**Vérifier le miroir** — après toute retouche à `src/sky.js` ou
`src/shader.js` :

```bash
node build/check_mirror.mjs
```

**Mettre en ligne (GitHub Pages)** : dépôt public, glisser les fichiers du site
à la **racine** (pas le dossier), puis *Settings → Pages → Deploy from a branch
→ main → / (root)*.

**Régénérer les données** :

```bash
pip install numpy pillow tifffile imagecodecs pyproj
python build/make_field.py     # field.png     (~1 min, demande etopo.tif)
python build/make_terrain.py   # terrain.js    (demande etopo.tif)
python build/make_texture.py   # earth.jpg + mask.png
python build/make_coast.py     # coast.js
python build/make_cities.py    # data/cities.js
python build/bundle.py         # dist/index.html, le recollage
```

**Navigation dans la page** : glisser (rotation libre) · molette ou pincement
(zoom vers le curseur) · double-clic (×2) · flèches (par pas) · curseur du bas
(vitesse du temps simulé, 0 fige) · `r` (aplats ↔ relief ombré) · `0`
(recentrer) · `f` (plein écran).

---

## 10. Sources et crédits

- Projection **Equal Earth** — Šavrič, Patterson & Jenny (2018)
- Altitudes et bathymétrie — **ETOPO 2022**, NOAA NCEI
- Traits de côte, lacs, relief ombré — **Natural Earth** (domaine public)
- Météo à venir — **Open-Meteo**, CC-BY 4.0 (crédit obligatoire)
- Typographie — **Fragment Mono** (Google Fonts)
