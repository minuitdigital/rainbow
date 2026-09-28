# Estimateur d'arcs-en-ciel

Une carte du monde où s'allument les endroits sur le point de voir
paraître un arc-en-ciel.

C'est une œuvre, pas un produit : un tableau d'aluminium brossé qui porte
un écran, des curseurs et des boutons sous la main du spectateur. Ce dépôt
en contient la carte, qui tourne aussi dans un navigateur :
<https://minuitdigital.github.io/rainbow/>

Le sujet est poétique avant d'être scientifique. Mais le calcul repose
sur de vraies prévisions météo. La carte estime, elle ne prédit pas.

## La carte

Projection **Equal Earth** : chaque pays y garde sa surface réelle. Pas de
frontières, des villes. Le relief et les fonds marins en aplats de gris,
sur papier blanc.

Là où un arc peut paraître, une **tache** irisée s'allume. Sa teinte ne
code rien ; c'est son intensité qui dit la force.

## Le calcul

**La porte.** Le soleil doit se tenir entre l'horizon et 42°. Au-delà, le
centre de l'arc passe sous l'horizon et il n'y a rien à voir. Cette seule
contrainte dessine un anneau qui fait le tour de la Terre deux fois par
jour, à l'aube et au crépuscule. C'est la seule partie exacte du calcul.

**La croyance.** La porte ouverte, trois raisons d'y croire se partagent
le reste, et leur somme fait toujours 100 % :

- **météo** — la pluie du voisinage, et la **trouée** : le rayonnement
  direct qui arrive au sol. On ne voit pas d'arc sous l'averse, on le voit
  à côté d'elle, quand le soleil passe.
- **légende** — la foi attachée au lieu. Partout on y croit un peu ; vingt
  **hauts lieux** beaucoup.
- **chance** — ce que le spectateur porte sur lui. Elle ne vaut qu'autour
  du **piéton**, dans une **flaque** qui s'élargit à mesure qu'on y croit.
  Là seulement, la porte fuit : un arc peut s'allumer sans aucune raison.

Le chiffre que la carte peint s'appelle la **présence**, de 0 à 1.

## La météo

Le **relevé** vient d'Open-Meteo : pluie et rayonnement direct, sur une
maille de 4°, 96 heures au pas de 3 heures, d'hier à après-demain. Un robot
le relève trois fois par jour et le publie comme un fichier image. La page
ne fait aucun appel à un service : elle lit ce fichier.

## Les hauts lieux

Vingt endroits où l'on croit beaucoup à l'arc-en-ciel. Chacun dit sa
croyance quand on s'approche, et chacun dit d'où elle vient. Quand rien
n'est établi, la carte l'écrit : « sans source ».

## Les étiquettes

Une tache porte de une à cinq étiquettes. Ce sont cinq observateurs, pas
cinq mesures : un arc-en-ciel n'existe pas *à un endroit*, il existe *pour
quelqu'un*.

Chaque étiquette porte un pourcentage, volontairement poétique ; une durée,
exacte — le temps avant que le soleil ne sorte de la porte ; une phrase,
qui dit ce qui porte le chiffre ; et la ville la plus proche, dans un rayon
de 300 km. Au-delà, rien n'est écrit : au milieu du Pacifique, il n'y a
personne, et c'est une information.

## Se déplacer

| | |
|---|---|
| glisser | tourner le globe, sans butée |
| molette | zoom vers le curseur, jusqu'à ×32 |
| double-clic | zoom ×2 |
| flèches | déplacement par pas |
| `0` | recentrer |
| `f` | plein écran |
| `?` | l'explication |
| Échap | fermer une feuille |

## Ouvrir la page chez soi

Un double-clic sur `index.html` ne suffit pas : il faut un serveur.

```bash
python serve.py
```

puis <http://localhost:8000>. Pas `python -m http.server`, dont le cache
mélange les versions.

## Sources et crédits

- Projection **Equal Earth** — Šavrič, Patterson & Jenny (2018)
- Altitudes et bathymétrie — **ETOPO 2022**, NOAA NCEI
- Traits de côte, lacs, lieux habités — **Natural Earth**
- Pluie et rayonnement direct — [Weather data by Open-Meteo.com](https://open-meteo.com/),
  licence CC-BY 4.0
- Typographie — **Fragment Mono**
- Les sources des hauts lieux sont dans `src/legends.js`, lieu par lieu
