import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrientation, parseTsv } from './confidence';
import { OcrUnavailableError, type OcrPageResult, type OcrProvider } from './provider';

/**
 * Texterkennung mit Tesseract als Kindprozess.
 *
 * Kein WASM-Nachbau: Es ist derselbe Motor, nur langsamer, und waere ein
 * zweiter Weg, den niemand pflegt. Im Container liegt Tesseract samt
 * deutschem Sprachmodell bereits im Image; unter Windows zeigt
 * TESSERACT_PATH auf die installierte Datei.
 *
 * Der Aufruf laeuft ohne Shell und mit Argumenten statt einer Zeichenkette -
 * ein Dateiname kann damit nichts ausloesen.
 */

/** Nach dieser Zeit gilt eine Seite als hoffnungslos. */
const PAGE_TIMEOUT_MS = 120_000;

/** Deutsch zuerst, Englisch als Zweitsprache fuer Fachbegriffe. */
const DEFAULT_LANGUAGES = 'deu+eng';

function binary(): string {
  // Auf Wahrheitswert pruefen, nicht auf null: In einer .env steht ein nicht
  // gesetzter Wert als leere Zeichenkette.
  return process.env.TESSERACT_PATH || 'tesseract';
}

export class TesseractOcr implements OcrProvider {
  readonly name = 'tesseract';

  private cachedLanguages: string[] | null = null;

  async available(): Promise<boolean> {
    try {
      await this.languages();
      return true;
    } catch {
      return false;
    }
  }

  /** Die installierten Sprachmodelle. */
  async languages(): Promise<string[]> {
    if (this.cachedLanguages) return this.cachedLanguages;

    const result = await run(binary(), ['--list-langs'], 10_000);
    // Die erste Zeile ist eine Ueberschrift, danach je Zeile eine Sprache.
    const languages = result.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean);

    this.cachedLanguages = languages;
    return languages;
  }

  /**
   * Waehlt die Sprachen, die wirklich installiert sind.
   *
   * Ein Aufruf mit einem fehlenden Sprachmodell bricht mit einem Fehler ab.
   * Fehlt Deutsch, ist Englisch immer noch besser als gar keine Erkennung -
   * die Konfidenz faellt dann von selbst, und das Dokument landet in der
   * Prüfung.
   */
  private async resolveLanguages(requested: string): Promise<string> {
    const installed = new Set(await this.languages());
    const usable = requested.split('+').filter((language) => installed.has(language));

    if (usable.length > 0) return usable.join('+');
    if (installed.has('eng')) return 'eng';

    throw new OcrUnavailableError(
      'Für Tesseract ist kein brauchbares Sprachmodell installiert (erwartet: deu).',
    );
  }

  async recognize(
    image: Uint8Array,
    options: { languages?: string } = {},
  ): Promise<OcrPageResult> {
    const languages = await this.resolveLanguages(options.languages ?? DEFAULT_LANGUAGES);

    const directory = await mkdtemp(path.join(tmpdir(), 'docflow-ocr-'));
    const source = path.join(directory, 'seite.png');

    try {
      await writeFile(source, image);

      // Erst die Ausrichtung: Ein um 90 Grad gedrehtes Blatt liest Tesseract
      // sonst praktisch gar nicht. Schlaegt die Erkennung fehl, wird ohne
      // Drehung weitergemacht - sie ist eine Verbesserung, keine Bedingung.
      let rotation = 0;
      try {
        const osd = await run(binary(), [source, 'stdout', '--psm', '0'], 30_000);
        rotation = parseOrientation(osd.stdout);
      } catch {
        rotation = 0;
      }

      const input = rotation === 0 ? source : await rotateCopy(image, directory, rotation);

      // Die Wortkonfidenzen kommen ueber `-c tessedit_create_tsv=1` und
      // nicht ueber die Konfigurationsdatei `tsv`: Letztere liegt im
      // tessdata-Verzeichnis der Installation. Zeigt TESSDATA_PREFIX
      // woandershin - unter Windows der Normalfall, weil das deutsche Modell
      // nicht nach "Program Files" darf -, findet Tesseract sie nicht und
      // liefert stillschweigend reinen Text ohne Konfidenz.
      const result = await run(
        binary(),
        [input, 'stdout', '-l', languages, '--psm', '3', '-c', 'tessedit_create_tsv=1'],
        PAGE_TIMEOUT_MS,
      );

      const parsed = parseTsv(result.stdout);
      return { text: parsed.text, confidence: parsed.confidence, rotation };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function rotateCopy(
  image: Uint8Array,
  directory: string,
  degrees: number,
): Promise<string> {
  const sharp = (await import('sharp')).default;
  const target = path.join(directory, 'gedreht.png');
  await writeFile(target, await sharp(image).rotate(degrees).png().toBuffer());
  return target;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      env: {
        ...process.env,
        // Ohne diese Grenze belegt eine einzige Seite alle Kerne und bremst
        // den Webserver aus.
        OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT ?? '1',
      },
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} überschritt das Zeitlimit von ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8').slice(0, 2000);
    });

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      reject(
        error.message.includes('ENOENT')
          ? new OcrUnavailableError(
              `Tesseract wurde nicht gefunden (gesucht: ${command}). TESSERACT_PATH in der .env setzen.`,
            )
          : error,
      );
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`Tesseract endete mit Fehler ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

let cached: OcrProvider | null = null;

export function ocrProvider(): OcrProvider {
  cached ??= new TesseractOcr();
  return cached;
}

/** Nur fuer Tests. */
export function setOcrProvider(provider: OcrProvider | null): void {
  cached = provider;
}
