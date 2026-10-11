/**
 * Zigbee2MQTT external converter — Moes ZWV-YC / Tuya TS0049 water valve
 *
 * Purpose: change the valve's HARDCODED auto-close timer (firmware flood protection,
 *          default 600 s / 10 minutes) using the Tuya proprietary command:
 *
 *              cluster 0xE001, command 0xFE, payload = 0x0B + UInt32BE(seconds)
 *
 * Safety:
 *   - the built-in "ZWV-YC" definition (battery + onOff) is reproduced EXACTLY, so the
 *     existing on/off behaviour is unchanged (same switch / battery / linkquality entities).
 *   - only ONE new entity is added: "irrigation_timer" (number, in seconds).
 *
 * Tested with Zigbee2MQTT 2.14.1 (zigbee-herdsman 10.9.2, zigbee-herdsman-converters 26.105.0);
 * verified still working after the update to Zigbee2MQTT 2.14.2.
 *
 * Removal: delete this file and restart Zigbee2MQTT, or send a message to
 *          zigbee2mqtt/bridge/request/converter/remove with payload {"name":"moes_water_valve_timer.js"}
 *
 * Full documentation: see README.md, docs/PROTOCOL.md and docs/TROUBLESHOOTING.md
 */
const m = require('zigbee-herdsman-converters/lib/modernExtend');
const zhm = require('zigbee-herdsman');
const Zcl = zhm.Zcl || {};
const UINT8 = (Zcl.DataType && Zcl.DataType.UINT8) || 32; // 0x20

const TIMER_CLUSTER = {
    name: 'arrosageTimer',
    ID: 0xE001,
    // No manufacturer code on the wire (frame control 0x11), exactly like the Tuya frame.
    manufacturerCode: undefined,
    attributes: {},
    commands: {
        timer: {
            name: 'timer',
            ID: 0xFE,
            parameters: [
                {name: 'dp', type: UINT8},
                {name: 'b0', type: UINT8},
                {name: 'b1', type: UINT8},
                {name: 'b2', type: UINT8},
                {name: 'b3', type: UINT8},
            ],
        },
    },
    commandsResponse: {},
};

module.exports = {
    zigbeeModel: ['TS0049'],
    // An external definition MUST provide a fingerprint that matches: in
    // zigbee-herdsman-converters v26 `findByDevice()` evaluates fingerprint matches
    // before the zigbeeModel fallback, and the built-in definition has a matching
    // fingerprint. `priority: 1` puts this definition ahead of the built-in one.
    // Add your own manufacturerName here if your valve is not listed.
    fingerprint: [
        {modelID: 'TS0049', manufacturerName: '_TZ3000_ogjpfoyn', priority: 1}, // tested
        {modelID: 'TS0049', manufacturerName: '_TZ3000_cjfmu5he', priority: 1}, // from the stock ZWV-YC definition
        {modelID: 'TS0049', manufacturerName: '_TZ3000_mq4wujmp', priority: 1}, // from the stock ZWV-YC definition
        {modelID: 'TS0049', manufacturerName: '_TZ3000_5af5r192', priority: 1}, // from the stock ZWV-YC definition
    ],
    model: 'ZWV-YC',
    vendor: 'Moes',
    description: 'Water valve',
    // Keep this identical to the built-in ZWV-YC definition: switching stays on the
    // standard genOnOff cluster (this is important, see docs/TROUBLESHOOTING.md).
    extend: [m.battery(), m.onOff({powerOnBehavior: false, configureReporting: true})],
    toZigbee: [
        {
            key: ['irrigation_timer'],
            convertSet: async (entity, key, value, meta) => {
                const seconds = Math.round(Number(value));
                if (!Number.isFinite(seconds) || seconds < 1 || seconds > 0xfffffffe) {
                    throw new Error(`irrigation_timer: invalid value '${value}' (expected seconds, 1..4294967294)`);
                }
                const endpoint = meta.device.getEndpoint(1);
                await endpoint.command(
                    TIMER_CLUSTER,
                    'timer',
                    {
                        dp: 0x0b,
                        b0: (seconds >>> 24) & 0xff,
                        b1: (seconds >>> 16) & 0xff,
                        b2: (seconds >>> 8) & 0xff,
                        b3: seconds & 0xff,
                    },
                    {disableDefaultResponse: true},
                );
                return {state: {irrigation_timer: seconds}};
            },
        },
    ],
    exposes: [
        {
            type: 'numeric',
            name: 'irrigation_timer',
            label: 'Auto-off timer',
            property: 'irrigation_timer',
            access: 3, // STATE | SET
            unit: 's',
            value_min: 1,
            value_max: 86400,
            value_step: 1,
            description: 'Maximum open time before the firmware closes the valve (seconds)',
        },
    ],
};
