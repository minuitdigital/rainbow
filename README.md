# Estimateur d'arcs-en-ciel

Une carte du monde en projection Equal Earth, sans frontières — seulement le
relief, les côtes et les fonds marins, en aplats de gris sur papier blanc. Des
taches irisées y marquent les endroits où un arc-en-ciel est sur le point
d'apparaître, et un petit arc gravé signale les plus probables.

Projet plus poétique que scientifique : une carte qui cherche, en temps réel,
les quelques points du globe où le ciel s'apprête à se plier.

## Navigation

| Entrée | Effet |
|---|---|
| glisser | tourner le globe, librement, sans butée |
| molette / pincement | zoom vers le curseur |
| double-clic | zoom ×2 (maj : ×0,5) |
| flèches | déplacement par pas |
| curseur du bas | vitesse du temps simulé — 0 fige tout |
| `r` | aplats ↔ relief ombré |
| `0` | recentrer |
| `f` | plein écran |

## L'algorithme

Trois conditions doivent se rencontrer au même endroit.

**La géométrie du soleil.** Il doit se tenir entre l'horizon et **42°** de
hauteur. Au-delà, le centre de l'arc — qui se trouve à l'opposé du soleil —
passe sous l'horizon et il n'y a plus rien à voir. Cette contrainte dessine un
anneau qui fait deux fois le tour de la Terre chaque jour, à l'aube et au
crépuscule. C'est la seule partie du calcul qui soit exacte aujourd'hui.

**Des gouttes.** De la pluie en train de tomber, ou qui vient de cesser.
Actuellement simulée par un bruit fractal cohérent sur la sphère, qui dérive
avec le temps.

**Une trouée.** Du soleil direct malgré l'averse — un ciel dégagé dans le dos
de l'observateur. C'est l'ingrédient rare, celui qui fait le tri. Approché ici
par une climatologie grossière : zone de convergence intertropicale, rails
dépressionnaires, prime aux littoraux.

L'indice affiché est le produit des trois. Reste à remplacer les deux derniers
par de vraies données météo horaires.

Un détail qui compte : un arc-en-ciel n'existe pas *à un endroit*, il existe
*pour un observateur*. Deux personnes côte à côte n'en voient pas le même. Les
taches ne marquent donc pas un phénomène, mais un point de vue possible.

## Les annotations

Une zone porte de une à cinq étiquettes selon sa taille à l'écran : une seule
vue de loin, jusqu'à cinq quand on a zoomé dedans. Ce ne sont pas cinq mesures
du même endroit mais cinq observateurs différents, et ils n'ont pas la même
chance — celui qui est sur la crête voit l'arc, celui du fond de la vallée non.

Chaque étiquette porte un pourcentage, une durée et une phrase.

Le **pourcentage** mêle ce que la carte affiche, le dégagement de l'horizon,
l'accessibilité du lieu — peut-on seulement être là ? — et une part de chance
qui oscille sans raison, propre à chaque point. C'est une valeur poétique,
faite pour osciller et déplacer le regard d'une zone à l'autre.

La **durée** est exacte. Elle ne dépend que du soleil : c'est le temps qu'il
reste avant qu'il ne monte au-dessus de 42° ou ne touche l'horizon. Une à deux
heures sous les tropiques, bien davantage près des pôles où il rase le sol.

La **phrase** dit ce qui porte le chiffre — *le soleil perce*, *l'averse
s'éloigne*, *depuis la crête*, *au hasard*. Et quand la zone est forte mais
déserte : *personne pour voir*.
