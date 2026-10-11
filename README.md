# Moes ZWV-YC / Tuya TS0049 water valve — change the hardcoded 10-minute auto-off

A **Zigbee2MQTT external converter** that adds a Home Assistant entity to change the
firmware auto-close timer of the **Moes ZWV-YC** water valve (also known as **Tuya TS0049**).
By default the valve closes itself **10 minutes** (600 s) after being opened, no matter who
opened it (Home Assistant, Zigbee2MQTT frontend, MQTT, …). This converter lets you set it to
30 minutes, 1 hour, 2 hours, 3 hours… whatever you need.

* No Tuya/Moes gateway and no cloud account.
* No second Zigbee coordinator: the command is sent by Zigbee2MQTT through **your existing
  coordinator** (tested on a Silicon Labs / EmberZNet “ezsp” dongle).
* The new value is stored **in the valve firmware**: it survives reboots, re-pairing and,
  according to community reports, even a factory reset. Once set, you can remove the
  converter and keep the value.
* The converter only **adds one entity** (`irrigation_timer`). The existing
  `switch` / battery / linkquality entities are left untouched.

> **Tested and verified on a real device**: setting the timer to 300 s and opening the valve
> made it close by itself after **300.2 s** (instead of 600 s), with on/off still working.

---

## Table of contents

1. [The problem](#the-problem)
2. [Quick start](#quick-start)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [Find your valve fingerprint](#find-your-valve-fingerprint)
6. [Usage](#usage)
7. [Verify that the new timer works](#verify-that-the-new-timer-works)
8. [How it works](#how-it-works)
9. [Persistence and rollback](#persistence-and-rollback)
10. [Compatibility and test log](#compatibility-and-test-log)
11. [Troubleshooting](#troubleshooting)
12. [Safety notes](#safety-notes)
13. [Repository layout](#repository-layout)
14. [Credits and references](#credits-and-references)
15. [License](#license)

---

## The problem

The Moes ZWV-YC (Tuya TS0049, battery powered) has a **hardcoded 600-second auto-off timer**
in its firmware (flood protection). Typical observations:

* The valve always closes by itself after ~10 minutes, from any source.
* Sending `on_time` in the On/Off cluster payload is silently ignored by the firmware.
* The Zigbee2MQTT UI does not expose any timer setting.
* Some attempts to use the Tuya datapoint path (DP 101 for `state`) actually **break on/off**
  on this hardware — don’t do that (see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)).

The timer lives in the Tuya proprietary cluster `0xE001`. This converter sends the correct
raw ZCL frame so the firmware accepts a new value.

Existing workarounds and their requirements:

| Method | Extra hardware | Notes |
|---|---|---|
| Tuya/Moes ZigBee gateway | a Tuya hub + app | Works; the value persists when the valve is re-paired to Zigbee2MQTT |
| Raw ZCL script with ConBee II/III (`fergus3000/tuya-ts0049-timer-fix`) | a ConBee dongle + deCONZ/zigpy | Proven; the value persists |
| **This converter** | **none** | Works with any Zigbee2MQTT coordinator; value persists |

## Quick start

1. Make sure Zigbee2MQTT allows external JavaScript (`advanced: enable_external_js: true`
   in `configuration.yaml`, then restart Zigbee2MQTT once).
2. Copy [`external_converter/moes_water_valve_timer.js`](external_converter/moes_water_valve_timer.js)
   into your Zigbee2MQTT `external_converters/` folder.
3. Restart Zigbee2MQTT (or hot-load it via MQTT, see [Installation](#installation)).
4. A new entity appears in Home Assistant: `number.<your_valve>_irrigation_timer`.

## Requirements

* **Zigbee2MQTT ≥ 2.11** with external JavaScript enabled
  (upstream default is `true`, but new installations since 2.11 write
  `advanced.enable_external_js: false` into `configuration.yaml`).
* Any supported Zigbee coordinator — the raw frame is sent by Zigbee2MQTT itself.
* Home Assistant is optional: the setting is also usable from the Zigbee2MQTT frontend
  (*Exposes* tab) or by publishing MQTT messages.

Tested with:

* Zigbee2MQTT **2.14.1** (zigbee-herdsman `10.9.2`, zigbee-herdsman-converters `26.105.0`),
  Home Assistant OS with the Zigbee2MQTT add-on, Silicon Labs / EmberZNet (**ezsp**) dongle.
* Still working after the automatic update to Zigbee2MQTT **2.14.2**.

## Installation

### Step 1 — enable external JavaScript in Zigbee2MQTT

Check `configuration.yaml` (in your Zigbee2MQTT data directory, e.g.
`/config/zigbee2mqtt/configuration.yaml` for the Home Assistant add-on) for:

```yaml
advanced:
  enable_external_js: true
```

* If the key is absent, external JS is enabled by default — nothing to do.
* If it is set to `false`, change it to `true` and **restart Zigbee2MQTT** (this setting
  requires a restart to take effect).
* To confirm: when the key is `false`, Zigbee2MQTT logs
  `External JS (converters/extensions) is disabled` at startup.

### Step 2 — copy the converter file

Copy `moes_water_valve_timer.js` into the `external_converters` folder of your
Zigbee2MQTT data directory:

| Installation | Path |
|---|---|
| Home Assistant OS / Supervised (Zigbee2MQTT add-on) | `/config/zigbee2mqtt/external_converters/moes_water_valve_timer.js` |
| Standalone / Docker | `<zigbee2mqtt_data_dir>/external_converters/moes_water_valve_timer.js` |

Use the File editor add-on, Samba, or SSH. Create the `external_converters` folder if it
does not exist yet. (When the data directory differs from the Zigbee2MQTT install directory,
Zigbee2MQTT automatically creates a `node_modules` symlink inside it so that the converter
can `require(...)` its dependencies — no action needed.)

### Step 3 — load it

**Option A — restart Zigbee2MQTT** (simple, ~30-60 s of Zigbee downtime).

**Option B — hot-load without restarting** (Zigbee2MQTT ≥ 2.14):

```bash
# 1) build the JSON payload (code embedded as a string)
jq -n --rawfile code moes_water_valve_timer.js \
   '{name:"moes_water_valve_timer.js", code:$code}' > payload.json

# 2) in one terminal, listen for the answer
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/response/converter/save' -C 1 -W 10

# 3) in another terminal, send it
mosquitto_pub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/request/converter/save' -f payload.json
# expected answer: {"data":{},"status":"ok"}
```

### Step 4 — verify the installation

```bash
# the converter must be listed
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/converters' -C 1 -W 10 | jq -r '[.[].name] | @csv'
# -> "moes_water_valve_timer.js",...

# the valve must use the external definition, with the new expose
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/devices' -C 1 -W 10 \
| jq -c '.[] | select(.friendly_name=="<your valve>") | {source:.definition.source, exposes:[.definition.exposes[].name]}'
# expected: {"source":"external","exposes":["irrigation_timer","battery",null,"linkquality"]}
```

In Home Assistant, a new entity appears: `number.<your_valve>_irrigation_timer`.

> `zigbee2mqtt/bridge/devices` is a **retained** MQTT topic. After a *hot-load*, it can still
> show the old definition until it is republished — restart Zigbee2MQTT to refresh it.

## Find your valve fingerprint

The converter must “win” against the built-in definition, which requires a matching
**fingerprint** (see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for the why).

Find yours in the Zigbee2MQTT frontend: device → **About** → `manufacturerName` (e.g.
`_TZ3000_ogjpfoyn`) and `modelID` (`TS0049`).

The converter already lists the fingerprints known from the stock ZWV-YC definition:

| manufacturerName | Status |
|---|---|
| `_TZ3000_ogjpfoyn` | **tested** |
| `_TZ3000_cjfmu5he` | expected to work (same hardware family, raw frame validated by `fergus3000`) |
| `_TZ3000_mq4wujmp` | expected to work |
| `_TZ3000_5af5r192` | expected to work |

If your `manufacturerName` is not listed (other TS0049 variants exist, e.g.
`_TZ3000_kz1anoi8`), add one line to the `fingerprint` array:

```js
{modelID: 'TS0049', manufacturerName: '_TZ3000_yourvalue', priority: 1},
```

## Usage

The new entity is a number, in **seconds**:

```yaml
# Home Assistant service call
action: number.set_value
target:
  entity_id: number.<your_valve>_irrigation_timer
data:
  value: 7200   # 2 hours
```

Common values:

| Duration | Seconds |
|---|---|
| 5 min | 300 |
| 10 min (factory default) | 600 |
| 30 min | 1800 |
| 1 hour | 3600 |
| 2 hours | 7200 |
| 3 hours | 10800 |
| 6 hours | 21600 |
| 12 hours | 43200 |
| 24 hours | 86400 |

The entity allows 1 – 86400 s (24 h). The firmware itself accepts up to 4294967294 s; edit
`value_max` in the converter if you need more. From the Zigbee2MQTT frontend, set it in the
device **Exposes** tab. Raw MQTT equivalent:

```bash
mosquitto_pub ... -t 'zigbee2mqtt/<your valve>/set' -m '{"irrigation_timer":7200}'
```

## Verify that the new timer works

Set a short value (e.g. 300 s), open the valve, and watch the device topic:

```bash
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/<your valve>' -F '%I %t %p'
```

Real example from the test that validated this converter:

```
2026-09-27T15:09:21 zigbee2mqtt/<valve> {"irrigation_timer":300,"state":"OFF"}
2026-09-27T15:09:23 zigbee2mqtt/<valve> {"irrigation_timer":300,"state":"ON"}
2026-09-27T15:14:24 zigbee2mqtt/<valve> {"irrigation_timer":300,"state":"OFF"}   # +300.2 s
```

The valve is a sleepy battery end device: commands can take a few seconds to be delivered,
and the switch state may lag slightly. That is normal.

## How it works

The timer is controlled by a raw Tuya ZCL frame on cluster `0xE001`:

| Byte | Value | Meaning |
|---|---|---|
| 0 | `0x11` | Frame control: cluster-specific, client→server, disable default response, **no manufacturer code** |
| 1 | `0xNN` | Sequence number (arbitrary) |
| 2 | `0xFE` | Command ID (Tuya timer) |
| 3 | `0x0B` | Sub-command (set timer value) |
| 4-7 | `UInt32BE(seconds)` | Duration in seconds, big-endian |

Example for 3 hours (10800 s = `0x00002A30`): `11 01 FE 0B 00 00 2A 30`.

Zigbee2MQTT/zigbee-herdsman does not know this cluster/command, so the converter declares
them and passes the cluster object directly to `endpoint.command()` — the helper keeps the
definition identical to the built-in one except for this addition. Full details, including
how to adapt the code if a future zigbee-herdsman version changes its API, are in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Persistence and rollback

* The value is stored **in the valve firmware**, not in the converter: after setting it you
  can remove the converter and the new auto-off time stays.
* It survives Zigbee2MQTT restarts, updates, valve re-pairing and (community reports)
  factory resets.
* **Remove the converter**:
  * hot removal: `mosquitto_pub ... -t 'zigbee2mqtt/bridge/request/converter/remove' -m '{"name":"moes_water_valve_timer.js"}'`
  * or delete the file and restart Zigbee2MQTT.
* Once removed, the `number.*_irrigation_timer` entity disappears from Home Assistant
  (the value stays in the valve until changed again).
* To change the value again, re-install the converter (or use a Tuya gateway).

## Compatibility and test log

| Date | Zigbee2MQTT | Notes |
|---|---|---|
| 2026-09-27 | 2.14.1-1 (herdsman 10.9.2, zhc 26.105.0) | Installed on a live device (`_TZ3000_ogjpfoyn`). Timer set to 300 s → valve closed at **300.2 s**. On/off verified unchanged. Then set to 7200 s. |
| 2026-10-11 | 2.14.2-1 | After an automatic Zigbee2MQTT update: converter still loaded, definition still `external`, value still applied. |

## Troubleshooting

Quick checklist (full guide: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)):

* **No entity in Home Assistant** → is the converter listed in `bridge/converters`? Does
  `bridge/devices` show `"source":"external"` for the valve? If it shows `native`, your
  fingerprint is not matched — add your `manufacturerName` to the `fingerprint` array.
* **Converter not listed** → external JS may be disabled (check the
  `External JS (converters/extensions) is disabled` log line, or your
  `advanced.enable_external_js` setting). A converter with a syntax error is logged and
  **renamed** by Zigbee2MQTT so it cannot interfere — check the folder for a renamed file.
* **It “kind of” worked but on/off broke** → make sure the definition still uses
  `m.onOff(...)` (genOnOff). Do **not** move `state` to Tuya DP 101: on this hardware the DP
  path does not actuate the relay (this is what broke zigbee-herdsman-converters #12283 —
  reverted in #12396).
* **Setting seems ignored for the first seconds** → the valve is a sleepy battery device;
  commands are delivered on its next poll. Give it a few seconds.

## Safety notes

The 600 s auto-off is a **flood-protection feature**. Raising it to 2 hours means that if
Home Assistant, Zigbee2MQTT or your network fails while the valve is open, water can flow
for up to 2 hours. Choose the smallest cap that covers your longest real use case, and
consider independent protection (level/flow sensor, mechanical timer) for anything
sensitive such as filling a pool.

## Repository layout

```
.
├── external_converter/
│   └── moes_water_valve_timer.js    # the Zigbee2MQTT external converter
├── docs/
│   ├── PROTOCOL.md                  # the raw ZCL frame, examples, implementation notes
│   ├── TROUBLESHOOTING.md           # detailed debugging guide
│   └── INVESTIGATION.md             # how the problem was diagnosed (evidence, method)
├── examples/
│   └── home_assistant_examples.yaml # example automations / service calls
├── CHANGELOG.md
├── LICENSE
├── README.fr.md                     # French version of this README
└── README.md
```

## Credits and references

* [`fergus3000/tuya-ts0049-timer-fix`](https://github.com/fergus3000/tuya-ts0049-timer-fix) —
  the ConBee/deCONZ script that first documented the raw frame and proved the timer can be
  changed and persisted.
* Zigbee2MQTT issues/discussions:
  [#28589](https://github.com/Koenkk/zigbee2mqtt/issues/28589) (feature request, sniffed frame),
  [#24804](https://github.com/Koenkk/zigbee2mqtt/issues/24804),
  [#21788](https://github.com/Koenkk/zigbee2mqtt/issues/21788).
* zigbee-herdsman-converters
  [#12283](https://github.com/Koenkk/zigbee-herdsman-converters/issues/12283) /
  [#12396](https://github.com/Koenkk/zigbee-herdsman-converters/issues/12396) — why the
  Tuya DP path must not be used for `state` on this valve.
* Home Assistant community:
  [Zigbee2MQTT water valves — unwanted auto-off behaviour](https://community.home-assistant.io/t/zigbee2mqtt-controlling-water-valves-but-with-unwanted-auto-off-behavior/889517).

## License

[MIT](LICENSE)
