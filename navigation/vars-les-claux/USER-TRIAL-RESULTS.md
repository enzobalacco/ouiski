# Résultats rapportés par l'utilisateur — premier téléphone

Consignation : 4 novembre 2026. Date exacte des mesures, appareil, système,
navigateur et environnement non recueillis. Aucune coordonnée ni identité enregistrée.
Ces résultats viennent des bilans collés dans la conversation : ils ne constituent
pas des essais observés indépendamment ni une validation du guidage.

| Bilan | Démarrages | Mesures distinctes | Première mesure | Continuité maximale | Interruptions | Autres événements rapportés |
|---|---:|---:|---:|---:|---:|---|
| R1 | 1 | 14 | 1 s | 39 s | 1 | Arrêt explicite et affichage effacé |
| R2 | 1 | 5 | 1 s | 10 s | 1 | Arrêt au masquage de la page |
| R3 | 1 | 5 | 0 s | 3 s | 1 | Réception uniquement |
| R4 | 2 | 9 | 0 s | 10 s | 0 | Arrêt/effacement et réception après relance |

Un bilan initial entièrement nul a aussi été transmis : il ne compte pas comme
un essai réussi. Les compteurs de ces bilans proviennent de sessions distinctes
ou remises à zéro : ne pas les additionner en une session continue fictive.

## Ce qui est établi à ce stade

La réception, une continuité de plus de trente secondes, l'arrêt/effacement,
la relance et l'arrêt au masquage ont été rapportés, sur plusieurs essais.
Ces observations ne prouvent ni une stabilité durable ni la précision réelle.
Le zéro seconde affiché est arrondi : ne pas conclure à un délai strictement nul.

## Défauts logiciels trouvés pendant l'analyse

- Une perte pouvait être manquée par le compteur si une mesure nouvelle arrivait
  après expiration de la précédente, avant le passage du timer. Le diagnostic v2
  compte désormais ce trou même si la mesure suivante est exploitable.
- Une exception du tracker ou de l'affichage pouvait laisser la surveillance GPS
  active. Le contrôleur arrête désormais les ressources, retire la mesure et
  signale une erreur interne. Si le capteur lui-même refuse son arrêt, l'erreur
  est signalée et ses callbacks sont ignorés ; aucun logiciel ne peut garantir
  l'état physique d'un adaptateur qui échoue.

Ces corrections sont vérifiées en simulation. Elles ne permettent pas d'attribuer
la cause exacte des interruptions R1–R3 : les anciens bilans ne la contiennent pas.

## Vérifications restant nécessaires

1. Identifier famille de téléphone, OS, navigateur et conditions des essais.
2. Refaire une session complète avec le bilan v2 et ses causes d'interruption.
3. Comparer sur un second téléphone et examiner la batterie sur une durée convenue.
4. Valider l'identification sur place à Vars, avec référence indépendante et
   accompagnement. Aucune piste, connexion, ouverture ou autorité de signature
   de production n'est validée par ces bilans.

Aucun taux de réussite terrain à 95 % ne peut être déduit de ces quatre bilans.
