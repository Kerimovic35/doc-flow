import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  clearAttempts,
  recordFailedAttempt,
  resetRateLimitState,
} from './rate-limit';

describe('Begrenzung der Anmeldeversuche', () => {
  beforeEach(() => resetRateLimitState());

  it('laesst den ersten Versuch zu', () => {
    expect(checkRateLimit('a').allowed).toBe(true);
  });

  it('sperrt nach fuenf Fehlversuchen', () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt('a');
    expect(checkRateLimit('a').allowed).toBe(true);

    recordFailedAttempt('a');
    const result = checkRateLimit('a');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('sperrt nur den betroffenen Schluessel', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt('angreifer');
    expect(checkRateLimit('angreifer').allowed).toBe(false);
    // Ein zweiter Benutzer darf sich nicht aussperren lassen, nur weil
    // jemand anderes Passwoerter durchprobiert.
    expect(checkRateLimit('anderer-benutzer').allowed).toBe(true);
  });

  it('gibt nach erfolgreicher Anmeldung wieder frei', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt('a');
    expect(checkRateLimit('a').allowed).toBe(false);

    clearAttempts('a');
    expect(checkRateLimit('a').allowed).toBe(true);
  });
});
