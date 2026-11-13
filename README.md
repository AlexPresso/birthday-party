# Les 30 ans

Application privée pour un anniversaire : photos et vidéos, programme avec surprises
programmées, livre d'or et paramètres. L'interface utilise un seul thème sombre
à accent orange, « K · Neige », décrit dans [le brief](docs/design.md).

Next.js et TypeScript affichent l'application. Un service Go gère les invitations,
les sessions, les permissions, PostgreSQL et les médias sur disque. Le navigateur
utilise une seule origine. En local et avec Compose, Next transmet `/api/*` au
serveur Go ; sur Kubernetes, l'Ingress envoie `/api` directement au backend.
Le [contrat HTTP](docs/api.md) décrit les échanges.
L'[organisation du code](docs/architecture.md) précise les responsabilités des
features frontend, des packages Go et des modules partagés.

## Skills du projet

Les skills sont inclus dans `.agents/skills/`, avec leurs références et licences :

- [Code Simplifier](.agents/skills/code-simplifier/SKILL.md), adapté de l'agent
  `code-simplifier` d'[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
  (Apache-2.0), pour les nettoyages demandés et la relecture de lisibilité après
  une implémentation. La provenance est conservée dans
  [SOURCE.md](.agents/skills/code-simplifier/SOURCE.md).
- [Go Style Guide](.agents/skills/go-style-guide/SKILL.md), issu de
  [madflojo/go-style-agent-skill](https://github.com/madflojo/go-style-agent-skill)
  (Apache-2.0), pour le code Go et l'évolution de l'architecture. Le commit source
  est fixé dans [UPSTREAM.md](.agents/skills/go-style-guide/UPSTREAM.md) ; les choix
  du projet sont précisés dans [backend/AGENTS.md](backend/AGENTS.md).
- [Vercel React Best Practices](.agents/skills/vercel-react-best-practices/SKILL.md),
  issu de [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills),
  sous licence MIT, pour les composants React, les échanges réseau et les bundles.
  La provenance est conservée dans
  [UPSTREAM.md](.agents/skills/vercel-react-best-practices/UPSTREAM.md). Les règles
  du projet gardent la priorité, notamment pour les données privées et le rôle de Go.
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

Prérequis : Node.js 24 ou plus récent (obligatoire : les scripts et les tests
exécutent TypeScript directement), npm, Go 1.26+ (la CI et l'image utilisent
Go 1.27.2), `ffmpeg` et `ffprobe` dans le `PATH`
pour vérifier les vidéos et créer leurs vignettes JPEG. Docker fournit
[FFmpeg](https://ffmpeg.org/download.html) automatiquement. Les tests vidéo
utilisent aussi les encodeurs H.264/AAC et VP9/Opus pour créer leurs fichiers.
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

## Diaporama

Dans **Médias**, sélectionne une catégorie puis clique sur **Lancer le diaporama**.
Seuls les médias de cette catégorie défilent, y compris ceux qui ne sont pas
encore chargés dans la grille. **Médias principaux** affiche uniquement les médias
sans catégorie.

Les photos restent affichées cinq secondes et les vidéos sont lues jusqu’au bout,
avec le son coupé au départ. Tu peux activer le son dans le lecteur, mettre en
pause, passer au média précédent ou suivant, et utiliser le plein écran si ton
navigateur le permet. Le diaporama reprend au début après le dernier média.
Ferme-le avec la croix ou la touche Échap.

## Sans filtre

Dans **Paramètres → Programme → Ajouter un événement**, choisis **Sans filtre**.
Règle son nom et son horaire, puis ouvre les questions depuis **Voir les questions**.
Les invités posent leurs questions anonymement, même les plus osées, et votent
pour celles qu’ils veulent entendre. Un second appui retire leur vote.

Les questions en attente remontent selon leurs votes. Tu réponds honnêtement à
l’oral, puis cliques sur **Marquer comme répondu**. Tu disposes de **deux jokers
pour toute l’activité** pour passer des questions. Le compteur est partagé entre
tous les invités ; un joker utilisé ne peut pas être annulé. Fermer les questions
arrête les nouveaux envois et les votes, tout en te laissant répondre aux questions
restantes. Chaque activité accepte jusqu’à 200 questions de 1 000 caractères.

## Photo de profil

Dans **Profil**, choisir une photo lance son envoi et remplace automatiquement
la photo de profil. Il est ensuite possible de la remplacer ou de la supprimer.
La photo apparaît dans l’en-tête et à côté de ses messages signés. Les messages
anonymes gardent leur icône neutre.

Les formats JPEG, PNG et WebP sont acceptés, avec la limite photo définie dans **Paramètres → Limites d’envoi**. Le serveur recadre la photo au centre et conserve une petite
version JPEG dans PostgreSQL ; l’original est supprimé. Ces photos restent
privées et sont incluses dans la sauvegarde de la base.

## Accueillir les invités par étapes

Dans **Paramètres → Accueil des invités**, crée jusqu’à 12 étapes. Chaque étape
contient une liste de widgets, sans titre ni texte obligatoire en dehors de cette
liste. Glisse un widget **Titre**, **Texte**, **Photo de profil**, **Photos et
vidéos** ou **Activer les notifications** depuis le volet des widgets vers l’étape, puis déplace-le à l’endroit
souhaité. Les boutons d’ajout et de déplacement permettent aussi de tout faire
au clavier. Enregistre les étapes pour conserver tes modifications.

Une étape peut contenir jusqu’à 12 widgets. Tu peux ajouter plusieurs titres,
textes ou zones d’envoi, une photo de profil et un widget de notifications. Les textes restent dans la langue
où tu les as écrits.

Le widget **Photo de profil** permet aux invités d’ajouter leur photo pendant
l’accueil, avec un aperçu avant l’enregistrement. La photo reste liée au profil
après l’accueil. Tu décides quand débloquer la suite ; chaque invité choisit
quand il est prêt à avancer.

Le widget d’envoi de photos et vidéos permet de recevoir des médias pendant
l’accueil. Dans ses réglages, choisis **Médias principaux** ou une catégorie.
Chaque zone d’envoi garde sa propre destination et affiche ses propres envois.
Les fichiers partagent la file d’attente habituelle, limitée à deux transferts
simultanés. Débloquer une nouvelle étape laisse les envois en cours continuer.
Quand l’invité change lui-même d’étape, les transferts que le serveur n’a pas
encore acceptés s’arrêtent ; les envois déjà acceptés continuent leur préparation.
Dans les médias comme dans chaque widget, une seule barre suit l’ensemble des
envois, avec le nombre de fichiers reçus sur le total. Les fichiers en attente
comptent dans ce total. Dans l’application, un bandeau compact suit les envois
au-dessus de la navigation. Un appui ouvre le statut de chaque fichier et permet
de réessayer un envoi en échec ; une vidéo reçue peut encore être en préparation.
Quand tous les fichiers sont prêts, la confirmation disparaît après deux secondes.
Elle reste visible pendant la consultation des détails ; les erreurs restent
affichées. Chaque média de la galerie est présenté individuellement, sans compteur
« 1/3 » ni bande de miniatures sous une publication.

**Activer l’écran d’attente** place tous les invités sur un écran séparé, y compris
ceux déjà connectés. Ton accès administrateur reste disponible. Clique sur
**Débloquer la première étape** : elle s’affiche automatiquement pour les invités
en attente. Aucun bouton **Commencer** n’apparaît avant ce déblocage. Pour la suite,
utilise **Débloquer l’étape suivante**. Le bouton **Suivant** apparaît alors chez
les invités, qui avancent à leur rythme et peuvent revenir avec **Précédent**.
Débloquer la suite laisse chacun sur son étape et garde ses widgets ouverts.
Les changements arrivent en direct par WebSocket ; après une reconnexion,
l’application retrouve la progression enregistrée.

Le switch **Obligatoire** impose toutes les étapes aux invités qui arrivent pour
la première fois, même si l’application est déjà ouverte. Sans cette option, un
nouvel arrivant rejoint la dernière étape débloquée pendant l’accueil, ou entre
directement si l’application est ouverte. Le réglage s’enregistre immédiatement.

**Ouvrir l’application** débloque les étapes restantes et permet aux invités de
choisir **Entrer dans l’application**. Ceux qui suivent un parcours obligatoire
doivent d’abord atteindre la dernière étape. Chacun garde sa position tant qu’il
n’a pas choisi d’entrer.

Tu peux modifier les étapes et leurs widgets à tout moment, même après leur
déblocage ou l’ouverture de l’application. Les changements enregistrés s’affichent
en direct. Une correction de texte conserve les sélections en cours ; un changement
de widget ou de destination réinitialise les widgets de l’étape concernée. Les envois déjà
acceptés gardent leur destination. Si la liste raccourcit, les invités concernés
reviennent à la dernière position disponible. Ceux qui ont terminé gardent leur accès.
Les étapes et la progression individuelle sont conservées après un rechargement
de page ou un redémarrage des conteneurs. **Relancer l’accueil** recommence le
parcours pour tous les invités.

L’application reste ouverte tant que tu n’as pas activé l’écran d’attente.

## Notifications sur le téléphone

Ajoute le widget **Activer les notifications** à une étape. L’invité choisit de
les activer, puis accepte la demande du navigateur. Il reçoit une notification
quand tu débloques une étape ou ouvres l’application. La notification ouvre sa
position actuelle, sans le faire avancer. Il peut aussi gérer les notifications
de cet appareil depuis **Profil**. Refuser n’empêche pas de poursuivre l’accueil.

Sur téléphone, l’application doit être servie en **HTTPS**. Sur iPhone et iPad,
ajoute-la à l’écran d’accueil puis ouvre-la depuis son icône avant d’activer les
notifications. Le widget affiche les instructions adaptées. Le site sur
`http://localhost` peut être utilisé pour les tests sur ordinateur.
Voir les conditions de [Web Push sur iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
et des [contextes sécurisés](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe).

Les clés de notification sont créées automatiquement et conservées dans
PostgreSQL, avec les abonnements des appareils. Aucun compte auprès d’un service
tiers n’est à créer. Le navigateur utilise son propre service de réception.
Les notifications ne contiennent ni noms d’invités, ni consignes privées, ni médias.
Se déconnecter supprime l’abonnement associé à cette session.

`VAPID_SUBJECT` permet de préciser une adresse de contact, par exemple
`mailto:you@example.com`. En HTTPS, sa valeur par défaut est `PUBLIC_URL`.
Le serveur envoie les notifications en arrière-plan et limite les tentatives en
cas de panne ; une notification n’est donc pas une garantie de réception immédiate.
Aucune nouvelle variable d’environnement n’est nécessaire.

## Catégories de médias

Dans **Paramètres → Catégories et visibilité**, crée une catégorie et choisis sa visibilité :

- **Privée** : seuls les administrateurs peuvent consulter ses fichiers, même
  lorsqu’un invité les a envoyés pendant l’accueil.
- **Publique** : les invités connectés peuvent la consulter dans l’onglet Médias
  une fois l’accès à l’application ouvert.

Tu peux rendre une catégorie publique plus tard pour dévoiler tous ses médias.
La galerie principale conserve les fichiers sans catégorie ; un filtre permet
de consulter chaque catégorie accessible. Les catégories sont limitées à 100,
avec un nom de 80 caractères maximum. Leur nom reste dans la langue où tu l’as écrit.

## Personnaliser l’anniversaire

Le bouton **Paramètres** est réservé aux administrateurs. Les réglages sont
regroupés sous **La fête**, **Invités et accès** et **Photos et vidéos**.
Chaque ligne ouvre une sous-page qui glisse de droite à gauche, avec une flèche
de retour dans le sens inverse. Les champs se sauvegardent quand tu les quittes
ou reviens au menu. En cas d’erreur, la page et ta saisie restent visibles.
L’âge se règle dans **Infos de la fête**, avec l’icône gâteau, et **Accueil des
invités** se trouve sous **La fête**. **Profil**, accessible à tous par la photo
ronde en bas à droite, regroupe la photo, les notifications et la déconnexion.

L’âge accepte un entier de 1 à 150 et apparaît sur l’invitation, dans l’en-tête
et dans le livre d’or. Les textes de l’invitation sont publics. Pour le titre
et la description, choisir le texte par défaut, masquer le texte ou fournir un
texte personnalisé. Des variantes peuvent être enregistrées en français,
anglais, allemand, italien et espagnol. La priorité est : texte de la langue,
texte commun, puis texte traduit par défaut. Masquer une variante la cache même
si un texte commun existe. Les contenus personnalisés ne sont pas traduits
automatiquement. Le titre accepte 200 caractères et la description 2 000.

Le nom de la fête reste modifiable séparément dans les paramètres. S’il est
vide, l’en-tête utilise le titre d’invitation ou le titre traduit par défaut.
La date, le lieu et le fuseau horaire se règlent indépendamment.

Les modifications sont enregistrées dans PostgreSQL et prennent effet sur les
prochaines lectures, sans redémarrage ni reconstruction. Lors du premier
démarrage de cette version, les valeurs existantes de `BIRTHDAY_AGE`,
`INVITATION_TITLE`, `INVITATION_DESCRIPTION`, leurs variantes par langue et les
limites de fichiers sont importées depuis le `.env` racine. Une variable absente
conserve le texte par défaut ; une valeur explicitement vide le masque. Les
démarrages suivants préservent la configuration enregistrée dans l’application.

Le `.env` racine et Compose gardent les réglages techniques : connexion à la
base, URL publique, cookies, ports et stockage. Compose ignore `frontend/.env`
et `frontend/.env.local`. Le script `npm run dev` charge également le `.env`
racine ; les variables du terminal sont prioritaires. `frontend/.env.example`
sert uniquement à lancer Next.js indépendamment.

## Limites des fichiers

Dans **Paramètres → Limites d’envoi**, régler les poids maximaux des photos et
vidéos en Mio (1 Mio = 1 048 576 octets), avec des entiers de 1 à 1024.
Les valeurs par défaut sont 15 Mio pour les photos et 100 Mio pour les vidéos.
La limite photo s’applique aussi aux photos de profil.

Go applique les limites enregistrées aux nouveaux envois. Les fichiers déjà
acceptés continuent leur traitement si une limite diminue. Recharger les pages
Médias ou Profil pour actualiser les indications et la sélection des fichiers.
En local et avec Compose, le proxy Next autorise jusqu’à 1024 Mio plus le
formulaire pour permettre une augmentation immédiate, sans redémarrage. Sur
Kubernetes, les envois vont directement de l’Ingress au backend : son contrôleur
doit accepter les limites choisies, comme tout autre reverse proxy externe. Le
[guide de la chart](charts/birthday-party/README.md#ingress-fichiers-et-websocket)
donne les réglages.

`MAX_IMAGE_SIZE_MB` et `MAX_VIDEO_SIZE_MB` dans le `.env` servent uniquement à
l’import initial. La durée maximale des vidéos reste de 5 minutes, les images
sont limitées à 40 mégapixels et les vidéos à la 4K. Les vidéos sont conservées
sans modification ; seule une vignette JPEG supplémentaire est créée.

## Langue de l’interface

L’application suit les préférences de langue du téléphone ou du navigateur,
transmises dans `Accept-Language`. Elle prend en charge le français, l’anglais,
l’allemand, l’italien et l’espagnol. Les variantes régionales utilisent la même
traduction, par exemple `fr-CH` et `fr-FR` utilisent le français. Si aucune langue
préférée n’est disponible, l’application utilise l’anglais.

La traduction s’applique dès le premier affichage aux onglets, formulaires,
messages d’erreur, confirmations, textes d’aide et libellés d’accessibilité.
Les onglets gardent leur ordre et leurs adresses ; Paramètres est réservé aux
administrateurs. Le bouton Profil reste accessible à tous. Les dates suivent la
langue de l’utilisateur, avec le fuseau horaire de la fête ; les champs de saisie
de dates de l’organisateur utilisent celui de son appareil.

Les prénoms, messages du livre d’or, titres et descriptions saisis par les invités
ou l’organisateur restent tels qu’ils ont été écrits. Ils ne sont pas envoyés à un
service de traduction. Pour personnaliser la connexion dans plusieurs langues,
utiliser le sélecteur **Texte à modifier** dans **Paramètres → Page d’invitation**. Une ancienne
valeur commune française importée reste affichée telle quelle : choisir
**Par défaut** permet de retrouver les traductions de l’application.

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
  Les poids maximaux se règlent dans **Paramètres → Limites d’envoi** : 15 Mio par image et 100 Mio par vidéo
  par défaut.
  Le fichier vidéo d’origine est conservé sans modification pour la lecture et
  le téléchargement : résolution, fréquence d’images, audio et qualité restent
  identiques. FFmpeg crée uniquement la vignette. La lecture dépend des formats
  et codecs pris en charge par le navigateur ; le téléchargement reste disponible.
  Les anciennes vidéos déjà converties gardent leur version MP4 ; leurs originaux
  supprimés ne peuvent pas être récupérés.
  La galerie accepte au plus 5 000 médias et 10 Gio ; le poids total inclut les
  originaux et les vignettes. Supprimer un média retire
  tous ses fichiers. Le volume Docker `party-data` conserve ces versions ensemble.
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

# End-to-end browser tests (Chrome, ffmpeg and ffprobe must be installed)
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

La CI GitHub Actions lance ces vérifications à chaque push et pull request :
`go vet` et les tests Go avec PostgreSQL et FFmpeg, le lint, les types et les
tests du frontend sur Node.js 24, puis les parcours Chrome. Les images ne sont
publiées qu’après leur réussite. Si un parcours échoue, le rapport Playwright et
les traces sont joints à l’exécution du workflow.

Vérifications complémentaires, à lancer au besoin :

```powershell
# Go race detector: needs cgo, so run it on Linux with TEST_DATABASE_URL set
go test -race ./...

# Known vulnerabilities in production dependencies
npm --prefix frontend audit --omit=dev
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Les commandes `go` se lancent depuis `backend/`. Sans `TEST_DATABASE_URL`, les
tests Go qui utilisent PostgreSQL sont ignorés ; sans `ffmpeg` ni `ffprobe`, les
tests vidéo le sont aussi.

## Exécuter avec Docker

Les [workflows GitHub Actions](.github/workflows) construisent les deux images et
les publient dans GHCR depuis la branche par défaut, les tags `v*` ou un lancement
manuel, une fois les tests réussis. Les pull requests vérifient la construction
sans publication. Les images
publiées prennent en charge `linux/amd64` et `linux/arm64` ; leurs noms sont
`ghcr.io/alexpresso/birthday-party-backend` et
`ghcr.io/alexpresso/birthday-party-frontend`. Utiliser le même tag `sha-<SHA complet>`
pour déployer une révision précise des deux composants.

La mise en production se fait sur Kubernetes : la
[chart Helm](charts/birthday-party/README.md) fournit les services, PostgreSQL
intégré ou externe, les volumes persistants, les NetworkPolicy et l'Ingress HTTPS
configurable, qui envoie `/api` directement au backend. Son guide décrit les
Secrets à créer et la commande `helm upgrade --install`.

La configuration Compose sert au développement local et aux essais sur une
machine. Elle fournit les deux applications et PostgreSQL 18.
Le volume `postgres-data` conserve les enregistrements et la file d'attente ;
`party-data` conserve les photos, vidéos, vignettes et fichiers en attente.
L'application reste accessible uniquement depuis la machine hôte sur le port 3000 ;
Go et PostgreSQL n'ont aucun port public.

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

Cette configuration ne publie pas le site ; pour le mettre en ligne, utiliser la
chart Helm. Pour essayer Compose derrière un reverse proxy HTTPS, définir
`PUBLIC_URL=https://votre-domaine` puis recréer les conteneurs : les cookies
sécurisés s'activent automatiquement avec une URL `https`. Laisser
`COOKIE_SECURE` non défini ; le backend refuse de démarrer avec
`COOKIE_SECURE=false` et une URL `https`. Conserver le backend sur le réseau
privé et le volume de données sur un stockage persistant. Les invitations
générées utilisent `PUBLIC_URL` :
`localhost` ne permet pas aux invités de se connecter depuis leur téléphone.

Les activités sont des événements du programme. Depuis **Programme → Gérer le
programme → Ajouter un événement**, choisir un événement classique ou un vote
pour une personne. Pour un vote, définir la question, les candidats et les horaires
dans le même formulaire, puis ouvrir le vote quand tout est prêt.
Les invités choisissent un portrait et confirment leur choix. Ils peuvent le
modifier jusqu’à la fermeture. L’organisateur voit le nombre de votes reçus,
ferme le vote, puis révèle les résultats quand il le souhaite. Les choix
individuels restent privés dans l’interface, y compris pour les administrateurs.
La liste des candidats et l’autorisation de voter pour soi-même se règlent avant
l’ouverture ; la question reste modifiable. Les votes sont conservés lors des
modifications du texte et des horaires de l’événement.

L’accueil, la file d’envoi des médias et le programme se mettent à jour par une
connexion WebSocket partagée, sans requêtes périodiques du navigateur. Le serveur
signale les changements et les déblocages programmés ; l’écran recharge alors les
données concernées. Après une coupure, la connexion se rétablit et l’écran récupère
l’état actuel. Les envois déjà acceptés continuent leur traitement sur le serveur.

Avec Compose, le proxy Next transmet aussi `/api/realtime` au backend ; aucun
port ni variable supplémentaire n’est nécessaire. Sur Kubernetes, l’Ingress envoie
ce chemin directement au backend. Le reverse proxy HTTPS ou l’Ingress doit laisser
passer les connexions WebSocket (`Upgrade` et `Connection`) sur ce chemin et les
garder ouvertes, avec un délai d’inactivité supérieur à 30 secondes. `PUBLIC_URL`
doit correspondre exactement à l’origine utilisée par les invités ; le serveur
refuse les connexions WebSocket provenant d’une autre origine.

Le reverse proxy doit accepter le plus grand des deux poids configurés,
avec au moins 64 Kio pour le formulaire, et un délai de 10 minutes pour
l’envoi des fichiers. La préparation des vidéos continue en arrière-plan après
la réponse 202. Le proxy ne doit pas mettre en
cache les pages privées, les API ni les médias authentifiés. La destination du
proxy Next est configurée au démarrage via `API_INTERNAL_URL` ; redémarrer le
frontend avec la nouvelle valeur si cette adresse interne change.

Les migrations SQL et la procédure de sauvegarde sont décrites dans
[docs/database.md](docs/database.md). Sauvegarder ensemble PostgreSQL et les médias,
avec le backend arrêté pour conserver leur cohérence.

Le schéma PostgreSQL est créé par une migration de base unique au premier
démarrage ; les changements suivants s'ajoutent comme migrations numérotées.
L'import automatique d'une ancienne base `birthday.sqlite` a été retiré.

## Licence

Birthday Party est distribué sous la licence GNU Affero General Public License,
version 3 uniquement (`AGPL-3.0-only`) ; le texte complet se trouve dans
[LICENSE](LICENSE). Si tu modifies l'application et la proposes en ligne, cette
licence te demande de mettre ton code source modifié à disposition de ses
utilisateurs.

Les éléments tiers inclus gardent leur propre licence, fournie dans leur dossier :

- les polices Unbounded et Figtree, sous SIL Open Font License 1.1
  ([frontend/public/fonts](frontend/public/fonts)) ;
- les icônes de l'interface viennent de Lucide (licence ISC) ; les icônes de
  l'application sont un dessin original du projet
  ([frontend/public/icons/LICENSE.txt](frontend/public/icons/LICENSE.txt)) ;
- les skills d'agents de `.agents/skills/`, sous licence Apache-2.0 ou MIT selon
  le skill (fichier `LICENSE` de chaque dossier).
