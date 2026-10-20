# OuiSki — export du code source

Export du 17 octobre 2026, version Sites 32.
Commit source : 418c46b22b9c3e5d2d08565a97dd7e43b7dbf05d

## Contenu
Tous les fichiers suivis dans le dépôt source du site sont inclus, sans modification. Ce projet est un site statique : le HTML, le CSS et le JavaScript applicatifs sont principalement réunis dans dist/index.html. dist contient aussi les données JSON, Leaflet et les images. Aucun framework ni étape de compilation n’est nécessaire pour cette version.

.openai/hosting.json est la configuration de l’hébergement Sites existant. Les fichiers de vérification publics pour les moteurs sont conservés. Aucun historique Git ni identifiant d’authentification temporaire n’est inclus.

## Tester sur le Mac
Décompresser le ZIP. Dans Terminal, saisir `cd ` puis glisser le dossier ouiski-source dans Terminal et valider. Si Python 3 est installé, lancer :

    python3 -m http.server 8000 --directory dist

Ouvrir http://localhost:8000 dans le navigateur. Arrêter avec Ctrl+C. Un serveur local est préférable au double-clic sur index.html car les données JSON sont chargées par fetch. La géolocalisation exige localhost ou HTTPS et l’autorisation du navigateur. Les cartes et services externes nécessitent Internet.

## Reprendre avec GitHub et Codex
Créer un dépôt GitHub nommé ouiski. Importer le contenu du dossier décompressé (pas le ZIP). Conserver les dossiers et le fichier caché .openai/hosting.json si l’on souhaite garder la configuration Sites. Vérifier dans GitHub que dist/index.html et les autres fichiers sont présents. Connecter ensuite ce dépôt à l’environnement Codex.

Premier travail à demander : « Lis ce projet statique et dresse un état précis des fonctions existantes, simulées et manquantes, puis propose les étapes pour un MVP à Vars. »

Un ajout sur GitHub ne met pas automatiquement à jour le site Sites. Il faudra configurer explicitement le mode de déploiement retenu.

## Limites actuelles
Ce ZIP exporte le site web existant. Ce n’est pas une application iOS/Android native. Le guidage à ski est une démonstration : connexions, sens de circulation et sécurité ne sont pas validés pour un guidage réel. Les exemples de cours sont fictifs. L’export ne contient pas de backend de réservation, de comptes utilisateurs ou de partage en direct des positions. Les services externes utilisés restent soumis à leur disponibilité et à leurs conditions.
