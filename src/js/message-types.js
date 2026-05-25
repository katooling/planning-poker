/**
 * @typedef {'name' | 'vote' | 'presence' | 'leave' | 'state' | 'reveal' | 'conceal' | 'reset' | 'kicked' | 'rejoin' | 'rejoinAck' | 'rejoinReject'} GameMessageType
 */

/**
 * @typedef {Object} GameMessageBase
 * @property {GameMessageType} t
 */

/**
 * @typedef {GameMessageBase & { t: 'name', n: string }} NameMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'vote', v: string | null }} VoteMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'presence', n?: string }} PresenceMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'leave' }} LeaveMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'state', round: number, roundTitle?: string, started: boolean, revealed: boolean, players: Array<Record<string, unknown>> }} StateMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'reveal' }} RevealMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'conceal' }} ConcealMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'reset', round: number }} ResetMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'kicked', to?: string, reason?: string }} KickedMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'rejoin', n?: string, pin?: string }} RejoinMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'rejoinAck', to?: string, room?: string }} RejoinAckMessage
 */

/**
 * @typedef {GameMessageBase & { t: 'rejoinReject', to?: string, reason?: string }} RejoinRejectMessage
 */

/**
 * @typedef {NameMessage | VoteMessage | PresenceMessage | LeaveMessage | StateMessage | RevealMessage | ConcealMessage | ResetMessage | KickedMessage | RejoinMessage | RejoinAckMessage | RejoinRejectMessage} GameMessage
 */

/**
 * @typedef {Object} SignalPayload
 * @property {1} v
 * @property {string} f
 * @property {string} [from]
 * @property {{ t: 'offer' | 'answer', s?: string }} d
 */

export {};
