export {};

declare global {
    interface Window {
        __planningPokerE2E?: Record<string, unknown>;
        __PP_TEST_MQTT_INBOUND_STALE_MS?: number;
        __PP_TEST_MQTT_CONNECT_TIMEOUT_MS?: number;
        __PP_TEST_MQTT_HEALTH_CHECK_MS?: number;
        __PP_TEST_PRESENCE_PING_INTERVAL_MS?: number;
        __PP_TEST_GUEST_DISCONNECTED_RECOVERY_MS?: number;
        __PP_TEST_REJOIN_MAX_RETRIES?: number;
        __PP_TEST_QUICK_JOIN_RETRY_MAX?: number;
        __PP_TEST_HOST_RECOVERY_RETRY_MS?: number;
        __PP_MQTT_CONNECT_COUNT?: number;
        planningPokerLog?: {
            getEntries: () => unknown[];
            dump: () => void;
            clear: () => void;
        };
    }
}
