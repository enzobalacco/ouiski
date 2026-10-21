# Banc d'essai mobile privé OuiSki

Interface séparée du site public, sans itinéraire ni guidage. Aucun changement à
`dist/`, `.openai/` ou à l'hébergement existant. Cette page n'est pas déployée.

## Essayer localement sur ordinateur

Depuis la racine du dépôt, avec Node.js 22 ou 24 :

```sh
node navigation/vars-les-claux/mobile-test/server.mjs
```

Dans le navigateur du même ordinateur, saisir `http://localhost:8080`.
Le serveur écoute uniquement sur l'interface locale par défaut. Pas de dépendance
à installer pour utiliser le banc. Démarrer le GPS uniquement par le bouton,
accepter ou refuser la demande du navigateur. Arrêter le serveur avec Ctrl+C.

Le navigateur affiche une carte vectorielle des données disponibles aux Claux,
sans serveur de tuiles externe. Une position loin de Vars peut être hors de la
zone affichée : ce banc n'est pas une carte mondiale. Les boutons +/− changent
l'échelle ; le bouton de recentrage revient au front des Claux.

## Essayer sur un téléphone

### Dossier autonome pour un hébergement privé

```sh
node navigation/vars-les-claux/mobile-test/export-static.mjs
```

Le dossier généré `mobile-test/private-build/` contient seulement les neuf ressources
statiques nécessaires, plus un manifeste SHA-256. Aucun certificat, clé privée,
serveur, compte, dépendance de test ou position personnelle n'est inclus.
L'export peut être relancé ; il refuse les liens symboliques et les fichiers inconnus.
Il ne déploie rien et ne modifie pas l'hébergement existant.

Avant toute mise en ligne : créer un projet séparé, activer une authentification
obligatoire pour toutes les URL (y compris accès direct au déploiement), confirmer
le blocage depuis une session non connectée, puis seulement utiliser le lien HTTPS.
Une URL non répertoriée n'est pas une protection. Aucun script analytique ne doit
être ajouté. Le contrôle d'accès est une condition de déploiement, pas une fonction
de l'export statique. Le compte d'hébergement reste à connecter séparément.

La page doit être accessible au téléphone dans un **contexte sécurisé** : HTTPS
avec un certificat reconnu par le téléphone, ou un accès local par un mécanisme
de développement approprié. Une simple adresse HTTP sur le réseau Wi-Fi n'est
pas suffisante pour le GPS. Aucun certificat, domaine privé ou accès Internet
n'a été créé ici. Ne pas désactiver les vérifications de certificat.

Pour un réseau privé et un certificat déjà disponible :

```sh
node navigation/vars-les-claux/mobile-test/server.mjs --host ADRESSE_PRIVEE_DU_SERVEUR --port 8443 --cert CHEMIN_CERTIFICAT --key CHEMIN_CLE
```

Remplacer les indications par les paramètres réels. Le nom/adresse dans l'URL doit
correspondre au certificat et être joignable depuis le téléphone. Ne jamais mettre
la clé privée dans GitHub ou dans cette conversation. L'écoute réseau sans HTTPS
est refusée par le script. Le serveur ne fournit pas d'authentification : rester
sur un réseau privé contrôlé, ou ajouter un accès privé authentifié approprié
avant toute exposition extérieure. Il ne s'agit pas d'un déploiement public.

## Confidentialité et comportement

- Aucun capteur activé avant le clic sur « Démarrer le GPS ».
- Une seule observation utile en mémoire, pas d'historique ni de stockage persistant.
- Aucun envoi de position, requête de tuiles, analytics ou connexion extérieure.
  Seuls les fichiers statiques fixes sont chargés avant le suivi.
- « Arrêter et effacer » annule le capteur et le timer, remet le tracker à zéro et
  retire les coordonnées et le point. Le suivi s'arrête aussi si la page est masquée.
  Revenir à l'application ne redémarre pas le GPS automatiquement.
- Le point et les coordonnées sont retirés après expiration du signal (10 secondes).
- Un refus de permission est explicite et ne déclenche pas de demandes en boucle.
- Le contexte inclut les tracés source voisins : une superposition peut produire
  une ambiguïté. Aucune connexion ou autorisation n'est créée par cette carte.
- La précision affichée reste une estimation du téléphone, pas une garantie.
  Le cercle est dessiné en approximation locale ; il ne constitue pas une zone sûre.
- Le serveur ne journalise pas les requêtes et ne possède aucune route de collecte.
  Liste blanche des ressources, refus de POST et des paramètres d'URL, pas de CORS,
  CSP restrictive et politique de confidentialité du référent.

## Vérification logicielle

Depuis la racine :

```sh
node --test navigation/vars-les-claux/*.test.mjs
```

Pour les tests navigateur (dépendances de développement uniquement) :

```sh
cd navigation/vars-les-claux/mobile-test
npm ci
npx playwright install chromium
npm test
```

Un Chromium déjà installé peut être utilisé via `OUISKI_CHROMIUM_PATH` sans
télécharger un navigateur. Le verrou npm est fourni. Les tests utilisent un GPS
et une horloge SIMULÉS, pas des positions personnelles. Vérifications aux formats
390 et 1280 pixels : carte, démarrage explicite, arrêt, expiration, refus de
permission, masquage de page, absence de requêtes pendant le suivi et échec de
chargement des données. Les tests du serveur vérifient ses restrictions d'accès.

Résultat local : **106 tests de module/serveur + 5 tests navigateur = 111 réussis**.
Cela ne prouve pas une compatibilité réelle iPhone/Safari ou Android/Chrome : les
formats de fenêtre ne remplacent pas les appareils. Le workflow GitHub est ajouté,
mais ses exécutions distantes doivent être vérifiées séparément.

## Avant utilisation sur les pistes

Faire d'abord un test statique sur téléphone, puis des essais accompagnés dans
un petit secteur validé avec la station, sans se guider avec ce banc. Mesurer
précision, erreurs de piste, interruptions, comportement en poche et batterie.
Définir consentement et protocole avant toute éventuelle collecte future. Aucune
collecte n'est activée ici. Voir `../readiness.md` et `../GPS-README.md`.
