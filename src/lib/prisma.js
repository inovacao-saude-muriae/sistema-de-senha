import { MAX_QUEUE_NUMBER } from "./constants.js";

export function formatQueueNumber(num) {
  if (!num || num <= 0) return '---';
  if (num >= MAX_QUEUE_NUMBER + 1) return String(MAX_QUEUE_NUMBER);
  return String(num).padStart(3, '0');
}