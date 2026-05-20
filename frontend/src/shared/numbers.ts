/**
 * Shared number parsing helpers.
 * - "Value" variants return null for empty/invalid input (used in preview)
 * - Throwing variants raise on invalid input (used in settings save)
 */

export const NUMERIC_POSITIVE_ERROR = "rollingpebble.settings.numeric_positive";
export const INTEGER_POSITIVE_ERROR = "rollingpebble.settings.integer_positive";

/** Return a positive finite number, or null if input is empty/invalid. */
export function optionalNumberValue(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Return a positive integer, or null if input is empty/invalid. */
export function optionalPositiveIntValue(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : null;
}

/** Throws on empty or invalid input. */
export function optionalNumber(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(NUMERIC_POSITIVE_ERROR);
    }
    return parsed;
}

/** Throws on empty or invalid input. Ensures value is a positive integer. */
export function optionalPositiveInt(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(INTEGER_POSITIVE_ERROR);
    }
    return Math.max(1, Math.round(parsed));
}

/** Convert an optional number to a string for form inputs. */
export function textFromOptionalNumber(value?: number | null): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
