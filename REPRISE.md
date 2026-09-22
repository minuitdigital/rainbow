# Estimateur d'arcs-en-ciel — reprise de projet

> Fichier de contexte à donner en début de conversation pour reprendre le
> travail.
>
> **Dépôt de travail** : `C:\00 - CREATIONS\RAINBOW ESTIMATEUR\GIT\rainbow`
> On y travaille directement, il n'y a plus qu'à commiter et pousser.
>
> *Dernière mise à jour : 22 septembre 2026.*

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
src/legends.js     ← rien                     les hauts lieux, et LEURS SOURCES
src/sky.js         ← projection, legends      soleil, bruit, flaque, fuite
src/ground.js      ← projection, données      terrain, villes, plus proche lieu
src/view.js        ← projection               LE seul module qui se souvienne
src/history.js     ← view, sky                les 24 h passées, RECALCULÉES
src/zones.js       ← sky, ground, view        ce qui vit d'une image à l'autre
src/shader.js      ← rien                     le GLSL, rien d'autre
src/map.js         ← view, shader             contexte WebGL, textures, une image
src/ink.js         ← projection, view, zones, ground   le calque 2D
src/panel.js       ← view, sky, history, ink  les quatre registres de droite
src/chrome.js      ← projection, view         la main : glissé, molette, touches
src/main.js        ← tous                     l'assemblage et la boucle
```

### Où agir — la table de correspondance

Pour ne pas relire tout le projet à chaque modification :

| Ce qu'on veut changer | Le fichier, et lui seul |
|---|---|
| une croyance, un lieu, une phrase, **une source** | `src/legends.js` |
| la formule de la présence | `src/sky.js` **et** `src/shader.js`, puis `node build/check_mirror.mjs` |
| la flaque de chance, la fuite de la porte | idem — les deux, puis le miroir |
| les paliers d'altitude, le lustre, le grain, les trous | `src/shader.js` |
| l'encre des aplats (terres, mer) | `src/shader.js`, bloc `SEA_*` / `LAND_*` |
| l'encodage en dégradé de gris (paliers, trame) | `src/shader.js`, bloc `uGrey` |
| les phrases des étiquettes de la carte | `src/zones.js` |
| le dessin sur la carte : villes, glyphes, **le piéton** | `src/ink.js` |
| la mise en page du panneau, les graphes, les réglages | `src/panel.js` + `style.css` |
| ce que couvrent les 24 h, la finesse de l'axe du temps | `src/history.js` |
| le glissé, le zoom, les touches | `src/chrome.js` |
| l'état : zoom maximal, vitesse, allure, **la marche** | `src/view.js` |
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

| Fichier | Rôle |
|---|---|
| `index.html` | la structure de la page, et rien d'autre |
| `style.css` | le registre : papier, encre, spectre |
| `src/projection.js` | Equal Earth, aller et retour, et l'algèbre de la sphère |
| `src/legends.js` | les hauts lieux de la croyance, et leurs sources |
| `src/sky.js` | la porte du soleil, la croyance, la flaque, la fuite |
| `src/ground.js` | relief accessible, villes, plus proche lieu |
| `src/view.js` | où l'on regarde, de quelle distance, quand, de quelle allure, **et la foulée** |
| `src/history.js` | les 24 dernières heures sous le réticule, recalculées |
| `src/zones.js` | détection des taches, suivi, les cinq observateurs |
| `src/shader.js` | le GLSL, rien d'autre |
| `src/map.js` | contexte WebGL, textures, une image |
| `src/ink.js` | le calque 2D, le piéton du réticule, la liste d'encombrement |
| `src/panel.js` | les quatre registres, et la feuille de provenance |
| `src/chrome.js` | la main : glissé, molette, touches, feuille d'explication |
| `src/main.js` | l'assemblage et la boucle d'images |

Généré, dans `data/` : `field.png` (8 Mo), `earth.jpg` (3,9 Mo, carte
d'**ombres**), `mask.png` (48 Ko), `coast.js` (888 Ko), `cities.js`
(118 Ko), `terrain.js` (86 Ko).

### Les documents

| Fichier | Rôle |
|---|---|
| `README.md` | présentation publique |
| `REPRISE.md` | ce fichier |
| `LEGENDES.md` | **fiche de travail des hauts lieux** : les vingt à plat, l'état du sourçage, les corrections que la recherche impose, les pistes d'élargissement. Ne tourne pas — `src/legends.js` fait foi. |

### Les scripts (`build/`, inutiles en ligne)

`make_field.py`, `make_texture.py`, `make_terrain.py`, `make_coast.py`,
`make_cities.py`, `eqearth.py`, `bundle.py` (recolle `dist/index.html`),
et **`check_mirror.mjs`** — vingt règles, voir piège n°19.

Dépendances Python : `numpy`, `pillow`, `tifffile`, `imagecodecs`, `pyproj`.

---

## 4. Décisions déjà prises — ne pas rediscuter

**Projection Equal Earth.** Recommandée par l'ONU le 4 septembre 2026, après
la campagne *Correct The Map* de l'Union africaine : elle rétablit la taille
réelle de l'Afrique. C'est le cœur conceptuel du projet. MapLibre GL a été
écarté pour cette seule raison.

**Navigation par rotation libre de la sphère** (quaternion). Le point saisi
reste sous le doigt partout, y compris aux pôles. Le nord ne reste pas en
haut — c'est le comportement d'un globe.

**Cadrage « couvrir »** : le zoom minimum remplit l'écran, on ne voit jamais
la silhouette de la projection.

**Aplats** plutôt que relief ombré, bords anticrénelés par les dérivées
d'écran.

**Registre clair** : papier blanc, aplats de gris, traits de côte noirs. Un
registre sombre a été essayé puis abandonné.

**Taches irisées** : palette cosinus type interférence (film d'huile).
Composées en **multiplication** puisque le fond est clair.

**Étiquettes en gris uniquement**, jamais d'emoji — un emoji couleur
deviendrait un pâté au tramage de l'e-ink.

**Le pourcentage est poétique**, la durée est exacte.

**Pas de frontières, des villes.** Une frontière est une convention et elle
ne dit pas où se tient quelqu'un ; une ville si.

**Plafond de zoom : ×32**, limite de la *donnée* (`coast.js` en 1:50 m).

**Treize modules, dépendances à sens unique**, noms uniques.

### Ce qui a changé en septembre 2026 — et qui remplace l'ancien

**LE PIÉTON MARCHE.** Le réticule est une silhouette de piéton, et elle
marche quand le monde défile sous elle. **La cadence suit la DISTANCE, pas
le temps** : un pas vaut tant de pixels de sol glissé, donc le même geste
de la main fait le même nombre de pas à ×1 comme à ×32. Une carte immobile
ne le fait pas piétiner et ne coûte toujours rien. Voir `stride()` dans
`view.js` et `walkerGait()` dans `ink.js`.

**Le pied reste au sol, et de là vient le dandinement.** Jambes jointes, la
figure est plus haute d'une unité ; plutôt que de laisser le pied
s'enfoncer sous le point visé — le contraire de ce que la silhouette dit —
on relève toute la figure de ce qu'il faut. Le balancement n'est pas un
effet ajouté, c'est la conséquence du contact.

**IL PIVOTE AUTOUR DU POINT VISÉ**, et prend l'envers de la direction
choisie : on monte vers le nord, il se retrouve la tête en bas. La règle
tient en une phrase — *sa tête pointe à l'opposé du déplacement*. L'angle
est rattrapé par le plus court chemin, avec inertie (`TURN_RATE = 5`), et
**il ne revient pas à l'endroit quand on s'arrête** : il garde le dernier
cap.

**La croix du réticule est remplacée par un point noir.** Les bras
marquaient le point exact parce que la silhouette se tenait toujours
au-dessus ; maintenant qu'elle pivote tout autour, ils lui passeraient au
travers. L'emprise du réticule est devenue un carré. Un curseur
**point** permet de lui donner une teinte (défaut : `encre`).

**LA CHANCE N'EST PLUS UN LIEU DU MONDE, C'EST CE QUE LE PIÉTON PORTE.**
Elle est multipliée par une **flaque** centrée sur le réticule, qui
s'élargit à mesure qu'on croit en elle (8° à 30°). Au réticule la flaque
vaut exactement 1 — le panneau lit donc toujours la chance pleine, et
`history.js` n'a rien à savoir de tout ceci. On promène sa chance sur la
Terre.

**ET LA PORTE FUIT, dans la flaque et nulle part ailleurs.** Un arc peut
s'allumer alors que le soleil est couché ou trop haut, parce qu'il n'a
aucune raison de s'allumer. La fuite est en **wC²** : elle n'existe pas
tant qu'on ne l'a pas voulue, et elle ne touche que la chance. La météo et
la légende restent enfermées dans l'anneau. À `wC = 0`, la carte est
identique au bit près à celle d'avant.

**LA TACHE NE S'EFFACE PLUS EN S'APPROCHANT** — le facteur 0,40 du piège
n°10 est supprimé. Le constat d'origine était juste (de près la couleur
noyait le relief) mais il traitait le symptôme : ce qui saturait l'écran,
c'était un aplat de couleur agrandi, pas la couleur. Trois octaves
profondes (47, 19 et 8 km) et **des trous** règlent ça en donnant à la
tache une structure à regarder.

**LES TROUS.** Un seuil qui monte avec le zoom ne garde que ce qui dépasse,
le reste redevient du papier — et **au-dessus du seuil la valeur est
intacte** : on perd de la surface, pas de l'intensité. Même méthode que
partout ailleurs (la chance est seuillée en poches, le relief en paliers),
bords calculés par les dérivées d'écran.

**Le nombre de tours de palette est un réglage et ne monte plus avec le
zoom.** Lié à la finesse, il faisait boucler la palette — bleu, vert,
jaune, orange, rose, puis cyan et ça recommence : un arc-en-ciel de trop
par-dessus le sujet. La complexité de près vient des trous.

**LA SOURCE EST UN CHAMP OBLIGATOIRE des légendes**, et `null` est une
réponse. Citer une croyance sans dire d'où elle vient, sur un mur, sous un
nom propre, c'est de l'appropriation avec une jolie police. Chaque phrase
porte un **triangle avec un i** — le même pour toutes, sourcées ou non —
qui ouvre une feuille disant `Source : <lien>` ou `Source : (sans
source)`. Deux signes différents auraient trié les légendes avant même
qu'on ait cliqué.

**Les réglages sont rangés en quatre sous-registres repliables** — *la
tache*, *le fond*, *le panneau*, *le temps*. Onze curseurs en colonne
n'étaient plus une liste mais un tableau de bord.

---

## 5. Pièges rencontrés — à ne pas refaire

1. **`<canvas>` en `position: fixed`** garde sa taille intrinsèque 300×150
   malgré `inset: 0`. Il faut `width: 100%; height: 100%` explicites.

2. **Texture pas encore chargée = canvas noir.** Lier des textures blanches
   1×1 dès le départ, et ne jamais conditionner le tracé à un compteur de
   chargement.

3. **`file://` ne marche pas.** Chrome refuse de charger une image locale dans
   une texture WebGL. Il faut un serveur.

4. **Précision float32 du bruit.** Le décalage doit rester **relatif au
   démarrage et borné** (modulo 512), sinon le champ se casse en blocs.

5. **`earth.jpg` est une carte d'OMBRES, pas de reflets.** Facteur 0,18.

6. **Couture de la texture à l'antiméridien.** Calculer le gradient sur deux
   versions décalées d'un demi-tour, garder le plus petit, `textureGrad`.

7. **Le JPEG couleur d'ETOPO n'est pas décodable en altitude.** Il faut le
   vrai GeoTIFF float32.

8. **Limite de transfert de 400 Mo par fichier** vers l'environnement Claude.

9. **Le glyphe de l'arc se referme en pâté** si l'écart entre les bandes
   n'est pas nettement supérieur à leur épaisseur.

10. **~~En zoomant, la tache noie le relief.~~** *Périmé — voir §4.* La
    réponse n'était pas d'effacer la tache mais de lui donner une
    structure : octaves profondes et trous.

11. **Le bruit de base n'a rien de plus fin que ~400 km.** D'où les octaves
    ajoutées : 290, 113, puis 47, 19 et 8 km.

12. **« de Oulan-Oudé ».** Une carte française qui n'élide pas n'est plus une
    œuvre, c'est un export. Voir `de()` dans `src/ground.js`. Pas d'élision
    devant « y ».

13. **`data/` était dans le `.gitignore`.** Page blanche sur GitHub Pages,
    aucun message.

14. **Un module ES qui ne se charge pas échoue EN SILENCE.** Pas d'erreur à
    l'écran, rien : du blanc. D'où la VEILLE en bas d'`index.html` : huit
    secondes, et si `window.__rainbow` n'est pas levé elle écrit les trois
    causes probables. **Ne pas la retirer.**

15. **Le double-clic est passé de « dégradé » à « mort ».** `file://` bloque
    les modules eux-mêmes : écran blanc.

16. **Le cache du navigateur mélange deux versions.** D'où `serve.py` et son
    `no-store`. **Ne jamais utiliser `python -m http.server`.**

17. **Vérifier chez l'auteur, pas dans un bac à sable.** Le navigateur
    intégré atteint `localhost` de ce poste : s'en servir avant de dire que
    c'est fait.

18. **L'horloge simulée doit S'ACCUMULER.** `advanceClock(dt)` est appelé
    une fois par image dans `main.js`, et nulle part ailleurs. Même règle
    désormais pour `stride(dt)`, la foulée du piéton.

19. **Le miroir shader / JavaScript est la SEULE duplication du projet.**
    Elle ne peut pas être supprimée : on ne fait pas tourner du GLSL au
    réticule, ni du JavaScript par pixel.

        node build/check_mirror.mjs

    Vingt règles aujourd'hui. À lancer après **toute** modification de
    `src/sky.js` ou de `src/shader.js`. S'il dit « motif introuvable »,
    c'est que la formule a été réécrite : relire les deux fichiers, puis
    corriger le motif **dans le script — jamais l'inverse**.

20. **Les étiquettes de la carte s'écrivaient sous le panneau.** L'emprise
    est mesurée dans `measureRail()` — une fois par redimensionnement et à
    chaque pli, pas par image — et versée dans `src/ink.js`.

21. **PAS D'ACCENT GRAVE DANS `src/shader.js`.** Tout le GLSL vit dans un
    gabarit de chaîne JavaScript : le premier backtick le referme, et le
    fichier ne compile plus. Attrapé par `node --check`, jamais à l'œil.

22. **Le panneau est redessiné soixante fois par seconde.** Tout nœud DOM
    refabriqué à chaque image devient incliquable — le clic part sur un
    nœud déjà remplacé. Voir `saidFor` dans `panel.js` : on ne réécrit la
    phrase et son renvoi que quand le lieu change.

23. **Volet du navigateur masqué = `requestAnimationFrame` gelé.** La page
    reste figée sur ses tirets, `document.visibilityState` vaut `hidden`,
    et aucune image ne passe. **Ce n'est pas une panne** — c'est le
    symptôme n°1 des faux diagnostics de cette session. Demander
    l'affichage (Ctrl+Shift+B) avant de chercher un bug.

24. **Vérifier que le fichier envoyé est bien celui qu'on a édité.** Une
    modification faite puis non recopiée dans l'envoi a produit un
    `centreVec` manquant, donc un écran blanc, donc une demi-heure de
    recherche à côté. Comparer les copies avant d'envoyer.

---

## 6. L'algorithme actuel

**Une porte, puis une croyance — et la chance qu'on porte sur soi.**

```
présence = Soleil × ( wM·Météo + wL·Légende )
         + wC · Chance · flaque · max(Soleil, fuite · wC)
           avec wM + wL + wC = 1
```

**La porte, exacte.** Le soleil doit se tenir entre l'horizon et 42° ;
au-delà, le centre de l'arc passe sous l'horizon. `S = (1 − h/42)^1,3 ×
montée douce de 0° à 6,5°`, plafond ≈ 0,80. Elle reste exacte au degré
près, et **la météo comme la légende lui sont soumises sans recours**.

**Une SOMME à l'intérieur, pas un produit.** Avec un produit, un seul zéro
éteindrait tout.

**Les trois parts.**

- **Météo** — `1 − exp(−pluie × trouée/1,2 × 6)`. *À remplacer par
  Open-Meteo, voir §7.*
- **Légende** — plancher de 0,09 partout, relevé par le haut lieu le plus
  proche : `max(plancher, force × exp(−corde²/rayon²))`. Un **maximum**,
  pas une somme.
- **Chance** — un second bruit, plus lent (`×0,62`), seuillé serré à
  `smoothstep(0,46 · 0,76)`, **puis multiplié par la flaque**.

**LA FLAQUE** — `LUCK_NEAR = 8°`, `LUCK_FAR = 30°`, gaussienne sur la corde
au réticule, même forme que les hauts lieux. Vaut 1 au réticule, toujours.

**LA FUITE** — `SPILL_AMP = 0,42`, `SPILL_DEG = 18°`. Pleine au bord de la
fenêtre, éteinte dix-huit degrés plus loin. Coïncidence commode : ces
bornes tombent sur −17,6° et 60°, exactement le cadre que l'héliodon se
donnait déjà.

`GAIN = 1,8`, puis `field = t^1,15 × 0,98 × uTache`, puis les trous.

**Une croyance FINIE, en simplexe.** Pousser un curseur pousse
**physiquement** les deux autres. Voir `pushBelief` dans `src/panel.js`.

### Le piéton

Voir §4. La même figure au repos est dans le panneau (`<svg class="walker">`
d'`index.html`) — **elle ne marche pas**, et ses coordonnées sont exactement
la pose de repos de `walkerGait(π/2)`. Changer l'un, changer l'autre.

### Le panneau

| Registre | Ce qu'il fait |
|---|---|
| ESTIMATEUR | position, heure, héliodon, présence |
| CROYANCE | les trois curseurs en simplexe |
| LÉGENDES | les pastilles, ce qu'on dit du lieu, **et d'où ça vient** |
| RÉGLAGES | quatre sous-registres — mémorisé dans `localStorage` |

**Les réglages, par sous-registre :**

| groupe | curseurs |
|---|---|
| la tache | intensité · couleur · franges · trous · finesse · dégradé |
| le fond | terres · mer |
| le panneau | transparence · contraste · texte · icônes · point |
| le temps | vitesse |

`view.look` porte : `sat`, `tache`, `grey`, `icon`, `sea`, `land`, `fine`,
`holes`, `franges`, `dot`.

**La clé de stockage porte un numéro** (`estimateur.reglages.2`). Quand un
défaut doit s'imposer, on incrémente. Elle n'a pas été incrémentée en
septembre : les nouveaux curseurs prennent leur valeur d'usine, les anciens
réglages de l'auteur survivent.

**Le passé est recalculé, pas mémorisé** — `src/history.js`, 320 points,
axe du temps **logarithmique**. La flaque n'y apparaît pas : on est au
réticule, elle y vaut 1.

**Les poids sont appliqués au dessin**, pas à l'échantillonnage. C'est
aussi pourquoi `spill` est rangé brut dans les échantillons.

**Le dégradé de gris est un ENCODAGE, pas une teinte en moins** : six
paliers plus une **trame de Bayer 8×8** à la résolution de l'affichage.
C'est littéralement ce que fera le tramage de l'e-ink. En dégradé,
*couleur* et *franges* s'éteignent.

### La profondeur d'encre des aplats

Le papier ne bouge pas, c'est le palier le plus profond qu'on charge.
**Le milieu du curseur est le tirage d'origine.** Tirer toute la gamme vers
le blanc rapprocherait les paliers, et la marche entre deux altitudes —
qui est toute la lecture du relief — se perdrait. `INK_MAX` : 2,4 pour les
terres, 4,0 pour la mer (sa gamme est deux fois plus courte).

---

## 7. Prochaine étape : brancher la vraie météo

**L'obstacle** n'est pas la donnée, c'est sa forme. La carte calcule un champ
continu ; Open-Meteo répond par points.

```
Open-Meteo ──► script ──► weather.png (quelques Ko) ──► la page ──► le shader
```

- grille **5°** = 2 592 points · trois variables · deux passages par jour =
  **5 200 appels**, sous le plafond gratuit de 10 000/jour
- image : 72 × 36 cases, 48 pas de temps en damier, trois canaux
- **GitHub Actions**, `cron` deux fois par jour, le script recommite le PNG
- une ligne du shader : `fbm(...)` devient `texture(uWeather, ...)`

**Deux points d'attention :** 5° font 550 km, garder le bruit fractal comme
texture haute fréquence par-dessus ; la résolution doit rester une constante
unique. Open-Meteo est en **CC-BY 4.0** — crédit obligatoire.

**Et le curseur change de nature** : il fera défiler la prévision réelle sur
48 heures.

---

## 8. Ce qui reste, par ordre

**A — Esthétique web** (en cours)

*Jamais fait, validé mais non écrit :*
- **La feuille du bas pour le 9:16.** Sur smartphone le panneau mange la
  carte. Parti retenu : le panneau devient une feuille du bas repliée à une
  seule ligne (position + présence), qu'on tire pour déplier par-dessus la
  carte. Le mécanisme de pli existe déjà. Fichiers : `style.css` (media
  query) et `src/panel.js` (l'emprise + le geste). `index.html` ne bouge
  pas.

*À juger à l'écran :*
- Figer les défauts de **trous**, **finesse** et **franges**.
- Retirer `earth.jpg` et la touche `r` une fois le choix arrêté (−3,9 Mo).
- Le noir de la trame de Bayer est à 0,20. Descendre à 0,12 ?
- `#box-est` fait 33 vh. À revoir sur le 10,3″ réel, qui sera en 4:3.
- Les vingt pastilles occupent beaucoup de place. Index de l'œuvre, ou
  outil de navigation ?

*Question ouverte, devenue plus pressante :*
- **Le grain est-il de la matière (shader seul) ou de la donnée (les deux) ?**
  Il n'existe que dans le shader, et il vient d'être triplé : le chiffre
  sous le réticule décrit encore moins bien le pixel à ×32. À ×32 les cinq
  observateurs d'une même zone disent presque la même chose ; s'il était
  aussi dans `index()`, les cinq chiffres divergeraient.

**A bis — Les légendes** — voir `LEGENDES.md`, qui tient le détail.

État : **10 entrées sourcées sur 20**. Wikipédia s'est révélée utile *comme
index de sources*, pas comme source.

Six phrases ont une source qui dit **autre chose qu'elles** — laissées
intactes, `src: null`, à trancher :
- **Amazonie** : Valadeau et al. (2010) documente chez les Yanesha l'arc
  comme **esprit malin** — fausses couches, maladies de peau, on ferme la
  bouche en le voyant. Bien plus fort que le serpent générique actuel.
- **Mānoa** : Ānuenue est messagère des dieux Kāne et Kanaloa, pas du
  passage des esprits.
- **Plaine slave** : le motif de l'arc qui boit l'eau est **letton**
  (Šmits 1936). Le point devrait remonter vers 25° E / 57° N.
- **Cusco** : l'interdit de pointer du doigt reste introuvable côté
  académique. L'*amaru* et Illapa, eux, sont sourcés.
- **Connemara** : le chaudron est de la culture populaire moderne, sans
  référence savante — y compris chez Wikipédia. **Highlands** le redouble.
- **Aotearoa** : la phrase tient finalement (Best 1982), c'est Te Ara qui
  était muet.

Plus huit pistes sourcées qui combleraient les trous de la liste (Ashanti,
Fang, Albanie, Malaisie, Philippines, Nicaragua, Mésopotamie, Muisca).

**B — Données réelles** — voir §7.

**C — Interaction du tableau**
Joystick : navigation par sauts · bouton : déposer un indice · où vivent
ces dépôts.

**D — Pipeline e-ink**
Rendu serveur → PNG 1872×1404 en 16 gris · le tramage peut remettre en
cause tout le A.

**E — Matériel — tranché en septembre 2026**

- **Raspberry Pi 4 minimum.** Le Zero, le Zero 2 W et le Pi 3 sont en
  VideoCore IV, OpenGL ES 2.0 : le shader est en WebGL 2, il ne compilera
  pas. Le Pi 4 est conforme ES 3.1 (certifié Khronos), le Pi 5
  confortablement. **Attention** : les fiches produit annoncent la
  compatibilité Zero — c'est vrai pour le HAT, qui ne fait que recevoir un
  bitmap, pas pour le calcul.
- **Écran : 10,3″ monochrome 16 gris**, 1872×1404, contrôleur IT8951,
  USB/SPI/I80. **GC16 en moins d'une seconde**, partiel supporté, **mode A2
  à ~7 fps en 2 niveaux**. 1,2 W en rafraîchissement, 0,1 W en veille.
  C'est du 4:3, ce que le projet visait déjà.
- **Le 13,3″ Spectra 6 couleur est écarté** : 19 s de rafraîchissement
  complet, aucun partiel, et six encres fixes qui détruiraient l'irisation.
  C'est un écran d'affichage d'images, pas d'interaction.
- **Idée d'interaction née de là** : se déplacer en **A2** (le piéton, le
  réticule, les traits de côte sont déjà du trait noir) et **se poser en
  GC16** quand le joystick est relâché. La trame de Bayer parle déjà le
  1 bit.
- Les « 180 s entre deux rafraîchissements » des fiches Waveshare sont du
  texte de gabarit recopié sur toute la gamme, à côté d'une démo à 7 fps.
  Précaution de durée de vie, pas limite technique. À vérifier sur pièce.

---

## 9. Manipulations

**Tester en local** — le double-clic ne marche pas (pièges n°3 et 15) :

```bash
cd "C:\00 - CREATIONS\RAINBOW ESTIMATEUR\GIT\rainbow"
python serve.py
```

puis `http://localhost:8000`. **Pas `python -m http.server`** (piège n°16).

**Vérifier le miroir** — après toute retouche à `src/sky.js` ou
`src/shader.js` :

```bash
node build/check_mirror.mjs
```

**Navigation** : glisser · molette · double-clic (×2) · flèches · `r`
(aplats ↔ relief ombré) · `0` (recentrer) · `f` (plein écran) · `?`
(explication) · Échap (fermer une feuille).

**Régénérer les données** : voir les scripts de `build/`, dans l'ordre
`make_field`, `make_terrain`, `make_texture`, `make_coast`, `make_cities`,
`bundle`.

---

## 10. Méthode de travail avec Claude

- Les fichiers sont modifiés **sur place, dans le dépôt**. Pas de zip. Il
  n'y a plus qu'à commiter et pousser.
- **Réponses courtes.** On discute avant de coder quand le sujet est
  ouvert.
- Claude **nomme le fichier avant d'y toucher** et ne relit pas tout le
  projet à chaque modification — l'architecture et la table du §2 sont
  faites pour ça.
- **Jamais de fichier binaire qui transite par Claude** : le transfert y
  insère un manifeste et corrompt les images.
- Après toute retouche à `src/sky.js` ou `src/shader.js` :
  `node build/check_mirror.mjs`.
- Pour vérifier : l'auteur lance `python serve.py`, Claude regarde
  `http://localhost:8000` dans le navigateur intégré. **Si le volet est
  masqué, `requestAnimationFrame` ne tourne pas et la page reste figée sur
  ses tirets — ce n'est pas une panne** (piège n°23).

---

## 11. Sources et crédits

- Projection **Equal Earth** — Šavrič, Patterson & Jenny (2018)
- Altitudes et bathymétrie — **ETOPO 2022**, NOAA NCEI
- Traits de côte, lacs, relief ombré — **Natural Earth** (domaine public)
- Météo à venir — **Open-Meteo**, CC-BY 4.0 (crédit obligatoire)
- Typographie — **Fragment Mono** (Google Fonts)
- Les sources des hauts lieux sont dans `src/legends.js`, entrée par
  entrée, et leur état dans `LEGENDES.md`
