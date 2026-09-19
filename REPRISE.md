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
                    field.png ─┐
                    earth.jpg ─┤
                     mask.png ─┼──► shader WebGL 2 ──► <canvas id="gl">
                   terrain.js ─┘     (reprojection            │
                                      par pixel)              │
                     coast.js ──────► canvas 2D ──────► <canvas id="ink">
                                      (côtes,                 │
                                       étiquettes)            ▼
                                                        la page
```

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

| Fichier | Taille | Rôle |
|---|---|---|
| `index.html` | ~47 Ko | tout : shader, projection, navigation, estimation, étiquettes |
| `field.png` | 8 Mo | champ hypsométrique 8192×4096 — 0 fosses, 0,5 côte, 1 sommets |
| `earth.jpg` | 3,9 Mo | carte d'**ombres** 8192×4096 (voir piège n°5) |
| `mask.png` | 48 Ko | coefficient de surface mer / littoral / intérieur, 720×360 |
| `coast.js` | 888 Ko | traits de côte et lacs, Natural Earth 1:50 m, ~55 000 points |
| `terrain.js` | 86 Ko | accessibilité + dégagement de l'horizon, 1 octet par degré carré |
| `README.md` | — | présentation publique : résumé, navigation, algorithme |

### Les scripts de génération (`build/`, inutiles en ligne)

| Script | Produit |
|---|---|
| `make_field.py` | `field.png` depuis ETOPO 2022 |
| `make_texture.py` | `earth.jpg` + `mask.png` depuis le relief ombré Natural Earth |
| `make_terrain.py` | `terrain.js` depuis ETOPO + masque terre/mer |
| `make_coast.py` | `coast.js` depuis les vecteurs Natural Earth |
| `eqearth.py` | formules de la projection, utilisé par les autres |

`index.html` est **le fichier de référence**. Quand la page est publiée en
Artifact Claude, une version sans `<html>`/`<head>` en est dérivée — c'est un
intermédiaire, jamais une source à éditer.

### Les sources (non incluses, à retélécharger si besoin)

- **ETOPO 2022, 60 arc-secondes, surface de la glace** — `ETOPO_2022_v1_60s_N90W180_surface.tif`, 444 Mo, sur le site du NCEI (NOAA). Prendre `surface`, pas `bed`.
- **Natural Earth** — `ne_50m_land`, `ne_50m_lakes` en GeoJSON, depuis `raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/`
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

---

## 6. L'algorithme actuel

Trois conditions doivent se rencontrer au même endroit.

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
Densité et intensité des taches · nombre de cycles dans l'irisation · détail
des côtes au-delà de ×6 (Natural Earth 1:10 m, ×3 plus lourd) · format cible
4:3 pour coller au 10,3" · retirer `earth.jpg` et la touche `r` une fois le
choix arrêté (−3,9 Mo).

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

**Tester en local** — le double-clic ne marche pas (voir piège n°3) :

```bash
cd "C:\00 - CREATIONS\RAINBOW ESTIMATEUR\WEB"
python -m http.server 8000
```

puis `http://localhost:8000`

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
