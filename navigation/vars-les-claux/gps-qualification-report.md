# Qualification GPS simulée — Vars Les Claux

Source SHA-256 : `c6dec4c404f814222f2a61cf41b9f18cea4b36975edbd676074f0aae2c2387ad`.

Positions entièrement SIMULÉES à partir des géométries du fichier, avec perturbation déterministe. Aucune collecte GPS personnelle.

Trois observations sur deux secondes par scénario. Pistes candidates : première, médiane et dernière coordonnées, précisions 2/5/10/25 m. Autres tracés : coordonnée médiane, précisions 2/5 m. Les coordonnées sont seulement des références cartographiques, pas des vérités terrain.

| Résultat final du scénario | Réseau partiel seul | Avec contexte source complet |
|---|---:|---:|
| scenarios | 488 | 488 |
| correctConfirmations | 48 | 40 |
| falseConfirmations | 0 | 0 |
| ambiguous | 127 | 390 |
| low_accuracy | 58 | 58 |
| off_network | 255 | 0 |
| gps_unavailable | 0 | 0 |
| routingAuthorizations | 0 | 0 |

Avec contexte : 232 scénarios sur pistes candidates, dont 40 confirmations et 134 ambiguïtés ; 58 signaux imprécis. Les 256 scénarios sur tracés exclus ne doivent jamais être confirmés.

Une fausse confirmation désigne une piste différente du tracé ayant servi à simuler la position, ou une confirmation sur un tracé exclu du périmètre. Une ambiguïté est un refus prudent, pas une identification réussie. Les états sont comptés en fin de scénario ; cette campagne ne mesure pas le guidage ni les erreurs à chaque instant.

**Ces résultats ne constituent ni un taux de fiabilité terrain, ni une garantie à 95 %.** Le simulateur connaît les mêmes géométries que le moteur. Il ne reproduit pas les biais persistants, cartes erronées, neige ou relief. Il faut des essais indépendants sur téléphone, un inventaire validé et un flux d'ouverture fiable avant tout guidage.
