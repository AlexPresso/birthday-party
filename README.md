# Les 30 ans

Application privée pour un anniversaire : photos et vidéos, programme avec surprises
programmées, livre d'or et paramètres. L'interface utilise le thème
prune sombre choisi dans [le brief](docs/design.md).

Next.js et TypeScript affichent l'application. Un service Go gère les invitations,
les sessions, les permissions, PostgreSQL et les médias sur disque. Le navigateur
utilise uniquement l'origine du frontend ; Next transmet `/api/*` au serveur Go.
Le [contrat HTTP](docs/api.md) décrit les échanges.

## Skills du projet

Les skills sont inclus dans `.agents/skills/`, avec leurs références et licences :

- [Go Style Guide](.agents/skills/go-style-guide/SKILL.md), issu de
  [madflojo/go-style-agent-skill](https://github.com/madflojo/go-style-agent-skill)
  (Apache-2.0), pour le code Go et l'évolution de l'architecture. Le commit source
  est fixé dans [UPSTREAM.md](.agents/skills/go-style-guide/UPSTREAM.md) ; les choix
  du projet sont précisés dans [backend/AGENTS.md](backend/AGENTS.md).
- [UX Writing](.agents/skills/ux-writing/SKILL.md), issu de
  [content-designer/ux-writing-skill](https://github.com/content-designer/ux-writing-skill),
  sous licence MIT, pour les textes de l'interface.
- [Humanizer](.agents/skills/humanizer/SKILL.md), issu de
  [blader/humanizer](https://github.com/blader/humanizer), sous licence MIT, pour la
  relecture du style.

[AGENTS.md](AGENTS.md) précise leur usage et le ton de l'application.
Ces copies sont propres au dépôt et peuvent être partagées avec le code ; aucune
installation globale n'est nécessaire. Les instructions des `SKILL.md` sont
conservées telles quelles, avec leurs ressources utiles et les crédits d'origine.

## Démarrer en local

Prérequis : Node.js 24+, npm, Go 1.26+, `ffmpeg` et `ffprobe` dans le `PATH`
pour les vidéos. [FFmpeg](https://ffmpeg.org/download.html) doit inclure les
encodeurs H.264 (`libx264`) et AAC. Docker les fournit automatiquement.
PostgreSQL 18 est fourni par Docker Compose. Les commandes ci-dessous fonctionnent
dans PowerShell à la racine du projet.

```powershell
npm ci
npm --prefix frontend ci
docker compose -p birthday-party-dev -f compose.yaml -f compose.dev.yaml up -d --wait postgres
npm run dev
```

Ouvrir **http://localhost:3000**. Le serveur Go écoute sur `127.0.0.1:8080`.
`Ctrl+C` arrête les deux processus. Next recharge les modifications du frontend ;
relancer la commande après une modification Go. Les médias locaux sont dans
`backend/data/`, exclu de Git ; les données sont dans PostgreSQL. Aucun invité ni
contenu de fête n'est créé au démarrage.
Avec `PRINT_ADMIN_INVITATION=true`, un profil technique `Admin` est créé seulement
s'il n'existe aucun administrateur actif.

Le script utilise Go dans le `PATH`, puis recherche un éventuel SDK local dans
`~/.codex/tools/go-*/go/bin/`. Pour un autre emplacement, définir `GO_BIN` :

```powershell
$env:GO_BIN = 'C:/path/to/go/bin/go.exe'
```

Les scripts chargent un éventuel `.env` à la racine ; les variables déjà définies
dans le terminal sont prioritaires. `.env.example` donne les options sans secret.
Avec un `DATA_DIR` relatif, le chemin est résolu à partir de `backend/`.
Les scripts construisent l'adresse PostgreSQL locale depuis `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD` et `POSTGRES_PORT` (5432 par défaut).
Une variable `DATABASE_URL` explicite permet d'utiliser une autre base.
L'extension `compose.dev.yaml` expose PostgreSQL uniquement sur `127.0.0.1`.
Le projet Compose `birthday-party-dev` possède sa propre base : les médias locaux
et ceux du déploiement Docker restent associés à leurs enregistrements respectifs.

## Personnaliser l’anniversaire

Copier `.env.example` vers `.env` à la racine si ce fichier n’existe pas encore,
puis modifier ces variables dans ce fichier commun :

```dotenv
BIRTHDAY_AGE=30
# Optional copy for each language; omit to use translated defaults.
# INVITATION_TITLE_FR="On fête mes 30 ans !"
# INVITATION_TITLE_EN="Come celebrate my 30th birthday!"
# INVITATION_DESCRIPTION_FR="Les photos, le programme et vos petits mots sont ici."
# INVITATION_DESCRIPTION_EN="Find the photos, programme and your messages here."
```

- `BIRTHDAY_AGE` règle l’âge affiché sur la page de connexion, dans l’en-tête et
  dans le livre d’or. Un entier de 1 à 150 est accepté ; sinon, la valeur reste 30.
- `INVITATION_TITLE` remplace le titre de la page de connexion et de l’onglet du
  navigateur pour toutes les langues. Sans personnalisation, le titre suit l’âge
  et la langue, par exemple « Les 40 ans » en français. Une valeur vide masque le
  titre sur la page ; l’onglet utilise alors « Anniversaire » dans la langue choisie.
- `INVITATION_DESCRIPTION` remplace le paragraphe d’introduction et la description
  de la page pour toutes les langues. Les retours à la ligne sont conservés dans
  l’introduction ; le HTML est affiché comme du texte.
- Ajouter le suffixe `_FR`, `_EN`, `_DE`, `_IT` ou `_ES` à l’une de ces variables
  permet de fournir un texte pour cette langue. La priorité est : valeur de la
  langue, valeur commune, puis texte traduit par défaut. Une valeur explicitement
  vide masque le texte, y compris si une valeur commune existe. Supprimer ou
  commenter une variable permet de passer au niveau suivant.

Entourer les textes de guillemets dans `.env`. Le nom de la fête enregistré dans
**paramètres** reste modifiable séparément ; ces variables ne remplacent pas cette
valeur. Sur une nouvelle installation, ce nom est vide et l’en-tête utilise le
titre d’invitation configuré ou traduit par défaut. Les noms de fête déjà
enregistrés sont conservés. Le nom est facultatif : le laisser vide ou l’effacer
dans **paramètres** permet de garder ce titre automatique, même en modifiant la
date, le lieu ou le fuseau horaire.

Après une modification, lancer simplement cette commande depuis la racine :

```powershell
docker compose up
```

Compose lit automatiquement le `.env` à la racine et recrée les conteneurs dont
la configuration a changé. Ajouter `-d` pour laisser l’application tourner en
arrière-plan. Ces valeurs sont lues à l’exécution : aucune reconstruction de
l’image n’est nécessaire pour les changer. `docker compose restart` seul ne
recharge pas la configuration.

Compose ignore `frontend/.env` et `frontend/.env.local`. Les variables déjà
définies dans le terminal sont prioritaires sur le `.env` racine. L’adresse
interne de l’API, le port d’écoute 3000, l’adresse d’écoute et le mode production
du conteneur restent fixés dans Compose ; `PORT` règle uniquement le port exposé
sur la machine hôte.

En local, `npm run dev` charge également le `.env` racine ; relancer la commande
après une modification. `frontend/.env.example` sert uniquement à lancer Next.js
indépendamment, sans le script racine.

## Limites des fichiers

Dans le `.env` à la racine, ces variables définissent le poids maximal par fichier :

```dotenv
MAX_IMAGE_SIZE_MB=15
MAX_VIDEO_SIZE_MB=100
```

Les valeurs sont des entiers de 1 à 1024, en Mio (1 Mio = 1 048 576 octets).
Une variable absente ou vide utilise respectivement 15 et 100. Une valeur
invalide empêche le démarrage avec un message d’erreur explicite.

Après modification, lancer `docker compose up -d`. Le serveur, les limites
affichées et le proxy prennent les nouvelles valeurs sans reconstruire les images.
Recharger la page Médias pour actualiser les indications et la sélection des fichiers.
Avec `npm run dev`, relancer la commande après modification du `.env`.

La durée maximale des vidéos reste de 5 minutes ; les limites de résolution
restent de 40 mégapixels pour les images et de 4K pour les vidéos. Le poids réglé
concerne le fichier envoyé : une vidéo convertie peut avoir un poids différent.

## Langue de l’interface

L’application suit les préférences de langue du téléphone ou du navigateur,
transmises dans `Accept-Language`. Elle prend en charge le français, l’anglais,
l’allemand, l’italien et l’espagnol. Les variantes régionales utilisent la même
traduction, par exemple `fr-CH` et `fr-FR` utilisent le français. Si aucune langue
préférée n’est disponible, l’application utilise l’anglais.

La traduction s’applique dès le premier affichage aux onglets, formulaires,
messages d’erreur, confirmations, textes d’aide et libellés d’accessibilité.
Les quatre onglets gardent leur ordre et leurs adresses. Les dates suivent la
langue de l’utilisateur, avec le fuseau horaire de la fête ; les champs de saisie
de dates de l’organisateur utilisent celui de son appareil.

Les prénoms, messages du livre d’or, titres et descriptions saisis par les invités
ou l’organisateur restent tels qu’ils ont été écrits. Ils ne sont pas envoyés à un
service de traduction. Pour personnaliser la connexion dans plusieurs langues,
utiliser les variables avec suffixe décrites ci-dessus. Une ancienne valeur
commune française dans `.env` reste affichée telle quelle : la commenter permet
de retrouver les traductions par défaut.

## Créer l'accès organisateur

Avec Docker Compose, le backend affiche automatiquement une ligne
`Administrator invitation: <url>` au démarrage. Ouvrir ce lien puis choisir
**Entrer**. Pour retrouver la ligne après un démarrage en arrière-plan :

```powershell
docker compose logs backend
```

Le lien utilise `PUBLIC_URL`. À chaque démarrage du backend, il remplace l'ancien
lien du premier administrateur actif, en conservant son identité et ses sessions.
S'il n'existe aucun administrateur actif, le profil `Admin` est créé. Le lien est
à usage unique et expire après 7 jours. Utiliser le dernier lien affiché.

Pour désactiver cet affichage, définir `PRINT_ADMIN_INVITATION=false` dans le `.env`
racine puis lancer `docker compose up -d`. En local avec `npm run dev`, il faut
définir explicitement `PRINT_ADMIN_INVITATION=true` pour activer cette fonction.

Pour créer manuellement un accès à ton nom, la commande reste disponible :

```powershell
docker compose exec backend birthday-server invite-admin --name "Your name"
```

En développement local, dans un second terminal avec la même configuration :

```powershell
npm run backend -- invite-admin --name "Your name"
```

Cette commande affiche un lien personnel d'activation. L'ouvrir puis choisir
**Entrer**. Conserver ce lien privé ; il représente un accès organisateur jusqu'à
son utilisation ou son expiration. Le serveur n'affiche pas ce lien dans ses logs
HTTP ordinaires.

Dans **paramètres**, l'organisateur peut renseigner la fête, ajouter les invités,
copier leurs liens personnels, réémettre un lien, révoquer un accès et gérer le
programme. Les liens sont envoyés manuellement par le moyen de son choix.
L'application n'envoie aucun e-mail ni message WhatsApp.

## Invitations et confidentialité

- Chaque invité possède un profil préparé par l'organisateur. Il n'existe pas
  d'inscription publique, de mot de passe ni de compte de démonstration.
- Le lien d'invitation expire après 7 jours et fonctionne une seule fois.
  L'ouverture seule ne le consomme pas : il faut appuyer sur **Entrer**.
- Le navigateur garde une session pendant 90 jours, sauf déconnexion ou révocation.
  Une nouvelle invitation peut retrouver le même profil sur un autre navigateur.
- Réinviter une personne dont l'accès a été retiré réactive son profil et conserve
  ses contributions. Ses anciennes sessions restent invalides ; elle doit
  activer le nouveau lien.
- Avant activation, une personne à qui le lien est transféré peut prendre cet
  accès. Le partager uniquement avec son destinataire. Une session déjà ouverte
  dépend aussi de la confidentialité du navigateur utilisé.
- Tous les invités actifs voient les photos, les vidéos, les messages et les événements
  disponibles. Un auteur peut supprimer ses propres contributions ;
  l'organisateur peut modérer toutes les contributions.
- Dans le livre d’or, cocher **Publier anonymement** masque le nom aux invités
  et à l’organisateur. L’auteur peut toujours supprimer son message. Son identité
  reste enregistrée dans la base privée pour gérer ce droit.
- Les photos et vidéos sont protégées par la même connexion que l'application.
  Les formats acceptés sont JPEG, PNG et WebP, jusqu'à 40 mégapixels.
  Les vidéos acceptées sont MP4, MOV et WebM, jusqu’à 5 minutes et 4K.
  Les poids maximaux viennent du `.env` : 15 Mio par image et 100 Mio par vidéo
  par défaut.
  Elles sont converties en MP4 H.264/AAC, jusqu’à 1280×720 et 30 images/seconde,
  puis leur fichier d’origine est supprimé. La galerie accepte au plus 5 000
  fichiers et 10 Gio ; les nouveaux envois comptent aussi leur vignette.
- Les fichiers reçus sont placés dans une file persistante, puis préparés deux
  par deux. L'invité peut changer d'onglet pendant l'envoi et retrouver les fichiers
  déjà reçus après un rechargement. Les fichiers encore sur le téléphone exigent
  de garder la page ouverte jusqu'à la fin de leur transfert.
  La file accepte 100 fichiers actifs par invité, 1 000 au total et 10 Gio d'entrées.
- Go masque le titre privé et la description des surprises avant leur ouverture.
  Un aperçu public peut être défini. Le fuseau initial est **Europe/Zurich**,
  modifiable par l'organisateur ; les instants sont enregistrés en UTC.
- Aucune suppression automatique des souvenirs n'est programmée. L'organisateur
  décide de leur durée de conservation et peut supprimer les contributions.

## Vérifier le projet

```powershell
# Go static analysis and tests, frontend lint, types and tests
npm run check

# Frontend production build
npm --prefix frontend run build

# End-to-end browser tests (Chrome must be installed)
npm run test:e2e

# Check frontend formatting
npm --prefix frontend run format:check
```

Arrêter `npm run dev` avant les tests navigateur ou une compilation de production :
ces commandes partagent le répertoire de compilation Next. Les tests navigateur
utilisent un port, un dossier de médias et un conteneur PostgreSQL temporaires
propres aux tests. Docker doit tourner pour `npm run check` et `npm run test:e2e` ;
la base de test est supprimée après la commande, sans toucher aux données de la fête.
Voir aussi les
instructions [frontend](frontend/AGENTS.md) et [backend](backend/AGENTS.md).

Vérifications du 15 octobre 2026, après passage à PostgreSQL et ajout de la file
persistante : analyse et tests Go avec PostgreSQL et FFmpeg, lint, types,
19 tests frontend, 22 parcours Chrome et les deux images Docker réussis.
Les tests couvrent aussi les migrations, l'import SQLite, la reprise après
redémarrage, les envois simultanés, les doublons et la navigation pendant l'envoi.
L'import réel a été comparé table par table à la sauvegarde SQLite avant le
redémarrage de l'application ; la page servie par Docker a été vérifiée dans
les cinq langues et avec le repli vers l'anglais.

Après réorganisation du code Go et correction des erreurs de traitement des médias,
les tests backend passent aussi avec le détecteur de courses dans un conteneur Linux,
PostgreSQL et FFmpeg : 146 tests et sous-tests réussis, aucun ignoré. Ils vérifient
notamment les disques pleins, la conservation des originaux lors d'une panne,
les délais des requêtes et la progression des autres envois pendant une reprise.

Vérifications du 14 octobre 2026 : analyse et tests Go, lint, types, 18 tests
frontend, 19 parcours Chrome, formatage et build production réussis. Les parcours
couvrent invitations, photos et vidéos privées, livre d'or anonyme, révocation, déverrouillage et
administration, ainsi que les cinq langues et le repli vers l’anglais ; les vues
mobile et ordinateur ont été inspectées. Le détecteur
de courses Go nécessite cgo et n'a pas pu être exécuté sur cette machine.
Les tests vidéo utilisent FFmpeg sur Windows et dans Alpine 3.22, y compris
la limite de cinq minutes et la lecture par plages d’octets.
Les limites de poids personnalisées sont vérifiées côté navigateur et serveur.
Un envoi de 106 Mio à travers le proxy de production a confirmé leur prise en
compte avec les mêmes images Docker, sans reconstruction.

L'audit des dépendances de production npm et `govulncheck` ne signalent aucune
vulnérabilité connue. L'audit npm complet signale une vulnérabilité de `braces`
remontée par 5 dépendances de l'outillage ESLint, sans version corrigée disponible
à cette date. Ces dépendances sont réservées au développement ; suivre la mise à
jour de `eslint-config-next` et relancer l'audit.

## Exécuter avec Docker

La configuration Compose fournit les deux applications et PostgreSQL 18.
Le volume `postgres-data` conserve les enregistrements et la file d'attente ;
`party-data` conserve les photos, vidéos, vignettes et fichiers en attente.
L'application reste accessible uniquement depuis la machine hôte sur le port 3000 ;
Go et PostgreSQL n'ont aucun port public.
Le démarrage Compose, l'ouverture de la page d'invitation dans Chrome et l'accès
à l'API via le frontend ont été vérifiés le 14 octobre 2026.

```powershell
docker compose up -d
docker compose logs -f backend
docker compose down
```

Le lien administrateur apparaît dans les logs du backend à chaque démarrage.
`docker compose up` sur un backend déjà lancé et inchangé ne génère pas de nouveau
lien. `docker compose restart backend` en génère un nouveau.

Ouvrir **http://localhost:3000** sur cette machine. `docker compose ps` doit
afficher `127.0.0.1:3000->3000/tcp` pour le frontend. Si le conteneur démarre mais
que ce port n'est pas publié, recréer uniquement le frontend pour rétablir son
raccordement au réseau, sans toucher au volume de données :

```powershell
docker compose up -d --no-deps --force-recreate frontend
```

Cette configuration prépare l'exécution, sans publier le site. Pour le mettre en
ligne, installer un reverse proxy HTTPS devant le frontend, définir
`PUBLIC_URL=https://votre-domaine` et `COOKIE_SECURE=true`, puis recréer les
conteneurs. Conserver le backend sur le réseau privé et le volume de données sur
un stockage persistant. Les invitations générées utilisent `PUBLIC_URL` :
`localhost` ne permet pas aux invités de se connecter depuis leur téléphone.

Le reverse proxy doit accepter le plus grand des deux poids configurés,
avec au moins 64 Kio pour le formulaire, et un délai de 10 minutes pour
l’envoi des fichiers. La préparation des vidéos continue en arrière-plan après
la réponse 202. Le proxy ne doit pas mettre en
cache les pages privées, les API ni les médias authentifiés. La destination du
proxy Next est fixée pendant la compilation via `API_INTERNAL_URL` ; reconstruire
le frontend si cette adresse interne change.

Les migrations SQL et la procédure de sauvegarde sont décrites dans
[docs/database.md](docs/database.md). Sauvegarder ensemble PostgreSQL et les médias,
avec le backend arrêté pour conserver leur cohérence.

Au premier démarrage de cette version, une ancienne base `birthday.sqlite` dans
`party-data` est importée automatiquement vers une base PostgreSQL vide.
Les invités, sessions, messages et références des médias sont conservés ; le fichier
SQLite reste intact. Une base PostgreSQL déjà remplie sans trace d'import provoque
un arrêt explicite pour éviter de mélanger deux jeux de données.
