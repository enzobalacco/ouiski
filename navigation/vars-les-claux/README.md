# GPS isolé — phase 1, Vars Les Claux

Ce module n'est pas chargé par le site, n'est pas déployé dans `dist` et ne remplace
aucune fonctionnalité. Il ne fournit pas encore un guidage GPS. Node.js 20+ suffit,
sans dépendance et sans installation. Ne modifier ni l'hébergement ni les données source.

## Reproduire et vérifier

Depuis la racine du dépôt :

```sh
node navigation/vars-les-claux/build-network.mjs
node --test navigation/vars-les-claux/router.test.mjs
```

Le générateur ne lit que `dist/ski-data.json` et ne produit que `network.json` et
`terrain-report.md` dans ce dossier. Le résultat est déterministe (pas de date de
génération variable). Le SHA-256 permet de détecter un changement de source.

## Périmètre candidat, à confirmer avec la station

Les 29 identifiants sélectionnés sont explicites dans `selectedWayIds`. Ils couvrent
les tapis Centre, Claux et Zakopane, les Écrins et les pistes/remontées associées au
secteur des Claux : 20 tronçons verts/bleus et 9 remontées. Cette sélection de travail
n'est pas un périmètre officiel. Mayt, Chabrières, Escondus, Sibières et plusieurs
pistes se prolongent hors du front : conservés entiers pour ne pas inventer de
découpage, mais pas automatiquement adaptés aux débutants. D'autres tronçons peuvent
manquer ; la station doit confirmer cette sélection avant usage. Aucun secteur voisin
n'est ajouté par propagation de proximité ou de connectivité.

## Données et états

- `ways` conserve exactement IDs, tags, nœuds et coordonnées `[latitude, longitude]`.
- `nodes` utilise une identité par occurrence `wayId:index`, même lorsque le nœud OSM
  est partagé : le moteur ne traverse jamais spontanément entre deux tracés.
- `terminals` conserve les premières/dernières coordonnées. Départ/arrivée et
  embarquement/débarquement sont des rôles possibles, jamais confirmés. Aucun point
  officiel de rassemblement ou front de neige n'est inventé.
- `edges` décrit les paires de points consécutifs et les seules paires partageant un
  même ID de nœud source. Une connexion candidate n'autorise aucun passage.
- `review.validation` : `confirmed`, `to_verify`, `forbidden`, `unknown`.
- `review.authorization` : `allowed`, `forbidden`, `unknown`.
- `directions` : `forward` (ordre du fichier), `reverse`, ou les deux, après validation.
- `evidence` : `reference`, `validatedBy`, `validatedAt` et `validUntil` au format ISO UTC strict.
- `review.signature` et `availability[edgeId].signature` : `keyId` et `value` (signature Ed25519 en base64 canonique).

L'inventaire livré contient **zéro autorisation**, zéro sens confirmé, zéro ouverture
confirmée et aucune interdiction terrain inventée. Le fait cartographique d'un nœud
commun est vérifiable dans la source ; son franchissement reste à vérifier.
Absence de liaison, géométrie proche, oneway historique et horaires OSM ne valent
jamais autorisation. Toutes les occurrences d'un même nom restent séparées.

## Contrat du calcul

`findRoute(network, {from, to, level, availability, now, maxAgeMs, trust})` est une fonction
pure, sans réseau, stockage, interface ou géolocalisation. Elle cherche la distance
minimale sur les seules arêtes autorisées, dans le sens explicitement validé, avec un
plafond de difficulté. Les niveaux sont cumulatifs : vertes, bleues, rouges, noires.
La phase 1 ne livre que des pistes candidates vertes/bleues ; les difficultés plus
élevées sont testées sur des extraits source en mémoire, pas ajoutées au périmètre.

Pour chaque arête utilisée il faut :

1. Une validation `confirmed`, une autorisation `allowed`, les sens explicites et une
   preuve avec référence, validateur, date non future et expiration non atteinte,
   et une signature vérifiée avec une clé approuvée.
2. Une entrée `availability[edgeId]` avec `state: 'open'`, une `source` et `observedAt`.
   Toute entrée manquante, fermée, inconnue, future ou trop ancienne bloque le passage.
   Cette observation doit être signée par une clé d'ouverture approuvée.
   L'information doit dater d'au plus 15 minutes : règle conservatrice
   de prototype, à convenir avec l'exploitant, pas une garantie de fraîcheur officielle.
3. Une difficulté reconnue compatible avec le niveau pour les pistes, y compris
   celles atteintes par une connexion. Les connexions de remontée et les extrémités
   du trajet ne permettent pas d'embarquer/débarquer sur un pylône intermédiaire.

`trust.reviewKeys` et `trust.openingKeys` sont des `Map` distinctes de `keyId` vers
des objets `KeyObject` publics Ed25519 de `node:crypto`. L'absence de clé approuvée
entraîne un refus. Les clés privées n'appartiennent jamais au réseau ou au moteur.
`attestations.mjs` expose `networkFingerprint` et `attestationPayload` pour un futur
outil de signature contrôlé ; ces fonctions ne signent et n'autorisent rien.
La signature lie rôle (validation/ouverture), arête, empreinte du réseau complet
(géométrie, difficultés, source et structure) et toutes les déclarations. Modifier
ces données invalide la signature ; copier une signature vers un autre rôle,
réseau ou identifiant d'arête ne fonctionne pas.

Les dates doivent être du texte ISO UTC complet (avec `Z`), calendrier valide ;
dates sans fuseau, nombres ou dates corrigées automatiquement sont refusés.
`maxAgeMs` peut réduire mais jamais augmenter le plafond de 15 minutes. Une date
d'expiration de validation est obligatoire. Tous les tracés, nœuds et arêtes sont
contrôlés structurellement avant le routage, même si non autorisés.

**Frontière de confiance :** les clés approuvées et l'heure `now` doivent venir
 d'un appelant de confiance, jamais d'un formulaire, d'une requête utilisateur ou
 de `network.json`. Le moteur vérifie l'origine cryptographique des déclarations,
 pas leur vérité physique. Aucun registre réel de validateurs, aucune clé de
 production, aucun outil de signature terrain ni flux d'ouverture n'est livré.
La révocation d'une clé fonctionne en la retirant du registre fourni au calcul.
La gestion des clés, la révocation d'une validation individuelle et l'actualisation
des fermetures restent à concevoir. Une ouverture signée peut être rejouée pendant
sa fenêtre de fraîcheur : elle ne garantit pas que la piste n'a pas fermé depuis.
Ne pas présenter des objets ou signatures de test comme des validations réelles.

Le moteur retourne `found` ou `refused` avec une raison. Le réseau de production
non validé retourne donc des refus. C'est attendu. Les tests seuls injectent en mémoire
des validations et ouvertures **fictives**, signées avec des clés éphémères créées
au lancement des tests, pour vérifier les succès et les refus.
Les coordonnées des tests proviennent elles aussi de la source.

Ni connexion par distance, ni accrochage automatique au GPS, ni durée d'attente, ni
guidage vocal, ni amis ne sont développés ici. Une liaison manquante devra faire
l'objet d'un relevé/justificatif explicite avant toute extension du schéma, jamais
d'un raccourci géographique. Voir `terrain-report.md` pour la liste terrain complète.
