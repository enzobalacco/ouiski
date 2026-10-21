# Ce qu'il faut démontrer avant un pilote OuiSki

L'objectif n'est pas d'inventer « 95 % de confiance », mais de fermer des points de
contrôle mesurables. Un pourcentage de tests passés ne prédit pas la fiabilité d'un
GPS en montagne. Le guidage public reste inchangé et le nouveau moteur est isolé.

## Réalisé dans le logiciel

- Tests unitaires de sécurité du routage et du suivi GPS.
- Protection supplémentaire contre une correspondance trop confiante causée par
  l'absence des pistes voisines dans le réseau débutant : contexte cartographique
  original utilisé uniquement comme veto d'ambiguïté.
- Campagne reproductible de positions simulées, avec cas sur pistes candidates et
  hors périmètre, plusieurs précisions et perturbations annoncées. Résultats dans
  `gps-qualification-report.md`, avec dénominateurs et refus distingués des succès.
- Workflow automatique sur GitHub pour détecter les régressions futures. L'état
  réel des exécutions GitHub doit être vérifié avant une fusion.
- Banc d'essai séparé avec carte vectorielle locale, démarrage/arrêt explicite du
  capteur et effacement des positions. Contrôles navigateur simulés sur écran
  mobile et ordinateur. Voir `mobile-test/README.md` ; aucun déploiement public.

## Conditions encore nécessaires

1. **Un parcours pilote limité et confirmé par la station.** Choisir les vrais
   départ/arrivée, vérifier chaque piste, sens, connexion et remontée sur place.
   Aucune de ces validations n'est inventée ou enregistrée ici.
2. **Source fiable d'ouverture.** Définir qui fournit l'information, sa fraîcheur,
   sa signature et le comportement en cas d'absence ou de fermeture.
3. **Essai sur téléphone en dehors du site public.** Le banc logiciel est prêt ;
   préparer un accès HTTPS privé reconnu par le téléphone, puis vérifier le
   capteur réel, son autorisation, refus, précision et interruption. L'adaptateur
   existe uniquement dans cette page séparée, sur clic explicite. Aucun test sur
   appareil physique ni collecte de position personnelle n'a été réalisé ici.
4. **Parcours accompagnés et vérité terrain indépendante.** Comparer les résultats
   à des repères observés par les moniteurs, pas à la carte qui a servi à générer
   le simulateur. Inclure téléphone en poche, forêt, proximité des remontées,
   pistes parallèles, arrêt de réseau et plusieurs modèles de téléphone.
5. **Critères d'acceptation écrits avant les essais.** Définir et mesurer séparément
   les mauvaises identifications confirmées, la disponibilité d'une identification,
   le délai d'acquisition et le délai de retrait après perte du signal. Un moteur
   qui refuse presque tout peut être prudent mais inutilisable.
6. **Revue avant activation publique.** Vérifier le code, les tests CI, le réseau et
   les conditions opérationnelles, puis autoriser explicitement l'intégration et
   le déploiement. Aucune fusion ni activation publique automatique.

Même une campagne sans erreur ne démontre pas un taux de fiabilité de 95 % : la
taille, l'indépendance et la représentativité des essais comptent. Le rapport de
simulation sert à repérer des régressions, pas à remplacer ces validations.
