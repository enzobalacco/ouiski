# Stabilisation du banc GPS — protocole sur téléphone

Objectif : vérifier le capteur, l'affichage et l'effacement avant tout essai de
guidage. Le test est possible loin de Vars : « Hors du réseau candidat » y est
normal. Aucune validation de piste, connexion ou ouverture n'est créée.

## Essai de deux minutes

1. Ouvrir la prévisualisation protégée la plus récente, dans le navigateur habituel
   du téléphone. Ne pas utiliser l'ancienne URL d'un déploiement figé. Vérifier la
   présence du panneau « Votre essai sur téléphone ».
2. Cliquer sur « Nouvel essai : tout effacer », puis « Démarrer le GPS ». Autoriser
   la localisation. Faire le test à l'arrêt dans un lieu adapté, sans se déplacer
   dans une situation dangereuse pour regarder l'écran.
3. Garder la page visible au moins trente secondes. Le panneau doit indiquer si
   une mesure est reçue et si trente secondes de signal récent sont observées.
   Une estimation de précision n'est pas une mesure d'erreur réelle.
4. Cliquer sur « Arrêter et effacer ». Vérifier soi-même que les coordonnées,
   le point et le cercle disparaissent. Le panneau indique l'arrêt constaté.
5. Relancer le GPS et attendre une nouvelle mesure. Vérifier le redémarrage.
6. Changer d'onglet ou masquer l'application, puis revenir. Le suivi doit être
   arrêté et les coordonnées effacées ; aucun redémarrage automatique.
7. Cliquer sur « Copier le bilan sans coordonnées ». Le texte reste local sauf
   si l'utilisateur décide de le partager. Il ne contient ni latitude/longitude,
   ni date exacte, ni identifiant, ni nom de piste. Ne pas partager une capture
   du panneau des coordonnées pour rendre compte du test.

Si le signal s'interrompt, consigner l'échec. Ne pas augmenter artificiellement
sa durée de validité pour faire passer le test. Le bouton de copie dispose d'une
sélection manuelle du texte si le presse-papiers du navigateur est inaccessible.

## Ce que le bilan établit et n'établit pas

Les coches signifient « observé par le logiciel », pas « validé sur le terrain ».
Les compteurs, durées relatives et résultats de procédure sont en RAM uniquement.
Pas d'historique de positions, sauvegarde automatique, télémétrie ou transmission.
Une nouvelle procédure ou un rechargement efface le bilan.

La continuité nécessite des mesures récentes ; les simples lectures du même
point ne créent pas de nouvelles observations. Deux séquences de quinze secondes
séparées par une perte de signal ne font pas trente secondes continues.

Le bilan ne mesure pas la justesse de la piste, le droit de passage, le sens de
descente, la batterie réelle ou l'ouverture des installations. Aucun itinéraire
ne devient exploitable à partir de ces résultats.

## Journal de qualification à compléter après les essais

| Essai | Famille appareil / navigateur (sans identifiant) | Réception | 30 s récentes | Arrêt/effacement vérifié visuellement | Relance | Masquage | Action |
|---|---|---|---|---|---|---|---|
| 1 | iPhone / Safari — à essayer | Non exécuté | Non exécuté | Non exécuté | Non exécuté | Non exécuté | À planifier |
| 2 | Android / Chrome — à essayer | Non exécuté | Non exécuté | Non exécuté | Non exécuté | Non exécuté | À planifier |
| 3 | Deuxième essai après rechargement | Non exécuté | Non exécuté | Non exécuté | Non exécuté | Non exécuté | À planifier |

À ce stade, l'utilisateur a seulement rapporté l'apparition d'une estimation en
mètres sur téléphone. Les autres critères ne sont pas considérés comme validés.
Les tests navigateur automatisés utilisent un capteur simulé : ils ne remplissent
pas ce journal et ne remplacent pas les appareils.

## Suite après stabilisation

Traiter les échecs reproductibles et vérifier les exécutions CI. Préparer ensuite
un petit secteur avec données validées et essais accompagnés à Vars. Pour les
écoles visées en mai–juin 2027 : montrer une démo stable, les résultats et les
limites, sans promettre un guidage réel avant validation avec l'exploitant.
