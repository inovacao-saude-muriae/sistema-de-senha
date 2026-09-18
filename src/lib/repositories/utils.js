import { CALL_TYPES, TYPE_PREFIXES, MAX_QUEUE_NUMBER, USERNAME_REGEX, EMAIL_DOMAIN, DEFAULT_GUICHE, NEWS_ALLOWED_TYPES, NEWS_MAX_FILE_SIZE } from "../constants.js";

export function normalizeCallType(type) {
  const isPriority = type === CALL_TYPES.PREFERENTIAL || type === CALL_TYPES.PREFERENCIAL;
  return {
    sequenceType: isPriority ? CALL_TYPES.PREFERENCIAL : CALL_TYPES.NORMAL,
    callType: isPriority ? CALL_TYPES.PREFERENTIAL : CALL_TYPES.NORMAL,
  };
}

export function formatNumberString(num, type) {
  const prefix =
    type === CALL_TYPES.PREFERENCIAL || type === CALL_TYPES.PREFERENTIAL
      ? TYPE_PREFIXES.preferencial
      : TYPE_PREFIXES.normal;
  if (Number(num) >= MAX_QUEUE_NUMBER + 1) return String(MAX_QUEUE_NUMBER + 1);
  return `${prefix}${String(Number(num) || 0).padStart(3, "0")}`;
}

export function isValidUsername(username) {
  return USERNAME_REGEX.test(username);
}

/**
 * Create typed error with status for the route to translate
 * @param {number} status
 * @param {string} message
 * @returns {{ status: number, message: string }}
 */
export function routeError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Generate initials from full name (max 2 chars)
 * @param {string} fullName
 * @returns {string}
 */
export function initials(fullName) {
  return fullName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Generate default email for a user
 * @param {string} username
 * @returns {string}
 */
export function generateEmail(username) {
  return `${username}${EMAIL_DOMAIN}`;
}

/**
 * Get default guiche value
 * @returns {string}
 */
export function getDefaultGuiche() {
  return DEFAULT_GUICHE;
}

export function isInvalidApiKeyError(error) {
  return /invalid api key/i.test(String(error?.message || error || ""));
}

/**
 * Validate allowed image types
 * @param {string} type
 * @returns {boolean}
 */
export function isAllowedImageType(type) {
  return NEWS_ALLOWED_TYPES.includes(type);
}

/**
 * Validate file size
 * @param {number} size
 * @returns {boolean}
 */
export function isValidFileSize(size) {
  return size <= NEWS_MAX_FILE_SIZE;
}