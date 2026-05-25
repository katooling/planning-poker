/** @import { GameMessage } from "./message-types.js"; */
import { log } from "./log.js";

/**
 * @param {RTCDataChannel | { send: (value: string) => void }} channel
 * @param {GameMessage} message
 */
export function sendJson(channel, message) {
    try {
        channel.send(JSON.stringify(message));
        log.info("game", "Message sent", { type: message.t || "unknown" });
    } catch (_error) {
        // Ignore stale peer sends.
    }
}
