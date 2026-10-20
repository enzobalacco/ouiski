# Revue du moteur isolé — 20 octobre 2026

Périmètre : `router.mjs`, contrôles d'entrée, attestations et tests. Aucun changement
de `dist/`, de la source, de `network.json`, du rapport terrain ou de l'hébergement.
Aucune validation terrain ou ouverture réelle n'a été ajoutée.

## Défauts démontrés et corrigés

Avant correction, les 22 tests existants passaient et six nouveaux tests de
régression échouaient : validation fabriquée acceptée, plafond de fraîcheur
contournable, coordonnées source invalides hors des nœuds utilisés non contrôlées,
arête mal formée ignorée en l'absence de validation, date sans fuseau acceptée et
réseau incomplet produisant une erreur interne non contrôlée.

La revue a également couvert les transferts de signatures, le contournement du
niveau par une connexion, les arrêts intermédiaires de remontée et les types JSON
ambigus. Les corrections sont :

- Authentification Ed25519 des validations et observations d'ouverture. Les clés
  publiques approuvées sont fournies séparément, par rôle ; refus par défaut.
  Signature liée à l'arête, au rôle, au contenu des déclarations et à l'empreinte
  de toute la géométrie/structure/source du réseau. Copier une preuve ou modifier
  coordonnées, difficulté, sens, dates ou version invalide la signature.
- Expiration explicite des validations ; calendrier ISO UTC strict. Plafond de
  fraîcheur de 15 minutes non extensible par `maxAgeMs`. Une observation future,
  périmée ou sans signature approuvée ne permet pas le passage.
- Contrôles structurels avant tout filtrage : tableaux manquants, doublons, points
  absents/non finis/hors bornes, contradictions de nœuds source, sauts de points,
  identités d'occurrences et types d'arêtes incorrects.
- Difficulté contrôlée aux deux extrémités des connexions : une liaison ne permet
  plus à un niveau vert d'atteindre une occurrence de piste bleue. Les difficultés
  JSON non textuelles ou inconnues ne sont pas converties implicitement.
- Pas d'embarquement/débarquement au milieu d'une remontée, même si une arête
  isolée porte une validation. Types de remontées limités à ceux de l'inventaire.
- Les directions restent explicites, sans inférence de `oneway=no` ni connexion
  par proximité. Directions absentes, invalides ou répétées refusées.
- Le résultat ne partage plus ses tableaux de coordonnées avec les entrées.

## Tests

Commande depuis la racine :

```sh
node --test navigation/vars-les-claux/router.test.mjs
```

52 tests réussis : 22 tests initiaux adaptés au contrat de signature et 30 tests
supplémentaires. Aucun échec, aucun test ignoré. Les validations et ouvertures
qui réussissent sont fictives, en mémoire, signées avec deux paires de clés
éphémères créées pour chaque exécution. Aucune clé privée de test n'est enregistrée.

Couverture : conservation des données, niveaux vert/bleu/rouge/noir et difficultés
inconnues, sens uniques/inverses/bidirectionnels, remontées, passages interdits ou
inconnus, liaisons implicites, fermetures sur parcours multi-arêtes, limites de
fraîcheur, signatures falsifiées/non approuvées/rejouées sur d'autres objets,
clés retirées, dates invalides, réseaux mal formés et immutabilité des entrées.

## Risques restant à traiter avant usage réel

- Une signature prouve l'origine d'une déclaration, pas sa vérité terrain.
  Inventaire, sens, connexions et rôles d'embarquement restent non validés.
- Aucun registre de clés de production ni outil de signature terrain n'est fourni.
  Il faut définir les autorités, leur périmètre d'action, le stockage sécurisé des
  clés privées, leur rotation et les procédures de révocation. Les clés et `now`
  ne doivent pas être choisis par un utilisateur non fiable.
- Une observation signée encore fraîche peut être rejouée après une fermeture
  survenue depuis. Aucun service d'actualisation, numéro de séquence persistant ou
  liste de révocation individuelle n'est implémenté. Pas de garantie « temps réel ».
- Toute modification structurelle du réseau invalide les signatures précédentes :
  un futur registre devra gérer et revalider les versions explicitement.
- Le calcul reste une distance minimale, pas une estimation de temps ni un suivi
  GPS. Attente, restrictions d'équipement/âge, météo, secours et guidage continu
  ne sont pas pris en charge. Les connexions signées doivent faire l'objet d'un
  contrôle opérationnel incluant ces contraintes.
- Le moteur reconstruit et contrôle le réseau à chaque appel. Aucune protection
  de service contre des entrées démesurées ou un déni de service n'est fournie ;
  ce module Node isolé n'est pas une API publique.

Le réseau candidat livré reste sans validation et sans ouverture. Il ne peut donc
produire aucun trajet utilisable avec les données réelles actuelles.
