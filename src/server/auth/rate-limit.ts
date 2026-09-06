/**
 * Begrenzung fehlgeschlagener Anmeldeversuche.
 *
 * Bewusst im Arbeitsspeicher des Prozesses gehalten: Die Anwendung laeuft auf
 * einem einzelnen VPS mit wenigen Benutzern. Ein zusaetzlicher Dienst wie
 * Redis waere fuer diesen Zweck unverhaeltnismaessig.
 *
 * Bekannte Grenze: Bei einem Neustart der Anwendung sind alle Zaehler
 * zurueckgesetzt. Fuer den Zweck - das Durchprobieren von Passwoertern
 * unwirtschaftlich machen - ist das hinnehmbar.
 */

interface Attempt {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempt>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

/** Entfernt abgelaufene Eintraege, damit die Map nicht unbegrenzt waechst. */
function prune(now: number): void {
  for (const [key, attempt] of attempts) {
    if (attempt.blockedUntil < now && now - attempt.firstAt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  prune(now);

  const attempt = attempts.get(key);
  if (!attempt) return { allowed: true, retryAfterSeconds: 0 };

  if (attempt.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((attempt.blockedUntil - now) / 1000),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const attempt = attempts.get(key);

  if (!attempt || now - attempt.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }

  attempt.count += 1;
  if (attempt.count >= MAX_ATTEMPTS) {
    attempt.blockedUntil = now + BLOCK_MS;
  }
}

/** Nach erfolgreicher Anmeldung den Zaehler leeren. */
export function clearAttempts(key: string): void {
  attempts.delete(key);
}

/** Nur fuer Tests: setzt den gesamten Zustand zurueck. */
export function resetRateLimitState(): void {
  attempts.clear();
}
