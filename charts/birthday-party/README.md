# Déployer Birthday Party avec Helm

La chart installe le frontend, un seul backend et PostgreSQL 18. Elle conserve les
médias et la base sur deux PVC distincts. Le backend utilise la stratégie
`Recreate` : une mise à jour entraîne une courte interruption, car les workers et
le stockage local nécessitent un seul processus Go.

Les images sont publiées par les [workflows GitHub Actions](../../.github/workflows)
dans `ghcr.io/alexpresso/birthday-party-frontend` et
`ghcr.io/alexpresso/birthday-party-backend`, une fois les tests réussis. Utilise le
même tag `sha-<SHA complet>` ou la même version publiée pour les deux composants.
Sans `imageTag`, la chart utilise son `appVersion` (`0.1.0`) : ce tag n'existe
qu'après la publication du tag Git `v0.1.0`. `latest` suit toujours la branche par
défaut, mais la chart ne l'utilise plus. Les tags de version et `sha-*` ne changent
pas : ils sont téléchargés avec `pullPolicy: IfNotPresent`.

Il faut Kubernetes 1.25 ou plus récent, Helm 3 ou 4, une StorageClass capable de
fournir les PVC et, pour un accès public, un contrôleur Ingress avec un certificat
TLS. La chart n'installe ni le contrôleur ni le gestionnaire de certificats.

## Premier déploiement

Créer un fichier local `.env.kubernetes`, déjà exclu de Git, avec une seule ligne
`password=<generated-password>`. Ce mot de passe servira à PostgreSQL ; conserver
le fichier et le Secret de façon privée.

```powershell
kubectl create namespace birthday-party
kubectl -n birthday-party create secret generic birthday-party-database --from-env-file=.env.kubernetes
```

Créer `birthday-values.yaml` en remplaçant le domaine et le tag par les valeurs du
déploiement. Le Secret TLS doit exister dans le même namespace, ou être créé par
le gestionnaire de certificats installé sur le cluster. Ajouter sous `ingress` les
annotations du contrôleur décrites dans
[Ingress, fichiers et WebSocket](#ingress-fichiers-et-websocket).

```yaml
publicUrl: https://party.example.com
imageTag: sha-REPLACE_WITH_FULL_COMMIT_SHA
ingress:
  enabled: true
  className: traefik
  host: party.example.com
  tls:
    enabled: true
    secretName: birthday-party-tls
backend:
  persistence:
    size: 20Gi
postgresql:
  persistence:
    size: 10Gi
```

Configurer les limites du contrôleur décrites plus bas, puis installer depuis la
racine du dépôt :

```powershell
helm upgrade --install birthday charts/birthday-party --namespace birthday-party --values birthday-values.yaml --wait --timeout 10m
kubectl -n birthday-party logs deployment/birthday-birthday-party-backend
```

Le backend affiche un lien administrateur à usage unique au démarrage, comme avec
Compose. `backend.printAdminInvitation: false` désactive cet affichage. Les cookies
sécurisés sont activés automatiquement lorsque `publicUrl` utilise HTTPS.
L'âge, les textes d'invitation et les limites d'envoi se règlent ensuite dans
l'application et restent en base lors des mises à jour.

Pour un essai local, créer le Secret puis indiquer seulement la révision à tester :

```powershell
helm upgrade --install birthday charts/birthday-party --namespace birthday-party --set imageTag=sha-REPLACE_WITH_FULL_COMMIT_SHA --wait --timeout 10m
kubectl -n birthday-party port-forward service/birthday-birthday-party-frontend 3000:3000
```

Ouvrir `http://localhost:3000`. Cette origine ne convient qu'à cet accès local :
sans Ingress, Next transmet `/api/*` au backend, comme avec Compose.
Le backend peut redémarrer pendant l'initialisation de PostgreSQL ; Kubernetes
relance le processus jusqu'à ce que la base soit disponible.

## Accès aux images GHCR

La publication utilise le `GITHUB_TOKEN` du workflow avec `packages: write`.
Aucun mot de passe de registre n'est à ajouter au dépôt. Pour un package privé,
le cluster doit disposer d'un accès en lecture. Depuis une machine où Docker est
déjà connecté à GHCR, exporter un fichier Docker `config.json` contenant les
identifiants de lecture, puis créer le Secret :

```powershell
kubectl -n birthday-party create secret generic ghcr --type=kubernetes.io/dockerconfigjson --from-file=.dockerconfigjson=./artifacts/ghcr-config.json
```

Le fichier doit contenir une entrée `auths` utilisable, et pas seulement une
référence à un gestionnaire d'identifiants local. Ajouter aux valeurs :

```yaml
imagePullSecrets:
  - name: ghcr
```

Pour un fork, remplacer aussi `frontend.image.repository` et
`backend.image.repository` par les noms publiés par son workflow.

## Ingress, fichiers et WebSocket

L'Ingress envoie `/api` directement au service du backend : API, envois de
fichiers, médias et WebSocket `/api/realtime`. Tous les autres chemins vont au
frontend. Les deux routes partagent le même domaine : les cookies et le contrôle
de l'en-tête `Origin` restent ceux de `publicUrl`. Le backend ne lit aucun en-tête
`X-Forwarded-*` ; il se fie uniquement à `publicUrl`. Les envois ne passent donc
plus par le proxy de Next, qui gardait chaque fichier en mémoire.

Le frontend continue d'appeler le backend côté serveur via `API_INTERNAL_URL`,
lu au démarrage : son image reste utilisable avec plusieurs noms de releases et
de namespaces. Sans Ingress (`kubectl port-forward`), Next transmet encore
`/api/*` au backend.

`publicUrl` doit être l'origine exacte utilisée dans le navigateur, sans chemin.
`ingress.host` doit correspondre à son domaine. Le contrôleur doit conserver les
en-têtes `Host` et `Origin`, accepter les connexions WebSocket et laisser passer
les cookies. Ne pas mettre en cache les réponses privées.

Le contrôleur doit, au moins pour `/api` :

- accepter 1024 Mio + 64 Kio par requête, soit 1025 Mio si son unité est le Mio.
  C'est le plafond de l'application ; Go applique les limites choisies dans ses
  paramètres ;
- laisser au moins 600 secondes aux envois et aux téléchargements ;
- transmettre le corps des requêtes au fil de l'eau, sans mise en tampon ;
- accepter l'upgrade WebSocket et garder la connexion ouverte plus de 30 secondes
  sans trafic.

Ces réglages dépendent du contrôleur ; la chart reste neutre et n'en applique
aucun par défaut. Avec ingress-nginx, tout passe par `ingress.annotations` :

```yaml
ingress:
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: 1025m
    nginx.ingress.kubernetes.io/proxy-request-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
```

Traefik transmet déjà les corps au fil de l'eau, sans limite de taille, et gère
les WebSockets : ne pas lui attacher de middleware `buffering`. Son délai de
lecture se règle sur l'entrypoint, dans sa configuration statique, et non par
annotation. La chart ne le modifie pas :

```yaml
# Traefik static configuration (CLI argument):
# --entryPoints.websecure.transport.respondingTimeouts.readTimeout=600s
ingress:
  className: traefik
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
```

Voir la [documentation Traefik](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)
pour la syntaxe de sa version.

## Sécurité des pods et du réseau

Les conteneurs du frontend et du backend tournent sans root, sans capacités Linux
et avec un système de fichiers racine en lecture seule. Le backend écrit
uniquement dans son volume `/data`, fichiers temporaires compris. Le frontend
écrit un seul fichier : à chaque démarrage, `startup.mjs` inscrit l'adresse du
backend dans `.next/routes-manifest.json`. Un conteneur d'initialisation copie ce
fichier dans un volume `emptyDir`, monté à sa place. Le cache de Next
(`.next/cache`) et `/tmp` reçoivent aussi un `emptyDir`.

`networkPolicy.enabled` (activé par défaut) crée des NetworkPolicy qui autorisent
seulement : les ports HTTP du frontend et du backend en entrée, le frontend vers le
backend, le backend vers PostgreSQL, le DNS, et le backend vers Internet sur le
port 443 pour les notifications Web Push. PostgreSQL n'accepte que le backend.
Avec une base externe, le backend peut joindre le port `externalDatabase.port`
(5432 par défaut). Ces règles n'ont d'effet que si le plugin réseau du cluster
applique les NetworkPolicy.

Par défaut, toute source peut joindre ces deux ports HTTP, ce qui convient à tous
les contrôleurs. Pour n'autoriser que le contrôleur Ingress, indiquer son
namespace ; `kubectl port-forward` continue de fonctionner :

```yaml
networkPolicy:
  ingressFrom:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: ingress-nginx
```

Le backend demande 512 Mio de mémoire et peut en utiliser 2 Gio : ses deux workers
décodent chacun une photo pouvant atteindre 40 mégapixels, et FFmpeg lit une image
par vidéo. `backend.goMemoryLimit` (`GOMEMLIMIT`, 1536 Mio) fait libérer la mémoire
de Go avant cette limite ; le garder en dessous de `resources.limits.memory`.

## PostgreSQL externe et volumes existants

Pour une base gérée séparément, créer un Secret contenant une URL PostgreSQL
complète, avec les identifiants et le mode TLS requis par ce serveur. Le compte
doit pouvoir appliquer les migrations SQL. Utiliser une connexion directe ou un
pooling de session : les workers conservent un verrou PostgreSQL de session, ce
qui exclut le pooling par transaction. Par exemple,
un fichier local `.env.kubernetes-database` contenant `DATABASE_URL=...` :

```powershell
kubectl -n birthday-party create secret generic birthday-external-database --from-env-file=.env.kubernetes-database
```

```yaml
postgresql:
  enabled: false
externalDatabase:
  existingSecret: birthday-external-database
  urlKey: DATABASE_URL
```

La chart ne crée alors ni PostgreSQL ni son PVC. Pour réutiliser des volumes,
définir `backend.persistence.existingClaim` et, avec PostgreSQL intégré,
`postgresql.persistence.existingClaim`. Les PVC doivent être dans le namespace
de la release. Le backend écrit avec l'UID/GID `10001`, PostgreSQL Alpine avec
`70`. Les volumes neufs reçoivent le groupe adapté via `fsGroup` ; des fichiers
restaurés avec des permissions `0700` doivent également avoir le bon propriétaire.
Le pilote de stockage doit prendre en charge ces permissions.

Les PVC PostgreSQL 18 sont montés sur `/var/lib/postgresql`, avec les données dans
`/var/lib/postgresql/18/docker`. Ne pas changer de version majeure ou passer à une
image PostgreSQL non Alpine par une simple modification du tag : une migration
de la base et une adaptation des chemins ou utilisateurs peuvent être nécessaires.
Changer le Secret d'une base déjà initialisée ne change pas son mot de passe SQL.
Après une rotation coordonnée côté base, redémarrer le backend pour relire le Secret.

`persistence.storageClass: ""` utilise la classe par défaut du cluster et `"-"`
demande un volume sans StorageClass. Les tailles et les ressources CPU/mémoire
se règlent dans [values.yaml](values.yaml), selon le stockage et les médias réels.

## Mises à jour et sauvegardes

Modifier `imageTag`, puis relancer `helm upgrade --install` avec le même fichier
de valeurs. Depuis la version 0.2.0 de la chart, l'Ingress route `/api` vers le
backend et les NetworkPolicy sont actives : vérifier les annotations du contrôleur
et, si besoin, `networkPolicy` avant la mise à jour.

Les migrations SQL s'exécutent au démarrage du backend. Tester les migrations et
sauvegarder avant la mise à jour : un rollback Helm ne restaure pas le schéma ni
les données de PostgreSQL.

Arrêter le backend avant de sauvegarder ensemble PostgreSQL et les médias ; voir
[la procédure de sauvegarde](../../docs/database.md). Ne pas lancer deux releases
sur la même base et le même stockage. Les PVC créés par la chart portent
`helm.sh/resource-policy: keep` et restent après `helm uninstall`. Pour les
réutiliser avec une nouvelle release, renseigner leurs noms dans `existingClaim`.
Conserver aussi les Secrets ; supprimer les PVC est une opération distincte qui
peut supprimer les données selon la politique du stockage.

## Vérification locale

```powershell
helm lint charts/birthday-party --strict
helm template birthday charts/birthday-party --values birthday-values.yaml
helm package charts/birthday-party --destination artifacts
```

Le workflow Helm vérifie aussi les variantes HTTPS avec ingress-nginx, base externe
et PVC existants sans NetworkPolicy.
Le rendu local valide les manifests ; il ne vérifie pas les identifiants du
registre, le provisionnement du stockage ou le contrôleur Ingress du cluster.
