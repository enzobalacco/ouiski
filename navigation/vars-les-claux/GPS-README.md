# Phase 2 — suivi GPS et correspondance prudente

Module Node.js 20+ isolé : `gps-tracker.mjs` et `gps-geometry.mjs`. Il réutilise le
réseau candidat de phase 1 et son validateur structurel, sans modifier le réseau,
les données source, les signatures ou l'algorithme de routage. Le seul changement
au module `router.mjs` est l'export de sa fonction `validateNetwork` existante.
Ce module n'est pas importé par le site et ne crée aucun itinéraire.

## Contrat

```js
import { createGpsTracker } from './gps-tracker.mjs';

const tracker = createGpsTracker(network);
// Valeurs reçues explicitement d'un futur adaptateur GPS, pas créées ici.
const result = tracker.update({ latitude, longitude, accuracy, timestamp });
const current = tracker.status();
tracker.unavailable(); // capteur refusé/absent, interruption explicite
tracker.reset();       // efface l'acquisition et les données volatiles
tracker.destroy();     // efface les données volatiles et désactive l'instance
```

Pour évaluer Vars, fournir aussi `contextWays: source.ways` dans les options, où
`source` est le contenu original de `dist/ski-data.json`. Les pistes/remontées hors
du réseau candidat servent uniquement de garde-fous d'ambiguïté : elles ne sont
jamais confirmées, ajoutées au graphe ou autorisées. Le contexte est copié, contrôlé
et non modifié. Sans ce contexte, l'estimation reste limitée au petit inventaire.
Un contexte fourni n'est pas nécessairement complet ni validé sur le terrain.

Les coordonnées sont en degrés WGS84, `accuracy` est la précision horizontale en
mètres, `timestamp` le temps de l'observation en millisecondes depuis l'époque Unix.
Les noms correspondent à `GeolocationCoordinates.accuracy` et
`GeolocationPosition.timestamp` ; aucun accès automatique au capteur n'est ajouté.
Valeurs non finies, précision nulle/négative, dates futures, trop anciennes,
répétées ou réordonnées sont refusées. L'option `clock` permet une horloge injectée
pour les tests ; en production, elle doit venir d'un appelant de confiance.

`status()` vérifie l'expiration à chaque lecture : le futur consommateur doit
l'appeler avant tout affichage/décision, et périodiquement pendant les interruptions.
Il n'y a pas de minuteur, capteur ou traitement en arrière-plan. Ne pas réutiliser
un ancien objet de résultat comme s'il était encore actuel. Une confirmation expose
`observationTimestamp` et `expiresAtTimestamp` ; elle cesse d'être valable après
cette échéance, même si aucune nouvelle observation n'arrive.

## Signification des cinq états

| État | Signification limitée au prototype |
|---|---|
| `position_confirmed` | Plusieurs observations récentes correspondent géométriquement à un seul tracé de piste de l'inventaire |
| `ambiguous` | Plusieurs tracés/sections plausibles, proximité d'une remontée, distance excessive ou acquisition pas encore stable |
| `low_accuracy` | Précision horizontale insuffisante ou déplacement apparent invraisemblable |
| `off_network` | Aucun segment de l'inventaire dans le rayon d'incertitude ; ne signifie pas « hors-piste » |
| `gps_unavailable` | Pas de signal exploitable, observation invalide/périmée, interruption, horloge incorrecte ou instance détruite |

**`position_confirmed` est un nom d'état informatique, pas une confirmation terrain.**
Toutes les réponses portent `routingAllowed: false`, `routeOrigin: null` et
`terrainValidated: false`, même après confirmation géométrique. Les états incertains
portent `match: null`. Le module n'appelle jamais `findRoute`, n'ajoute pas de nœud,
ne fusionne pas de tracés et ne crée aucune connexion. Aucune position ne devient
un départ autorisé du moteur signé de phase 1.

## Méthode de correspondance

1. Copie privée du réseau et contrôle avec le validateur de phase 1. Seules les
   arêtes de piste/remontée existantes sont examinées. Les connexions ne servent
   jamais de géométrie et les trous d'arêtes ne sont pas comblés.
2. Distance à l'arc géodésique entre chaque paire consécutive de points : la
   projection est bornée au segment, pas aux seuls sommets ni à une droite infinie.
   Le calcul utilise une sphère de rayon 6 371 km, pas un modèle de relief.
3. Un tracé est plausible si un segment est à au plus `accuracy + 3 m`. Les 3 m
   sont une tolérance cartographique expérimentale, pas une borne d'erreur validée.
4. Plusieurs IDs de tracé plausibles entraînent une ambiguïté, y compris les pistes
   de même nom et les superpositions avec les remontées. Une remontée seule ne
   permet pas de déduire qu'une personne skie sur une piste.
5. Plusieurs sections non contiguës plausibles d'un même tracé restent ambiguës.
   Des segments consécutifs du même tracé ne sont pas comptés comme des pistes
   différentes. L'état n'établit pas le sens de déplacement ni le sens autorisé.
6. Une correspondance unique à moins de 10 m doit être répétée trois fois pendant
   au moins deux secondes. Les preuves comptées sont espacées d'au moins 500 ms.
   La série doit tenir dans une fenêtre de dix secondes ; une preuve plus ancienne
   est abandonnée. Les simples lectures de `status()` ne comptent jamais comme observations.
7. Le changement d'identité exige une nouvelle série stable. Toute ambiguïté,
   sortie, perte ou dégradation retire immédiatement la confirmation ; l'ancienne
   piste n'est jamais conservée comme décision exploitable pendant le doute.

Une projection expose l'ID de l'arête source, une fraction de progression dans
l'ordre du fichier et un point **calculé**, jamais une nouvelle mesure réelle.
Cette fraction n'indique ni « vers le bas », ni « vers l'arrivée », ni un sens
autorisé. Aucun point projeté n'est inséré dans le réseau signé.

## Seuils expérimentaux fixes

| Contrôle | Valeur |
|---|---|
| Précision horizontale maximale | 20 m |
| Distance maximale pour confirmation | 10 m |
| Tolérance cartographique ajoutée au rayon GPS | 3 m |
| Âge maximal / interruption | 10 s (limite incluse) |
| Acquisition | 3 observations sur au moins 2 s, espacées d'au moins 500 ms |
| Vitesse minimale incompatible avec le prototype | Plus de 35 m/s après soustraction des deux rayons de précision |

Ces seuils sont fixes et exportés en lecture seule (`GPS_POLICY`). Aucun n'a été
validé avec des skieurs. Le filtre de vitesse vise les sauts grossiers ; il ne
constitue ni une mesure de vitesse fiable ni une règle de sécurité pour le ski.

## Confidentialité

Pas de requête réseau, compte, API serveur, journal de positions, fichier de
localisation, base de données ou stockage navigateur. Le module ne demande pas la
géolocalisation : les observations sont fournies explicitement. Il garde seulement
en RAM la dernière observation utile, un horodatage anti-rejeu et des compteurs
d'acquisition, sans historique de parcours. Cette mémoire volatile minimale est
nécessaire au suivi ; `reset()` et `destroy()` l'effacent. Les résultats sont copiés.
Le futur adaptateur/consommateur devra respecter les mêmes contraintes et ne pas
enregistrer les observations ou les résultats dans ses journaux.

## Limites en montagne et validation requise

- La précision annoncée par un téléphone est une estimation, pas une garantie que
  la position réelle est dans le cercle. Réflexions contre les parois, forêt,
  relief, vêtements, batterie et modèle de téléphone peuvent produire un biais
  durable. Trois observations répétées ne sont pas trois preuves indépendantes.
- Sans altitude exploitable, on ne distingue pas une remontée d'une piste sous
  son câble, un pont d'une piste en dessous, ou deux niveaux proches en projection.
- Le réseau candidat est partiel et non validé. Un tracé absent (piste rouge,
  liaison, chemin piéton, etc.) peut provoquer une fausse correspondance unique.
  `off_network` peut aussi signifier que la carte est incomplète.
- La géométrie sphérique ne représente pas la pente ni la distance parcourue sur
  la neige. Pas de cap fiable, de filtrage inertiel, de modèle d'altitude ou de
  détection prouvée du sens de descente.
- Une identification géométrique n'atteste ni la difficulté réelle, ni
  l'ouverture, ni le droit de passage ou l'aptitude du skieur. Les validations,
  signatures, sens, niveaux et ouvertures de phase 1 restent obligatoires pour
  tout futur calcul. Aucun pont vers le routage n'est livré dans cette phase.

Avant tout essai de guidage, avec l'exploitant et des moniteurs : vérifier les
géométries et les pistes voisines absentes, relever des parcours de référence
autorisés, tester les pistes parallèles/croisements/fronts de neige/remontées,
mesurer les fausses confirmations et les pertes de signal sur plusieurs téléphones,
par mauvais temps et téléphone en poche, et convenir des seuils d'acceptation.
Les autorisations, le consentement et la politique de confidentialité de ces essais
doivent être définis avant toute collecte ; aucune collecte n'a été faite ici.
Ne pas annoncer un guidage sûr à partir des seuls tests logiciels.

## Vérifier

```sh
node --test navigation/vars-les-claux/router.test.mjs navigation/vars-les-claux/gps-tracker.test.mjs
```

Vérification initiale de phase 2 : 94 tests. Le renforcement ajoute cinq tests de
contexte : **99 tests au total**, dont les 52 tests de phase 1. Tout lancer avec :

```sh
node --test navigation/vars-les-claux/*.test.mjs
node navigation/vars-les-claux/gps-qualification.mjs
```

La seconde commande produit un rapport agrégé reproductible de simulations et
échoue si une fausse confirmation ou une autorisation de routage est observée
avec le contexte. Elle n'enregistre aucune observation personnelle. Voir
`gps-qualification-report.md`. Le workflow GitHub lance ces deux commandes sur
Node 22 et 24 ; son ajout ne prouve pas qu'une exécution distante a déjà réussi.

Les observations `SIM_*` sont entièrement simulées dans les tests, distinctes des
données source. Le test de lecture de `network.json` utilise un point simulé et
ne le décrit jamais comme une position observée sur le terrain. Aucun fichier
de test n'est intégré au site public et aucune donnée originale n'est réécrite.
