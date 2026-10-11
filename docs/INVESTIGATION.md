# Investigation — how the problem was diagnosed

This page records the evidence and method used to find the root cause and validate the fix.
It is written so that anyone can reproduce (or extend) the investigation.

## Environment

* Home Assistant OS, Zigbee2MQTT add-on **2.14.1-1**
  (zigbee-herdsman `10.9.2`, zigbee-herdsman-converters `26.105.0`).
* Coordinator: Silicon Labs / EmberZNet dongle, Zigbee2MQTT `adapter: ezsp`.
* Valve: **Moes “Water valve”** (model `ZWV-YC`, Tuya `TS0049`,
  `manufacturerName: _TZ3000_ogjpfoyn`, battery powered).

## 1. Symptom and first measurement

The valve was always found closed after roughly ten minutes. To quantify it, the recorder
history of the valve switch entity was inspected. Over one morning, **seven consecutive
ON→OFF cycles** measured:

| ON | OFF | Duration |
|---|---|---|
| 10:54:41 | 11:04:41 | 10 min 00 s |
| 11:29:00 | 11:39:00 | 10 min 00 s |
| 11:43:01 | 11:53:01 | 10 min 00 s |
| 11:55:44 | 12:05:45 | 10 min 01 s |
| 12:09:31 | 12:19:31 | 10 min 00 s |
| 12:47:13 | 12:57:13 | 10 min 00 s |
| 13:01:55 | 13:11:55 | 10 min 00 s |

A fixed ~600.0 s duration is the signature of a **firmware timer**, not of an automation
(which would show variable durations and would be visible in the trace).

## 2. Ruling out Home Assistant

* **Scripts**: the instance had zero `script.*` entities.
* **Automations**: all **62** automations were exported and searched for references to the
  valve (entity id, device id and IEEE address). Result: **no reference at all**.
* **Triggers**: no automation had been triggered at any of the OFF times above.
* **Other controllers**: no Node-RED, AppDaemon or additional MQTT client in the
  installation (only Mosquitto + Zigbee2MQTT).
* **Zigbee2MQTT logs**: no errors or commands associated with the valve at the OFF times.

Conclusion: nothing in Home Assistant, Zigbee2MQTT or MQTT was closing the valve.

## 3. Identifying the device

The Zigbee2MQTT device registry showed:

* vendor **Moes**, description **“Water valve”**, battery powered,
  ZCL model ID `TS0049` — i.e. the built-in `ZWV-YC` definition
  (`extend: [battery(), onOff(...)]`).
* The device supports the Tuya proprietary cluster `0xE001` in its cluster list.

Existing community knowledge (see references in the main README) documents that this
hardware family has a **hardcoded 600 s auto-off** in firmware, that the `on_time` payload
of the On/Off cluster is ignored, and that the real timer can only be written with a raw
frame on cluster `0xE001`, command `0xFE`.

## 4. Choosing an approach

* A Tuya/Moes gateway can change the value, but it requires buying a hub.
* The `fergus3000/tuya-ts0049-timer-fix` script changes it from a ConBee II/III through
  deCONZ/zigpy — proven, but it requires a ConBee dongle (and the Zigbee2MQTT coordinator
  must be stopped while the script runs).
* This project took a third route: a **Zigbee2MQTT external converter** that sends the same
  raw frame through the existing coordinator. No extra hardware, no cloud, and the value
  stays in the valve firmware after the converter is removed.

## 5. First attempt failed — the fingerprint gotcha

The first version of the converter declared only `zigbeeModel: ['TS0049']`. It loaded fine
(`bridge/converters` listed the file) but the device kept using the built-in definition
(`bridge/devices` showed `"source":"native"` and no `irrigation_timer` expose).

Cause, found by reading zigbee-herdsman-converters v26 `findDefinition()`:
external definitions are placed first among the candidates, **but the match is decided in
two passes**: fingerprint matching first, `zigbeeModel` fallback second. The built-in
ZWV-YC definition has a fingerprint; a definition with only `zigbeeModel` never enters the
fingerprint pass, so the built-in one wins.

Fix: add a fingerprint with a higher priority:

```js
fingerprint: [{modelID: 'TS0049', manufacturerName: '_TZ3000_ogjpfoyn', priority: 1}],
```

After that, `bridge/devices` reported `"source":"external"` with the
`irrigation_timer` expose. (Details and the general rule: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).)

## 6. End-to-end validation

1. Hot-loaded the converter with the MQTT API
   (`zigbee2mqtt/bridge/request/converter/save`) → response `{"data":{},"status":"ok"}`.
2. Restarted Zigbee2MQTT to confirm it loads from disk →
   `bridge/converters` lists `moes_water_valve_timer.js` (then: `arrosage_timer.js`,
   the working name) and `bridge/devices` shows `"source":"external"`.
3. On/off regression check: two manual ON/OFF cycles worked exactly as before.
4. Set the timer to **300 s** and opened the valve. MQTT capture:

   ```
   15:09:21 {"irrigation_timer":300,"state":"OFF"}
   15:09:23 {"irrigation_timer":300,"state":"ON"}
   15:14:24 {"irrigation_timer":300,"state":"OFF"}   # +300.2 s
   ```

   → the firmware accepted and enforced the new value.
5. Set the final value to **7200 s (2 h)**; no errors in the Zigbee2MQTT logs.
6. Two weeks later (after an automatic Zigbee2MQTT update to **2.14.2-1**) the converter
   was still loaded, `source` still `external`, and the value still applied.

## 7. Reproducing the measurement on your side

* Set the timer to a short value (e.g. 300 s) and open the valve.
* Watch `zigbee2mqtt/<your valve>` with `mosquitto_sub -F '%I %t %p'` (see
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §5) or look at the entity history in Home
  Assistant.
* Compare the ON→OFF duration with the value you set.

## 8. What was not tested

* Other `manufacturerName` variants of `TS0049` (the converter lists the fingerprints known
  from the stock definition; reports are welcome).
* Zigbee2MQTT versions older than 2.11 (external JS always enabled there — the code should
  work, but it was not verified).
* Full power-loss persistence of the timer value (community reports say it persists; the
  value survived Zigbee2MQTT restarts and updates here).
