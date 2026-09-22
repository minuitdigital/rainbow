# Les hauts lieux — fiche de travail

> Vue à plat de `src/legends.js`, pour choisir et affiner. **Ce fichier ne
> tourne pas** : c'est `src/legends.js` qui fait foi. On décide ici, je
> reporte là-bas.
>
> Colonnes : **f** la force (0 à 1), **r** le rayon en degrés (1° ≈ 111 km).
> La colonne **?** est à toi : `ok`, `couper`, `revoir`, ou une note.

---

## Les vingt en place

| ? | nom | lon | lat | r | f | ce qu'il dit |
|---|---|---|---|---|---|---|
| | **Connemara** | −9,6 | 53,5 | 4,0 | 1,00 | Au pied de l'arc, le chaudron d'or du leprechaun. |
| | **Bifröst** | 9,0 | 61,5 | 7,0 | 0,95 | Le pont de flammes entre la terre et Ásgard. |
| | **Delphes** | 22,5 | 38,5 | 3,5 | 0,85 | Iris, messagère des dieux, descend par l'arc. |
| | **Kalevala** | 26,0 | 62,5 | 4,5 | 0,80 | La vierge de l'air tisse, assise sur l'arc. |
| | **Plaine slave** | 26,0 | 51,0 | 8,0 | 0,70 | L'arc boit l'eau des rivières et la rend en pluie. |
| | **Highlands** | −4,5 | 57,0 | 3,0 | 0,60 | Le même chaudron qu'en Irlande, de l'autre côté de la mer. |
| | **Ararat** | 44,3 | 39,7 | 4,0 | 0,90 | L'arc de l'alliance, posé après les eaux. |
| | **Indradhanush** | 78,0 | 25,0 | 8,0 | 0,95 | L'arc d'Indra, tendu quand la pluie cesse. |
| | **Nüwa** | 112,0 | 34,0 | 8,0 | 0,90 | Le ciel recousu avec des pierres de cinq couleurs. |
| | **Ame-no-ukihashi** | 137,0 | 36,0 | 4,0 | 0,85 | Le pont flottant du ciel, par où l'on descend. |
| | **Aido-Hwedo** | 2,3 | 7,0 | 4,0 | 0,95 | Le serpent arc-en-ciel porte le monde sur ses anneaux. |
| | **Oshumare** | 4,5 | 7,6 | 3,5 | 0,85 | Le serpent qui relie le ciel à la terre. |
| | **Drakensberg** | 29,5 | −29,0 | 5,0 | 0,70 | Le serpent descend boire à la rivière. |
| | **Terre d'Arnhem** | 133,5 | −12,5 | 7,0 | 1,00 | Ngalyod, le Serpent Arc-en-ciel, a creusé les gorges. |
| | **Aotearoa** | 175,5 | −39,0 | 5,0 | 0,90 | Uenuku : l'arc dit s'il faut partir ou rester. |
| | **Mānoa** | −157,8 | 21,3 | 2,5 | 0,95 | Ānuenue annonce le passage des esprits. |
| | **Dinétah** | −110,0 | 36,0 | 4,0 | 0,85 | L'arc-en-ciel porte les Êtres saints. |
| | **Cusco** | −72,0 | −13,5 | 5,0 | 0,90 | K'uychi — on ne montre pas l'arc du doigt. |
| | **Amazonie** | −60,0 | −3,0 | 7,0 | 0,80 | Le grand serpent des eaux se lève en arc. |
| | **Wallmapu** | −71,5 | −38,5 | 3,5 | 0,70 | Relmu porte un nom propre, et on le respecte. |

---

## Ce que la liste dit d'elle-même

**Elle penche vers l'Europe.** Six entrées sur vingt, pour un continent qui
n'a pas plus d'arcs-en-ciel que les autres. Et deux d'entre elles disent la
même chose (Connemara et Highlands, le même chaudron).

**Trois serpents sur quatre sont africains ou sud-américains**, et ils se
ressemblent à la lecture — porte le monde, relie le ciel, boit à la
rivière. Ce sont des traditions distinctes ; les phrases les aplatissent.

**Cinq traditions sont vivantes**, pas mythologiques au passé : terre
d'Arnhem, Aotearoa, Dinétah, Cusco, Wallmapu. Une ligne écrite de loin
leur rend mal service. C'est la réserve déjà notée en §8.

**Rien entre 60° et 180° de longitude au sud de l'équateur** — ni
Indonésie, ni Philippines, ni Mélanésie, alors que le serpent arc-en-ciel
y est partout.

---

## Trois questions à trancher

**1. Combien de points ?** Vingt font vingt pastilles dans le panneau, et
c'est déjà beaucoup de place. Trente seraient un atlas, douze un parti
pris. La question posée en §8 tient toujours : les pastilles sont-elles un
index de l'œuvre, ou un outil de navigation ?

**2. Une seconde famille ?** Les lieux où l'arc est *physiquement* chez
lui — Mosi-oa-Tunya, Hilo, les chutes du Niagara. Ce n'est pas de la
légende, c'est de la météo locale. Ça brouillerait peut-être le mot, ou ça
donnerait à la carte un second registre : ce qu'on raconte, et ce qui
arrive vraiment.

**3. Le ton des phrases.** Aujourd'hui elles décrivent. Celles qui
fonctionnent le mieux à l'écran sont celles qui **s'adressent** —
« on ne montre pas l'arc du doigt », « l'arc dit s'il faut partir ou
rester ». Les autres résument un mythe, et un résumé de mythe n'est
jamais beau.

---

## Candidats, si on élargit

À prendre ou à laisser — je ne les ai pas ajoutés au code.

| région | piste | pourquoi |
|---|---|---|
| Mélanésie | Papouasie, Vanuatu | le serpent y est central, et le trou est béant |
| Indonésie | Sulawesi, Java | l'arc comme escalier des dieux vers la terre |
| Sibérie | Bouriatie, Iakoutie | l'arc boit l'eau — même motif que la plaine slave |
| Andes du nord | Colombie, Équateur | Cusco porte seul tout un continent |
| Afrique de l'Est | Éthiopie, Grands Lacs | rien entre le Bénin et le Drakensberg |
| Arctique | Groenland, Nunavut | l'arc et les aurores comme même phénomène |
| Caraïbes | Haïti, Jamaïque | Ayida-Wedo, l'autre moitié d'Aido-Hwedo |

---

## Sourçage — état au 20 septembre 2026

Première passe. **6 entrées sur 20 sont rattachées à une référence
institutionnelle**, les 14 autres non. La carte l'affiche : un « ? » en
appel de note quand on peut ouvrir la source, un « ° » en cercle pointillé
quand rien n'est établi.

| état | entrée | référence |
|---|---|---|
| ✓ | Bifröst | Encyclopædia Britannica |
| ✓ | Delphes | Encyclopædia Britannica |
| ✓ | Nüwa | Encyclopædia Britannica |
| ✓ | Aido-Hwedo | Oxford Reference |
| ✓ | Terre d'Arnhem | Art Gallery of South Australia |
| ✓ | Aotearoa | Te Ara, encyclopédie de Nouvelle-Zélande |
| — | Connemara, Kalevala, Plaine slave, Highlands | |
| — | Ararat, Indradhanush, Ame-no-ukihashi | |
| — | Oshumare, Drakensberg | |
| — | Mānoa, Dinétah, Cusco, Amazonie, Wallmapu | |

### Trois choses trouvées qui demandent une décision

**Aotearoa.** Te Ara atteste Uenuku comme forme personnifiée de l'arc, avec
Kahukura et Haere, et donne āniwaniwa et āheahea comme noms courants. En
revanche **la page ne dit rien de l'arc comme signe de partir ou rester**.
La phrase actuelle affirme donc plus que sa source. À réécrire ou à
resourcer.

**Connemara.** Le chaudron d'or au pied de l'arc-en-ciel est une
association populaire moderne, largement anglo-américaine, pas un motif de
la mythologie irlandaise ancienne. Rien trouvé qui la rattache à une
tradition attestée. Et **Highlands** ne fait que la redoubler.

**Cusco.** L'interdit de montrer l'arc du doigt revient partout — et
uniquement sur des sites de voyage et de tourisme spirituel. Aucune source
académique ou institutionnelle trouvée dans cette passe. C'est exactement
le profil d'une croyance vraie mal sourcée, ou d'une invention recopiée ;
impossible de trancher sans chercher côté ethnologie andine.

### Ce que la source atteste, et ce qu'elle n'atteste pas

Une référence valide **le nom et l'existence de la tradition**. Elle ne
valide pas la phrase, qui est une réécriture d'auteur. La bulle le dit en
toutes lettres — sans quoi Britannica se retrouverait à cautionner une
formulation qui n'est pas la sienne.

### Prochaine passe

Les cinq traditions vivantes sont l'urgence : terre d'Arnhem (sourcée),
Aotearoa (à corriger), Dinétah, Cusco, Wallmapu. Pour celles-là, viser des
sources communautaires ou institutionnelles du pays concerné plutôt qu'une
encyclopédie généraliste.

---

## Comment on procède

Remplis la colonne **?** et corrige les phrases directement dans le
tableau. Tu peux aussi barrer, réécrire, ajouter des lignes — c'est un
brouillon, pas un formulaire. Je reporte ensuite dans `src/legends.js`.

Si tu changes une **force** ou un **rayon**, la carte change de visage :
`f` décide de l'intensité au centre, `r` de la portée. Deux points forts
et proches se font concurrence — c'est un maximum, pas une somme, donc le
plus faible disparaît purement et simplement.
