// =========================================================================
//  LES HAUTS LIEUX DE LA CROYANCE
//
//  Écrit à la main, pas généré : c'est de la matière d'œuvre, pas un jeu
//  de données. À relire, tailler, compléter — les traditions vivantes
//  méritent mieux qu'une ligne, et une ligne est tout ce qu'on leur donne.
//
//  Partout on croit un peu à l'arc-en-ciel : c'est le PLANCHER, il vaut
//  pour tout le globe. Ces points-là sont les endroits où l'on y croit
//  beaucoup. Le curseur « Légende » décide du poids qu'on leur accorde.
//
//  Chaque entrée :
//    nom      ce qui s'affiche quand on s'approche
//    dit      la croyance, en une ligne
//    lon lat  le centre — approximatif, une croyance n'a pas de coordonnée
//    r        son rayon d'influence, en degrés
//    f        sa force, de 0 à 1
//
//  Le rayon est large exprès. Une tradition ne s'arrête pas à un village,
//  et un point trop net ferait croire à une mesure.
// =========================================================================

/** Ce à quoi l'humanité croit partout, faute de mieux. */
export const LEGEND_FLOOR = 0.09;

export const LEGENDS = [

  // ------------------------------------------------------------- Europe
  { nom: 'Connemara',   lon:  -9.6, lat:  53.5, r: 4.0, f: 1.00,
    dit: "Au pied de l'arc, le chaudron d'or du leprechaun." },

  { nom: 'Bifröst',     lon:   9.0, lat:  61.5, r: 7.0, f: 0.95,
    dit: 'Le pont de flammes entre la terre et Ásgard.' },

  { nom: 'Delphes',     lon:  22.5, lat:  38.5, r: 3.5, f: 0.85,
    dit: 'Iris, messagère des dieux, descend par l’arc.' },

  { nom: 'Kalevala',    lon:  26.0, lat:  62.5, r: 4.5, f: 0.80,
    dit: 'La vierge de l’air tisse, assise sur l’arc.' },

  { nom: 'Plaine slave', lon: 26.0, lat:  51.0, r: 8.0, f: 0.70,
    dit: 'L’arc boit l’eau des rivières et la rend en pluie.' },

  { nom: 'Highlands',   lon:  -4.5, lat:  57.0, r: 3.0, f: 0.60,
    dit: 'Le même chaudron qu’en Irlande, de l’autre côté de la mer.' },

  // -------------------------------------------------------------- Asie
  { nom: 'Ararat',      lon:  44.3, lat:  39.7, r: 4.0, f: 0.90,
    dit: 'L’arc de l’alliance, posé après les eaux.' },

  { nom: 'Indradhanush', lon: 78.0, lat:  25.0, r: 8.0, f: 0.95,
    dit: 'L’arc d’Indra, tendu quand la pluie cesse.' },

  { nom: 'Nüwa',        lon: 112.0, lat:  34.0, r: 8.0, f: 0.90,
    dit: 'Le ciel recousu avec des pierres de cinq couleurs.' },

  { nom: 'Ame-no-ukihashi', lon: 137.0, lat: 36.0, r: 4.0, f: 0.85,
    dit: 'Le pont flottant du ciel, par où l’on descend.' },

  // ------------------------------------------------------------ Afrique
  { nom: 'Aido-Hwedo',  lon:   2.3, lat:   7.0, r: 4.0, f: 0.95,
    dit: 'Le serpent arc-en-ciel porte le monde sur ses anneaux.' },

  { nom: 'Oshumare',    lon:   4.5, lat:   7.6, r: 3.5, f: 0.85,
    dit: 'Le serpent qui relie le ciel à la terre.' },

  { nom: 'Drakensberg', lon:  29.5, lat: -29.0, r: 5.0, f: 0.70,
    dit: 'Le serpent descend boire à la rivière.' },

  // ------------------------------------------------------------ Océanie
  { nom: 'Terre d’Arnhem', lon: 133.5, lat: -12.5, r: 7.0, f: 1.00,
    dit: 'Ngalyod, le Serpent Arc-en-ciel, a creusé les gorges.' },

  { nom: 'Aotearoa',    lon: 175.5, lat: -39.0, r: 5.0, f: 0.90,
    dit: 'Uenuku : l’arc dit s’il faut partir ou rester.' },

  { nom: 'Mānoa',       lon: -157.8, lat: 21.3, r: 2.5, f: 0.95,
    dit: 'Ānuenue annonce le passage des esprits.' },

  // ----------------------------------------------------------- Amériques
  { nom: 'Dinétah',     lon: -110.0, lat: 36.0, r: 4.0, f: 0.85,
    dit: 'L’arc-en-ciel porte les Êtres saints.' },

  { nom: 'Cusco',       lon:  -72.0, lat: -13.5, r: 5.0, f: 0.90,
    dit: 'K’uychi — on ne montre pas l’arc du doigt.' },

  { nom: 'Amazonie',    lon:  -60.0, lat:  -3.0, r: 7.0, f: 0.80,
    dit: 'Le grand serpent des eaux se lève en arc.' },

  { nom: 'Wallmapu',    lon:  -71.5, lat: -38.5, r: 3.5, f: 0.70,
    dit: 'Relmu porte un nom propre, et on le respecte.' },
];
