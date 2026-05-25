import { describe, expect, it } from "vitest";
import {
    buildPacket,
    decodeRemainingLength,
    encodeRemainingLength,
    encodeString,
    parsePublishPayload,
} from "../../src/js/mqtt-relay.js";

describe("mqtt packet helpers", () => {
    it("encodes and decodes remaining length", () => {
        const encoded = encodeRemainingLength(321);
        const decoded = decodeRemainingLength(encoded, 0);
        expect(decoded).toEqual({ value: 321, bytesUsed: encoded.length });
    });

    it("builds MQTT packets with header and body", () => {
        const body = new Uint8Array([1, 2, 3]);
        const packet = buildPacket(0x10, body);
        expect(packet[0]).toBe(0x10);
        expect(packet.at(-1)).toBe(3);
    });

    it("encodes utf8 strings with two-byte length prefix", () => {
        const encoded = encodeString("room/topic");
        expect(encoded[0]).toBe(0);
        expect(encoded[1]).toBe(10);
    });

    it("parses publish payload topic and body", () => {
        const topicBytes = encodeString("planning-poker/room/abc");
        const payloadBytes = new TextEncoder().encode('{"t":"ping"}');
        const body = new Uint8Array(topicBytes.length + payloadBytes.length);
        body.set(topicBytes, 0);
        body.set(payloadBytes, topicBytes.length);
        const parsed = parsePublishPayload(body);
        expect(parsed.topic).toBe("planning-poker/room/abc");
        expect(parsed.payload).toBe('{"t":"ping"}');
    });
});
