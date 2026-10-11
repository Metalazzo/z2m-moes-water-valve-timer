# Vanne Moes ZWV-YC / Tuya TS0049 — changer l'arrêt automatique codé en dur de 10 minutes

Un **converter externe Zigbee2MQTT** qui ajoute une entité Home Assistant pour modifier le
minuteur d'auto-fermeture du firmware de la vanne **Moes ZWV-YC** (aussi appelée **Tuya
TS0049**). Par défaut, la vanne se ferme toute seule **10 minutes** (600 s) après ouverture,
peu importe qui l'a ouverte (Home Assistant, interface Zigbee2MQTT, MQTT…). Ce converter
permet de régler 30 minutes, 1 heure, 2 heures, 3 heures… selon le besoin.

* Pas de passerelle Tuya/Moes, pas de compte cloud.
* Pas de second coordinateur Zigbee : la commande est envoyée par Zigbee2MQTT à travers
  **votre coordinateur existant** (testé sur un dongle Silicon Labs / EmberZNet « ezsp »).
* La nouvelle valeur est stockée **dans le firmware de la vanne** : elle survit aux
  redémarrages, au ré-appairage et, d'après les retours de la communauté, même à une
  réinitialisation d'usine. Une fois réglée, le converter peut être retiré.
* Le converter n'ajoute qu'**une seule entité** (`irrigation_timer`). Les entités
  `switch` / batterie / linkquality existantes restent inchangées.

> **Testé et vérifié sur un vrai appareil** : timer réglé à 300 s puis vanne ouverte →
> fermeture automatique après **300,2 s** (au lieu de 600 s), on/off toujours fonctionnel.

---

## Sommaire

1. [Le problème](#le-problème)
2. [Démarrage rapide](#démarrage-rapide)
3. [Prérequis](#prérequis)
4. [Installation](#installation)
5. [Trouver le fingerprint de votre vanne](#trouver-le-fingerprint-de-votre-vanne)
6. [Utilisation](#utilisation)
7. [Vérifier que le nouveau timer fonctionne](#vérifier-que-le-nouveau-timer-fonctionne)
8. [Comment ça marche](#comment-ça-marche)
9. [Persistance et retour arrière](#persistance-et-retour-arrière)
10. [Compatibilité et journal de test](#compatibilité-et-journal-de-test)
11. [Dépannage](#dépannage)
12. [Consignes de sécurité](#consignes-de-sécurité)
13. [Structure du dépôt](#structure-du-dépôt)
14. [Crédits et références](#crédits-et-références)
15. [Licence](#licence)

---

## Le problème

La Moes ZWV-YC (Tuya TS0049, sur batterie) possède un **timer d'auto-fermeture de
600 secondes codé en dur** dans son firmware (protection anti-inondation). Symptômes typiques :

* La vanne se ferme toujours toute seule après ~10 minutes, quelle que soit la source.
* Envoyer `on_time` dans la charge utile du cluster On/Off est ignoré silencieusement par
  le firmware.
* L'interface Zigbee2MQTT n'expose aucun réglage de timer.
* Certaines tentatives via les datapoints Tuya (DP 101 pour `state`) **cassent le on/off**
  sur ce matériel — à éviter (voir [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)).

Le timer vit dans le cluster propriétaire Tuya `0xE001`. Ce converter envoie la trame ZCL
brute correcte pour que le firmware accepte une nouvelle valeur.

Solutions existantes et leurs contraintes :

| Méthode | Matériel supplémentaire | Notes |
|---|---|---|
| Passerelle Tuya/Moes | un hub Tuya + l'appli | Fonctionne ; la valeur persiste après ré-appairage à Zigbee2MQTT |
| Script ZCL brut avec ConBee II/III (`fergus3000/tuya-ts0049-timer-fix`) | un dongle ConBee + deCONZ/zigpy | Éprouvé ; la valeur persiste |
| **Ce converter** | **aucun** | Fonctionne avec n'importe quel coordinateur Zigbee2MQTT ; la valeur persiste |

## Démarrage rapide

1. Vérifiez que Zigbee2MQTT autorise le JavaScript externe
   (`advanced: enable_external_js: true` dans `configuration.yaml`, puis un redémarrage).
2. Copiez [`external_converter/moes_water_valve_timer.js`](external_converter/moes_water_valve_timer.js)
   dans le dossier `external_converters/` de Zigbee2MQTT.
3. Redémarrez Zigbee2MQTT (ou chargez-le à chaud via MQTT, voir [Installation](#installation)).
4. Une nouvelle entité apparaît dans Home Assistant : `number.<votre_vanne>_irrigation_timer`.

## Prérequis

* **Zigbee2MQTT ≥ 2.11** avec le JavaScript externe activé (par défaut `true` en amont, mais
  les nouvelles installations depuis la 2.11 écrivent
  `advanced.enable_external_js: false` dans `configuration.yaml`).
* N'importe quel coordinateur Zigbee pris en charge — la trame brute est envoyée par
  Zigbee2MQTT lui-même.
* Home Assistant est optionnel : le réglage est aussi utilisable depuis l'interface
  Zigbee2MQTT (onglet *Exposes*) ou en publiant des messages MQTT.

Testé avec :

* Zigbee2MQTT **2.14.1** (zigbee-herdsman `10.9.2`, zigbee-herdsman-converters `26.105.0`),
  Home Assistant OS avec l'add-on Zigbee2MQTT, dongle Silicon Labs / EmberZNet (**ezsp**).
* Toujours fonctionnel après la mise à jour automatique vers Zigbee2MQTT **2.14.2**.

## Installation

### Étape 1 — activer le JavaScript externe dans Zigbee2MQTT

Vérifiez `configuration.yaml` (dans le dossier de données Zigbee2MQTT, par ex.
`/config/zigbee2mqtt/configuration.yaml` pour l'add-on Home Assistant) :

```yaml
advanced:
  enable_external_js: true
```

* Si la clé est absente, le JS externe est actif par défaut — rien à faire.
* Si elle vaut `false`, passez-la à `true` et **redémarrez Zigbee2MQTT** (ce réglage exige
  un redémarrage).
* Pour confirmer : quand la clé vaut `false`, Zigbee2MQTT écrit au démarrage
  `External JS (converters/extensions) is disabled`.

### Étape 2 — copier le fichier du converter

Copiez `moes_water_valve_timer.js` dans le dossier `external_converters` de votre dossier de
données Zigbee2MQTT :

| Installation | Chemin |
|---|---|
| Home Assistant OS / Supervised (add-on Zigbee2MQTT) | `/config/zigbee2mqtt/external_converters/moes_water_valve_timer.js` |
| Standalone / Docker | `<dossier_de_donnees_zigbee2mqtt>/external_converters/moes_water_valve_timer.js` |

Utilisez l'add-on File editor, Samba ou SSH. Créez le dossier `external_converters` s'il
n'existe pas. (Quand le dossier de données diffère du dossier d'installation de
Zigbee2MQTT, Zigbee2MQTT crée automatiquement un lien symbolique `node_modules` à
l'intérieur pour que le converter puisse faire ses `require(...)` — aucune action requise.)

### Étape 3 — le charger

**Option A — redémarrer Zigbee2MQTT** (simple, ~30-60 s d'indisponibilité Zigbee).

**Option B — chargement à chaud sans redémarrage** (Zigbee2MQTT ≥ 2.14) :

```bash
# 1) construire la charge utile JSON (code embarqué comme chaîne)
jq -n --rawfile code moes_water_valve_timer.js \
   '{name:"moes_water_valve_timer.js", code:$code}' > payload.json

# 2) dans un terminal, écouter la réponse
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/response/converter/save' -C 1 -W 10

# 3) dans un autre terminal, l'envoyer
mosquitto_pub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/request/converter/save' -f payload.json
# réponse attendue : {"data":{},"status":"ok"}
```

### Étape 4 — vérifier l'installation

```bash
# le converter doit être listé
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/converters' -C 1 -W 10 | jq -r '[.[].name] | @csv'
# -> "moes_water_valve_timer.js",...

# la vanne doit utiliser la définition externe, avec le nouvel expose
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/devices' -C 1 -W 10 \
| jq -c '.[] | select(.friendly_name=="<votre vanne>") | {source:.definition.source, exposes:[.definition.exposes[].name]}'
# attendu : {"source":"external","exposes":["irrigation_timer","battery",null,"linkquality"]}
```

Dans Home Assistant, une nouvelle entité apparaît :
`number.<votre_vanne>_irrigation_timer`.

> `zigbee2mqtt/bridge/devices` est un topic MQTT **retenu**. Après un chargement à chaud, il
> peut encore afficher l'ancienne définition tant qu'il n'est pas republié — redémarrez
> Zigbee2MQTT pour le rafraîchir.

## Trouver le fingerprint de votre vanne

Le converter doit « gagner » contre la définition interne, ce qui exige un **fingerprint**
correspondant (voir [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) pour l'explication).

Trouvez le vôtre dans l'interface Zigbee2MQTT : appareil → **About** →
`manufacturerName` (ex. `_TZ3000_ogjpfoyn`) et `modelID` (`TS0049`).

Le converter liste déjà les fingerprints connus de la définition d'origine ZWV-YC :

| manufacturerName | Statut |
|---|---|
| `_TZ3000_ogjpfoyn` | **testé** |
| `_TZ3000_cjfmu5he` | attendu fonctionnel (même famille matérielle, trame brute validée par `fergus3000`) |
| `_TZ3000_mq4wujmp` | attendu fonctionnel |
| `_TZ3000_5af5r192` | attendu fonctionnel |

Si votre `manufacturerName` n'est pas dans la liste (d'autres variantes TS0049 existent, par
ex. `_TZ3000_kz1anoi8`), ajoutez une ligne au tableau `fingerprint` :

```js
{modelID: 'TS0049', manufacturerName: '_TZ3000_votre_valeur', priority: 1},
```

## Utilisation

La nouvelle entité est de type nombre, en **secondes** :

```yaml
# appel de service Home Assistant
action: number.set_value
target:
  entity_id: number.<votre_vanne>_irrigation_timer
data:
  value: 7200   # 2 heures
```

Valeurs courantes :

| Durée | Secondes |
|---|---|
| 5 min | 300 |
| 10 min (défaut usine) | 600 |
| 30 min | 1800 |
| 1 heure | 3600 |
| 2 heures | 7200 |
| 3 heures | 10800 |
| 6 heures | 21600 |
| 12 heures | 43200 |
| 24 heures | 86400 |

L'entité accepte 1 à 86400 s (24 h). Le firmware accepte jusqu'à 4294967294 s ; modifiez
`value_max` dans le converter si besoin. Depuis l'interface Zigbee2MQTT, réglez-la dans
l'onglet **Exposes** de l'appareil. Équivalent MQTT brut :

```bash
mosquitto_pub ... -t 'zigbee2mqtt/<votre vanne>/set' -m '{"irrigation_timer":7200}'
```

## Vérifier que le nouveau timer fonctionne

Réglez une valeur courte (ex. 300 s), ouvrez la vanne, et observez le topic de l'appareil :

```bash
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/<votre vanne>' -F '%I %t %p'
```

Exemple réel issu du test qui a validé ce converter :

```
2026-09-27T15:09:21 zigbee2mqtt/<vanne> {"irrigation_timer":300,"state":"OFF"}
2026-09-27T15:09:23 zigbee2mqtt/<vanne> {"irrigation_timer":300,"state":"ON"}
2026-09-27T15:14:24 zigbee2mqtt/<vanne> {"irrigation_timer":300,"state":"OFF"}   # +300,2 s
```

La vanne est un appareil terminal sur batterie (« sleepy ») : les commandes peuvent mettre
quelques secondes à être délivrées et l'état du switch peut légèrement retarder. C'est normal.

## Comment ça marche

Le timer est contrôlé par une trame ZCL Tuya brute sur le cluster `0xE001` :

| Octet | Valeur | Signification |
|---|---|---|
| 0 | `0x11` | Frame control : spécifique cluster, client→serveur, réponse par défaut désactivée, **pas de code fabricant** |
| 1 | `0xNN` | Numéro de séquence (arbitraire) |
| 2 | `0xFE` | ID de commande (timer Tuya) |
| 3 | `0x0B` | Sous-commande (réglage du timer) |
| 4-7 | `UInt32BE(secondes)` | Durée en secondes, big-endian |

Exemple pour 3 heures (10800 s = `0x00002A30`) : `11 01 FE 0B 00 00 2A 30`.

Zigbee2MQTT/zigbee-herdsman ne connaît ni ce cluster ni cette commande : le converter les
déclare et passe directement l'objet cluster à `endpoint.command()` — le helper garde la
définition identique à celle d'origine, à l'ajout près. Détails complets, y compris comment
adapter le code si une future version de zigbee-herdsman change son API, dans
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Persistance et retour arrière

* La valeur est stockée **dans le firmware de la vanne**, pas dans le converter : après
  réglage, vous pouvez retirer le converter et le nouveau délai reste.
* Elle survit aux redémarrages et mises à jour de Zigbee2MQTT, au ré-appairage de la vanne
  et (d'après la communauté) aux réinitialisations d'usine.
* **Retirer le converter** :
  * à chaud : `mosquitto_pub ... -t 'zigbee2mqtt/bridge/request/converter/remove' -m '{"name":"moes_water_valve_timer.js"}'`
  * ou supprimez le fichier et redémarrez Zigbee2MQTT.
* Une fois retiré, l'entité `number.*_irrigation_timer` disparaît de Home Assistant (la
  valeur reste dans la vanne jusqu'au prochain changement).
* Pour changer la valeur à nouveau, réinstallez le converter (ou utilisez une passerelle Tuya).

## Compatibilité et journal de test

| Date | Zigbee2MQTT | Notes |
|---|---|---|
| 2026-09-27 | 2.14.1-1 (herdsman 10.9.2, zhc 26.105.0) | Installé sur un appareil réel (`_TZ3000_ogjpfoyn`). Timer réglé à 300 s → fermeture mesurée à **300,2 s**. On/off vérifié inchangé. Puis réglé à 7200 s. |
| 2026-10-11 | 2.14.2-1 | Après mise à jour automatique de Zigbee2MQTT : converter toujours chargé, définition toujours `external`, valeur toujours appliquée. |

## Dépannage

Liste rapide (guide complet : [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)) :

* **Pas d'entité dans Home Assistant** → le converter est-il listé dans
  `bridge/converters` ? `bridge/devices` affiche-t-il `"source":"external"` pour la vanne ?
  S'il affiche `native`, votre fingerprint n'est pas reconnu — ajoutez votre
  `manufacturerName` au tableau `fingerprint`.
* **Converter non listé** → le JS externe est peut-être désactivé (cherchez la ligne de log
  `External JS (converters/extensions) is disabled`, ou le réglage
  `advanced.enable_external_js`). Un converter avec une erreur de syntaxe est journalisé puis
  **renommé** par Zigbee2MQTT pour ne pas interférer — vérifiez le dossier.
* **Ça a « à peu près » marché mais le on/off est cassé** → assurez-vous que la définition
  utilise toujours `m.onOff(...)` (genOnOff). Ne déplacez **pas** `state` vers le datapoint
  Tuya DP 101 : sur ce matériel, la voie DP n'actionne pas le relais (c'est ce qui a cassé
  zigbee-herdsman-converters #12283 — annulé par #12396).
* **Le réglage semble ignoré les premières secondes** → la vanne est un appareil sur
  batterie « sleepy » ; la commande est délivrée à son prochain poll. Laissez quelques
  secondes.

## Consignes de sécurité

L'arrêt automatique à 600 s est une **protection anti-inondation**. Passer à 2 heures
signifie que si Home Assistant, Zigbee2MQTT ou le réseau tombe pendant que la vanne est
ouverte, l'eau peut couler jusqu'à 2 heures. Choisissez la plus petite valeur couvrant votre
usage réel le plus long, et prévoyez une protection indépendante (capteur de niveau/débit,
minuteur mécanique) pour tout ce qui est sensible, comme le remplissage d'une piscine.

## Structure du dépôt

```
.
├── external_converter/
│   └── moes_water_valve_timer.js    # le converter externe Zigbee2MQTT
├── docs/
│   ├── PROTOCOL.md                  # la trame ZCL brute, exemples, notes d'implémentation
│   ├── TROUBLESHOOTING.md           # guide de dépannage détaillé
│   └── INVESTIGATION.md             # comment le problème a été diagnostiqué (preuves, méthode)
├── examples/
│   └── home_assistant_examples.yaml # exemples d'automatisations / appels de service
├── CHANGELOG.md
├── LICENSE
├── README.fr.md                     # cette version française
└── README.md                        # version anglaise
```

## Crédits et références

* [`fergus3000/tuya-ts0049-timer-fix`](https://github.com/fergus3000/tuya-ts0049-timer-fix) —
  le script ConBee/deCONZ qui a documenté la trame brute et prouvé que le timer peut être
  changé et persiste.
* Issues/discussions Zigbee2MQTT :
  [#28589](https://github.com/Koenkk/zigbee2mqtt/issues/28589) (demande de fonctionnalité, trame sniffée),
  [#24804](https://github.com/Koenkk/zigbee2mqtt/issues/24804),
  [#21788](https://github.com/Koenkk/zigbee2mqtt/issues/21788).
* zigbee-herdsman-converters
  [#12283](https://github.com/Koenkk/zigbee-herdsman-converters/issues/12283) /
  [#12396](https://github.com/Koenkk/zigbee-herdsman-converters/issues/12396) — pourquoi il
  ne faut pas utiliser la voie datapoint Tuya pour `state` sur cette vanne.
* Communauté Home Assistant :
  [Zigbee2MQTT water valves — unwanted auto-off behaviour](https://community.home-assistant.io/t/zigbee2mqtt-controlling-water-valves-but-with-unwanted-auto-off-behavior/889517).

## Licence

[MIT](LICENSE)
