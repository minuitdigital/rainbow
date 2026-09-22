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
                data/mask.png ─┼──► src/shader ──► src/map ──► <canvas id="gl">
             data/weather.png ─┘   (relevé par un robot, une fois par jour)                                      │
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
src/weather.js     ← rien                     LA GRILLE MÉTÉO : chargement, fraîcheur, lecture
src/sky.js         ← projection, legends, weather   soleil, pluie, flaque, fuite
src/ground.js      ← projection, données      terrain, villes, plus proche lieu
src/view.js        ← projection, weather      LE seul module qui se souvienne
src/history.js     ← view, sky                les 24 h passées, RECALCULÉES
src/zones.js       ← sky, ground, view        ce qui vit d'une image à l'autre
src/shader.js      ← rien                     le GLSL, rien d'autre
src/map.js         ← view, shader, sky, weather   contexte WebGL, textures, une image
src/ink.js         ← projection, view, zones, ground   le calque 2D
src/panel.js       ← view, sky, history, map, weather, ink   les cinq registres
src/chrome.js      ← projection, view         la main : glissé, molette, touches
src/main.js        ← tous                     l'assemblage et la boucle
```

### Où agir — la table de correspondance

Pour ne pas relire tout le projet à chaque modification :

| Ce qu'on veut changer | Le fichier, et lui seul |
|---|---|
| une croyance, un lieu, une phrase, **une source** | `src/legends.js` |
| **d'où vient la météo** — la source, la maille, les variables | `build/make_weather.py`, **et lui seul** |
| la lecture de la grille météo, sa fraîcheur | `src/weather.js` |
| ce que la page coûte, les deux machines | `src/view.js` (`RIGS`, `beat`) + `src/panel.js` |
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
| l'état : zoom maximal, vitesse, allure, **la marche**, **l'horloge** | `src/view.js` |
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
| `src/weather.js` | la grille Open-Meteo : chargement, fraîcheur, lecture |
| `src/sky.js` | la porte du soleil, la croyance, la flaque, la fuite |
| `src/ground.js` | relief accessible, villes, plus proche lieu |
| `src/view.js` | où l'on regarde, de quelle distance, quand, de quelle allure, **et la foulée** |
| `src/history.js` | les 24 dernières heures sous le réticule, recalculées |
| `src/zones.js` | détection des taches, suivi, les cinq observateurs |
| `src/shader.js` | le GLSL, rien d'autre |
| `src/map.js` | contexte WebGL, textures, une image |
| `src/ink.js` | le calque 2D, le piéton du réticule, la liste d'encombrement |
| `src/panel.js` | les cinq registres, la provenance, et les notes |
| `src/chrome.js` | la main : glissé, molette, touches, feuille d'explication |
| `src/main.js` | l'assemblage et la boucle d'images |

Généré, dans `data/` : `field.png` (8 Mo), `mask.png` (48 Ko),
`coast.js` (888 Ko), `cities.js` (118 Ko), `terrain.js` (86 Ko).

Et **`weather.png`** (~500 Ko), relevé par le robot une fois par jour.
Celui-là n'est PAS dans le dépôt : il est fabriqué à chaque publication et
publié directement. Voir §7 — c'est la seule exception du `.gitignore`, et
elle a sa raison.

`earth.jpg` a été retiré en septembre 2026 : 3,9 Mo pour creuser les
versants de 14 %, et la touche « r » qui allait avec.

### Les documents

| Fichier | Rôle |
|---|---|
| `README.md` | présentation publique |
| `REPRISE.md` | ce fichier |
| `LEGENDES.md` | **fiche de travail des hauts lieux** : les vingt à plat, l'état du sourçage, les corrections que la recherche impose, les pistes d'élargissement. Ne tourne pas — `src/legends.js` fait foi. |

### Les scripts (`build/`, inutiles en ligne)

`make_field.py`, `make_texture.py`, `make_terrain.py`, `make_coast.py`,
`make_cities.py`, `eqearth.py`, `bundle.py` (recolle `dist/index.html`),
et **`check_mirror.mjs`** — vingt et une règles, voir piège n°19.

Plus deux venus avec la météo :

- **`make_weather.py`** — le relevé mondial. Tourne sur le robot, une fois
  par jour. `python build/make_weather.py 12` prend une maille de douze
  degrés en une minute : de quoi vérifier toute la chaîne sans attendre le
  quart d'heure du relevé complet.
- **`probe_s3.py`** — un sondage du dépôt AWS d'Open-Meteo, qui ne fabrique
  rien et ne décide de rien. Il sert à savoir si l'on pourra un jour
  abandonner l'API par points. Voir §7.

`.github/workflows/meteo.yml` tient le robot. **Le pont vers l'ordinateur
de l'auteur interdit d'écrire dans ce dossier** — c'est une protection, pas
une panne : un fichier posé là s'exécute sur les serveurs de GitHub. Claude
le dépose donc dans `build/` et l'auteur le déplace.

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

**Quatorze modules, dépendances à sens unique**, noms uniques.

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

**LA MÉTÉO EST VRAIE.** Le bruit fractal a cédé la place à Open-Meteo :
`precipitation` et `direct_radiation`, relevés une fois par jour sur toute
la Terre et versés dans une image que la page lit comme elle lit
`field.png`. Le tableau ne fait AUCUN appel réseau vers un service — il
télécharge un fichier statique. Voir §7.

**ET LA CARTE EN EST ALLÉE PLUS VITE.** `rain` était un `fbm` de trois
octaves, soit vingt-quatre hachages par pixel ; c'est devenu deux lectures
de texture. Côté JavaScript, `meteoAt` est appelé 321 fois par `recall` et
2 300 fois par balayage — un tableau au lieu d'un bruit fractal, c'est cent
fois moins cher. Brancher de vraies données a ALLÉGÉ la pièce, ce qui
n'allait pas de soi.

**LA TROUÉE N'EST PLUS UNE INVENTION.** Deux gaussiennes sur la latitude
décrétaient qu'il fait beau sous les tropiques et sur les rails
dépressionnaires. C'était joli et c'était faux. Le rayonnement DIRECT reçu
au sol, rapporté à ce qu'un ciel parfaitement clair donnerait à cette
hauteur de soleil, dit littéralement si des rayons non interceptés
arrivent ici — la condition même d'un arc-en-ciel. En mode météo, le
masque littoral disparaît : il rattrapait la climatologie inventée, il n'y
a plus rien à rattraper. La mer s'allume donc pour de bon, et les
étiquettes disent déjà qu'il n'y a personne pour voir.

**LA PLUIE EST CELLE DU VOISINAGE**, dilatée d'une case par le script. On
ne voit pas d'arc DANS l'averse : on est dessous, il pleut, le ciel est
gris. On le voit à côté.

**DEUX HORLOGES, UNE SEULE À LA FOIS.** `dev` invente un temps que le
curseur multiplie jusqu'à cent mille ; `météo` suit l'heure réelle et le
curseur devient un *quand*, de −24 h à +48 h. Les deux vont ensemble : un
temps inventé ne peut pas aller chercher une prévision, et une prévision ne
se laisse pas accélérer. En météo la boucle d'images ne tourne QUE toutes
les dix secondes — le soleil avance de quatre centièmes de degré pendant ce
temps, et un Raspberry Pi n'a pas à chauffer pour ça.

**LE RELIEF OMBRÉ EST PARTI**, `earth.jpg` et la touche « r » avec lui. Le
lustre creusait les versants de 14 % pour 3,9 Mo, une texture de 8192
pixels en mémoire et une lecture de plus par pixel. Les terres sont des
aplats purs, à bords calculés, nets à toute échelle.

**UN CINQUIÈME SOUS-REGISTRE : *performance*.** Images par seconde, temps
du shader mesuré par le pilote, temps JavaScript détaillé en trois postes,
pixels réels. Chaque ligne porte un « ? » qui dit ce qu'elle mesure ET ce
qui la fait monter — un chiffre en millisecondes ne dit rien tout seul, et
sans savoir d'où il vient on optimise au hasard.

**DEUX MACHINES, choisies à la main.** `laptop` et `mini` : le plafond de
pixels réels passe de 2 à 1 par pixel de page — quatre fois moins de
travail pour le shader — le balayage des zones s'élargit de 30 à 44 px, et
s'espace de 200 à 320 ms. Manuel et mémorisé : une détection automatique
aurait changé le rendu sans le dire, et sur une œuvre on ne veut pas d'un
tableau qui se règle dans notre dos.

**DEUX CASES PLUTÔT QU'UNE À COCHER**, pour l'horloge comme pour la
machine. Avec une seule, il faut se souvenir de ce que « coché » voulait
dire ; avec deux, on lit ce qu'on a choisi.

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

25. **PAS DE PRÉCISION PAR DÉFAUT POUR LES ÉCHANTILLONNEURS EN TABLEAU.**
    `precision highp float;` couvre les flottants, et `sampler2D` s'en
    tire avec une précision implicite — mais `sampler2DArray`,
    `sampler3D` et leurs variantes entières exigent la leur,
    explicitement. Sans elle le shader ne compile pas.

        precision highp sampler2DArray;

    Le symptôme est un **écran NOIR**, pas blanc : le canvas a
    `alpha: false`, il reste noir tant que rien n'y est dessiné. Attrapé
    en une seconde par `glslangValidator`, jamais à l'œil — voir §10.

26. **LA VEILLE A UN ANGLE MORT.** Elle attrape les modules qui ne se
    chargent pas, parce qu'elle attend `window.__rainbow`. Mais ce drapeau
    est posé AVANT `initMap` : tout ce qui échoue après lui échoue en
    silence, exactement comme au piège n°14 mais sans le filet. C'est ce
    qui a rendu le piège n°25 muet. **À combler** — voir §8.

27. **UN HORODATAGE SANS FUSEAU EST UNE HEURE LOCALE**, en JavaScript.
    C'est la norme, et c'est un piège : Open-Meteo rend
    `2026-09-21T00:00` même interrogé en `timezone=UTC`, et `Date.parse`
    le lit alors décalé du fuseau du spectateur. Zéro à Londres, deux
    heures à Paris, neuf à Tokyo. La carte serait juste chez les uns et
    fausse chez les autres, ce qui est la pire façon de s'en apercevoir.
    Le script pose le `Z` ; `utcOf()` dans `weather.js` est la ceinture.

28. **DEUX HORLOGES DANS LA MÊME BOÎTE, ET TOUTES LES DEUX SINCÈRES.**
    `elapsedHours()` a été réécrit pour lire l'heure réelle en mode météo,
    mais `simDate()` est resté branché sur `simH` — l'horloge accumulée du
    mode dev, qui avait couru à ×3 981 avant le basculement. Le panneau et
    le shader lisaient l'une, `recall` et le balayage lisaient l'autre.
    Le symptôme était retors : un héliodon affichant la bonne hauteur de
    soleil, juste au-dessus d'une pendule avançant de six heures.
    **Une seule source d'heure, et c'est `elapsedHours`.**

29. **OPEN-METEO COMPTE UN APPEL PAR COORDONNÉE**, quoi qu'en dise sa
    formule. La documentation publie *poids = nLieux × (nJours/14) ×
    (nVariables/10)*, ce qui ferait 0,057 appel par point ; le compteur
    réel monte d'environ un. Un lot de 400 points passe, le suivant se
    fait refuser trois secondes plus tard. D'où :

        10 000 appels/jour  ->  10 000 points au maximum
        600 appels/minute   ->  600 points par minute, incompressible

    C'est ce qui borne la maille à 3°. Le plancher n'est écrit nulle part ;
    il se découvre en se prenant des 429.

30. **L'URL A UNE LONGUEUR MAXIMALE.** Mille coordonnées font douze mille
    caractères et le serveur répond 414. La limite usuelle est de huit
    mille. `fetch` coupe désormais le lot en deux tout seul plutôt que de
    retenter à l'identique — réessayer une URL trop longue ne la raccourcit
    pas.

31. **GITHUB REFUSE LES `../` DANS SON ÉDITEUR**, et le pont vers
    l'ordinateur de l'auteur refuse d'écrire dans `.github/workflows/`.
    Les deux sont des protections, pas des pannes. Pour déplacer le robot,
    deux lignes dans le terminal du dépôt :

        mkdir .github\workflows
        move build\meteo.workflow.yml .github\workflows\meteo.yml

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

- **Météo** — `1 − exp(−pluie × trouée/1,2 × 6)`, et les deux termes
  sont désormais MESURÉS. `pluie` est la précipitation du voisinage,
  dilatée d'une case ; `trouée` vaut `0,14 + 1,66 × clarté`, où la clarté
  est le rayonnement direct rapporté à un ciel parfaitement clair. La
  remise à l'échelle garde exactement la course de l'ancienne formule,
  plancher compris : basculer de `dev` à `météo` ne change pas l'échelle
  de la carte, seulement ce qu'elle raconte.
  En mode `dev`, le bruit fractal et la climatologie inventée reprennent
  leur place — les deux branches vivent côte à côte dans `sky.js` et dans
  le shader, et **le miroir vérifie les deux**.
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
| RÉGLAGES | cinq sous-registres — mémorisé dans `localStorage` |

**Les réglages, par sous-registre :**

| groupe | curseurs |
|---|---|
| la tache | intensité · couleur · franges · trous · finesse · dégradé |
| le fond | terres · mer |
| le panneau | transparence · contraste · texte · icônes · point |
| le temps | **horloge** (dev / météo) · vitesse, qui devient *quand* |
| performance | les jauges, et **machine** (laptop / mini) |

**Le registre *performance* ne dit rien du ciel** : c'est un instrument
d'atelier, replié par défaut. Deux chronomètres, et il faut les deux —
`performance.now()` autour de `paint` ne mesure PAS le processeur
graphique, puisque `drawArrays` rend la main avant que le shader ait
commencé. Le vrai temps vient de `EXT_disjoint_timer_query_webgl2`, quand
le navigateur la donne ; un tiret veut dire qu'il la refuse, pas que c'est
gratuit. Règle de lecture : **images/s bas + javascript bas = c'est le
GPU**.

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

## 7. La vraie météo — FAIT

```
Open-Meteo ──► build/make_weather.py ──► data/weather.png ──► la page ──► le shader
      (une fois par jour, sur un robot GitHub)      (~500 Ko)
```

**Le tableau ne fait AUCUN appel vers un service.** Il télécharge un
fichier statique, comme il télécharge `field.png`, et le redemande toutes
les six heures. Pas de clé, pas de compte, pas de serveur. C'est ce qui
permet à l'objet de tourner des années sur un mur.

### Le relevé

- grille **3°** — 7 200 points, 72 % du quota quotidien, quatorze minutes.
  C'est le plafond de ce qu'Open-Meteo laisse prendre : voir piège n°29,
  qui a coûté une soirée.
- **96 heures** au pas de 3 h, soit 32 images : d'hier à après-demain. La
  marge est délibérée — si le robot rate un passage, le tableau tient
  encore le lendemain sans rien dire.
- deux variables : `precipitation` et `direct_radiation`. Pas la
  nébulosité — voir §4, la trouée.
- **Open-Meteo est en CC-BY 4.0**, crédit obligatoire. Il est dans la
  feuille d'explication, section « D'où viennent les données », avec le
  lien que la licence exige.

### Le fichier

Un atlas **VERTICAL** : 32 pas de temps empilés l'un sous l'autre,
120 × 1 920. Vertical et non en damier, pour une raison qui n'a l'air de
rien — chaque pas de temps y reste CONTIGU en mémoire, et la page n'a
qu'à découper le tableau de pixels en tranches. Un damier aurait demandé
trente-deux recopies ligne à ligne sur un Raspberry Pi.

**La ligne 0 est la latitude la plus au sud.** L'image paraît donc à
l'envers dans une visionneuse : c'est voulu. La page l'envoie telle quelle
au processeur graphique, sans retournement, et le shader lit
`v = (lat + 90) / 180`. La retourner « pour qu'elle soit jolie » mettrait
l'Australie au Groenland.

|  | ce que le canal porte |
|---|---|
| R | la pluie **du voisinage**, dilatée d'une case |
| G | la clarté directe |
| B | la pluie locale — les étiquettes, pas le shader |

### Le robot

`.github/workflows/meteo.yml`, une fois par jour à 4h10 UTC, plus à chaque
poussée sur `main`.

**IL NE COMMITE RIEN.** Le fichier change entièrement chaque jour, et git
ne sait pas compresser la différence entre deux PNG : il en garderait
chaque version en entier, soit environ 250 Mo par an, indéfiniment. Le
robot le fabrique, publie le site, et l'oublie. C'est la seule exception
du `.gitignore`, et c'est écrit dedans.

Un **cache** garde le dernier relevé d'une exécution à l'autre : un
déploiement Pages remplace TOUT le site, et pousser du code sans relever
la météo ferait repartir le site sans elle. Une poussée de code ne
consomme donc pas le quota — seuls le passage quotidien et un lancement
manuel interrogent Open-Meteo.

Ce qu'il faut régler une fois dans le dépôt :

- `Settings → Pages → Source` : **GitHub Actions**
- `Settings → Actions → General` : **Read and write permissions**

### Pour aller plus fin, un jour

3° font 333 km — plus grossier qu'une averse. Le bruit fractal joue
par-dessus comme texture haute fréquence, et c'était déjà le plan. Mais
pour faire mieux il faut une source qui livre des **grilles** et non des
points. Ce qui a été regardé :

- **ECMWF open data** — 0,25°, CC-BY, sans clé. Mais il ne contient ni
  rayonnement ni nébulosité : seulement `10u, 10v, 2t, msl, ro, skt, sp,
  st, stl1, tcwv, tp`. Pas de trouée possible. **Écarté.**
- **OPeNDAP de la NOAA** — aurait tout donné sans GRIB. **Retiré par la
  NOAA en septembre 2026.**
- **GRIB2 de GFS**, 0,25° natif — a tout ce qu'il faut, au prix d'une
  bibliothèque de décodage dont les paquets Windows sont « non testés ».
- **Le dépôt AWS d'Open-Meteo** (`s3://openmeteo`, anonyme, sans quota) —
  les mêmes données, en champs complets. `build/probe_s3.py` sert à savoir
  ce qu'il contient vraiment. **Piste ouverte.**

Un changement de source ne toucherait **que `make_weather.py`**. Le format
du fichier, `weather.js`, le shader et tout le reste n'en savent rien —
`weather.js` lit `nx` et `ny` dans le JSON. C'est exactement ce que la
table du §2 promet.

Et le bénéfice serait double : à partir d'une vraie grille, on prendrait
le **maximum de la pluie sur les cellules** d'une case au lieu d'un point
tiré au hasard dedans. C'est la dilatation qu'on fabrique déjà, mais
offerte par la donnée.


## 8. Ce qui reste, par ordre

**A — Esthétique web** (en cours)

*Jamais fait, validé mais non écrit :*
- **La feuille du bas pour le 9:16.** Sur smartphone le panneau mange la
  carte. Parti retenu : le panneau devient une feuille du bas repliée à une
  seule ligne (position + présence), qu'on tire pour déplier par-dessus la
  carte. Le mécanisme de pli existe déjà. Fichiers : `style.css` (media
  query) et `src/panel.js` (l'emprise + le geste). `index.html` ne bouge
  pas.

*Dette technique, mesurée mais pas encore payée :*
- **`recall()` est appelé à chaque image** par `refreshPanel`. 321 points
  × 2 bruits fractals × 3 octaves = ~15 000 hachages par image, pour un
  passé qui n'a pas changé. Une garde temporelle à 7 Hz suffirait.
- **`drawRings` reparcourt tout `COAST`** (888 Ko de lon/lat) par image, et
  refait `cos`/`sin` sur des vecteurs qui ne changent jamais. C'est la
  dépense n°1 au monde entier. Figer les vecteurs, décimer selon le zoom.
- **`cssOf()` appelle `getComputedStyle`** des dizaines de fois par image,
  ce qui force un recalcul de style à chaque appel. Un cache invalidé par
  le contraste, et c'est réglé.
- Le registre *performance* est là pour chiffrer tout ça avant et après.

*À juger à l'écran :*
- Figer les défauts de **trous**, **finesse** et **franges**.
- Le noir de la trame de Bayer est à 0,20. Descendre à 0,12 ?
- **Combler l'angle mort de la veille** — piège n°26. Déplacer
  `window.__rainbow` après `initMap`, ou envelopper le démarrage dans un
  `try` qui écrit ce qu'il attrape.
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

**B — Données réelles** — ~~à faire~~ **FAIT**, voir §7. Reste la
question de la maille : 3° est le plafond de l'API par points, et le dépôt
AWS d'Open-Meteo pourrait la faire tomber à 0,25°.

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

**Relever la météo** — quatorze minutes, 72 % du quota du jour :

```bash
python build/make_weather.py
```

`python build/make_weather.py 12` prend une maille de douze degrés en une
minute : la carte est inutilisable, mais toute la chaîne se vérifie.
Dépendances : `numpy`, `pillow`.

**Navigation** : glisser · molette · double-clic (×2) · flèches ·
`0` (recentrer) · `f` (plein écran) · `?` (explication) · Échap (fermer
une feuille).

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
- **Et après toute retouche au GLSL, le compiler avant de l'envoyer.**
  `node --check` ne voit qu'une chaîne de caractères ; le shader, lui, ne
  se plaint qu'à l'écran, et en silence (piège n°25). Claude dispose de
  `glslangValidator` : extraire `FRAGMENT`, l'écrire dans un `.frag`, le
  compiler. Une seconde, contre une demi-heure de recherche.
- **Le navigateur intégré n'atteint PAS le `localhost` de l'auteur** — ni
  en `localhost`, ni en `127.0.0.1` : l'accès est refusé. Le piège n°17
  reste vrai, mais c'est l'auteur qui regarde. Quand quelque chose cloche :
  **F12, onglet Console**, et coller les lignes rouges.
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
