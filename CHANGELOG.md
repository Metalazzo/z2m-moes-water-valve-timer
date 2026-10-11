# Changelog

## 1.0.0 — 2026-10-11

- Initial release.
- Zigbee2MQTT external converter for **Moes ZWV-YC / Tuya TS0049** water valves.
- Adds an `irrigation_timer` number entity to set the valve's firmware auto-off timer
  (hardcoded 600 s by default) via the Tuya proprietary command
  `cluster 0xE001 / command 0xFE / payload 0x0B + UInt32BE(seconds)`.
- The built-in definition (`battery` + `onOff`) is reproduced exactly; on/off behaviour
  is unchanged.
- Verified on Zigbee2MQTT 2.14.1 (measured auto-off at 300.2 s when set to 300 s, on a
  real device with fingerprint `_TZ3000_ogjpfoyn`) and still working after the
  Zigbee2MQTT 2.14.2 update.
