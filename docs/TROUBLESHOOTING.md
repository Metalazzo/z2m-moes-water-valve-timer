# Troubleshooting

Work through the checks in order — each one tells you which layer is failing.

## 1. Is the converter loaded by Zigbee2MQTT?

```bash
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/converters' -C 1 -W 10 | jq -r '[.[].name] | @csv'
```

Expected: `"moes_water_valve_timer.js",...`

### Converter not listed

* **External JavaScript is disabled.** Since Zigbee2MQTT 2.11, external converters are
  disabled by default in new installations. When disabled, Zigbee2MQTT logs at startup:
  `External JS (converters/extensions) is disabled`.
  Fix: set `advanced.enable_external_js: true` in `configuration.yaml` and restart
  Zigbee2MQTT (the setting requires a restart).

* **The file has a syntax error.** Zigbee2MQTT catches the error, logs
  `Invalid external converter '<name>' was ignored and renamed to prevent interference`
  and **renames the file** (so it will not be tried again). Look in your
  `external_converters` folder for a renamed file and check the Zigbee2MQTT log.

* **Wrong location.** The file must be in the `external_converters` folder *next to the
  `configuration.yaml` Zigbee2MQTT is using* (for the Home Assistant add-on:
  `/config/zigbee2mqtt/external_converters/`).

* **Home Assistant add-on log level.** With `advanced.log_level: warning` (common), the
  informational `Loaded external converter '...'` message is not shown, and neither is
  `External JS ... is disabled`. Use the `bridge/converters` topic above instead, or
  temporarily set `advanced.log_level: info`.

## 2. Is the external definition actually applied to the valve?

```bash
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/bridge/devices' -C 1 -W 10 \
| jq -c '.[] | select(.friendly_name=="<your valve>") | {source:.definition.source, exposes:[.definition.exposes[].name]}'
```

Expected:

```json
{"source":"external","exposes":["irrigation_timer","battery",null,"linkquality"]}
```

If it shows `"source":"native"` (or the exposes do not contain `irrigation_timer`), the
external definition loaded but **did not match the device**.

### Why: fingerprint priority

In zigbee-herdsman-converters v26, `findDefinition()` builds the candidate list as
`[external definitions..., built-in definitions...]`, **but then decides in two passes**:

1. First pass: definitions that declare a `fingerprint` matching the device. If any match,
   the winner is the one with the highest `priority` (default `0`, first one wins on ties —
   and external definitions are first in the list).
2. Second pass (only if no fingerprint matched): fall back to `zigbeeModel` matching.

The built-in ZWV-YC definition has a fingerprint (`TS0049` + manufacturer names). A
converter that only declares `zigbeeModel: ['TS0049']` does **not** participate in the
first pass, so the built-in definition wins and your `irrigation_timer` expose never appears.

Fix: declare a matching fingerprint with a priority above the built-in one:

```js
fingerprint: [{modelID: 'TS0049', manufacturerName: '_TZ3000_ogjpfoyn', priority: 1}],
```

Find your `manufacturerName` in the Zigbee2MQTT frontend: device → **About**.

Also note: after a **hot-load** (`bridge/request/converter/save`), the retained
`bridge/devices` topic may still show the previous definition until it is republished.
Restart Zigbee2MQTT to get a clean picture — that is also how it was confirmed in practice.

## 3. Is the entity in Home Assistant?

Expected entity: `number.<your_valve>_irrigation_timer`.

* Home Assistant needs MQTT discovery. Check the retained discovery topic:

  ```bash
  mosquitto_sub -h <broker> -u <user> -P <password> \
    -t 'homeassistant/+/<device_ieee>/irrigation_timer/config' -C 1 -W 10
  # e.g. homeassistant/number/0xa4c138xxxxxxxx/irrigation_timer/config
  ```

* You can also use the feature without Home Assistant: Zigbee2MQTT frontend → device →
  **Exposes** tab, or publish
  `{"irrigation_timer": 7200}` to `zigbee2mqtt/<your valve>/set`.

## 4. The setting seems to have no effect

* The valve is a **sleepy battery end device**. Commands are queued until its next poll;
  a few seconds of delay is normal.
* Check for Zigbee2MQTT errors mentioning the property:

  ```bash
  # look for lines like:
  # Publish 'set' 'irrigation_timer' to '<valve>' failed: 'Error: ZCL command ... failed'
  ```

  If the frame is rejected, open an issue with the exact error and your
  `manufacturerName` — the frame may differ on your hardware variant.
* Prove the result by measuring the auto-off (next section).

## 5. Measure that the timer really changed

```bash
mosquitto_sub -h <broker> -u <user> -P <password> \
  -t 'zigbee2mqtt/<your valve>' -F '%I %t %p'
# then set 300 s and open the valve
```

Expected:

```
15:09:21 {"irrigation_timer":300,"state":"OFF"}
15:09:23 {"irrigation_timer":300,"state":"ON"}
15:14:24 {"irrigation_timer":300,"state":"OFF"}    <- +300 s, firmware auto-close
```

If it still closes at ~600 s, the frame was not accepted (see above). If it closes earlier
than expected, note that the firmware timer counts from the moment the valve was opened, not
from the moment the setting was written.

## 6. On/off broke after installing the converter

Make sure the definition keeps the built-in switching path:

```js
extend: [m.battery(), m.onOff({powerOnBehavior: false, configureReporting: true})],
```

Do **not** move `state` to the Tuya datapoint path (DP 101). On several
`_TZ3000_*` firmware variants of this hardware the Tuya DP layer is decoupled from the
relay: the command is acknowledged (the frontend even shows the new state optimistically)
but the relay never actuates. This is exactly what broke zigbee-herdsman-converters
[#12283](https://github.com/Koenkk/zigbee-herdsman-converters/issues/12283), which was
reverted in
[#12396](https://github.com/Koenkk/zigbee-herdsman-converters/issues/12396).

## 7. Removing the converter

* Hot removal:

  ```bash
  mosquitto_pub -h <broker> -u <user> -P <password> \
    -t 'zigbee2mqtt/bridge/request/converter/remove' \
    -m '{"name":"moes_water_valve_timer.js"}'
  ```

* Or delete the file and restart Zigbee2MQTT.

The timer value already written stays in the valve firmware — removing the converter does
not reset it.

## Collecting diagnostics for an issue

Please include:

```bash
# Zigbee2MQTT version, device fingerprint
mosquitto_sub ... -t 'zigbee2mqtt/bridge/info' -C 1 -W 10 | jq '{version, coordinator}'
mosquitto_sub ... -t 'zigbee2mqtt/bridge/devices' -C 1 -W 10 \
| jq -c '.[] | select(.friendly_name=="<your valve>") | {manuf: .definition.vendor, model: .definition.model, model_id: .model_id, source: .definition.source}'

# converter listing
mosquitto_sub ... -t 'zigbee2mqtt/bridge/converters' -C 1 -W 10 | jq -r '[.[].name] | @csv'

# the error lines from the Zigbee2MQTT log mentioning irrigation_timer
```

See [INVESTIGATION.md](INVESTIGATION.md) for how the original problem was diagnosed.
