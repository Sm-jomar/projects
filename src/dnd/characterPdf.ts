// Reads the form fields of a filled-in character sheet PDF. Kept apart
// from characterImport so pdfjs only loads when someone opens a PDF.

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { characterFromPdfFields } from "./characterImport";
import type { DndCharacter } from "./dndTypes";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function characterFromPdf(data: ArrayBuffer): Promise<DndCharacter> {
  const task = pdfjsLib.getDocument({ data });
  const doc = await task.promise;
  try {
    const objs = (await doc.getFieldObjects()) ?? {};
    const fields: Record<string, string | boolean> = {};
    for (const [name, list] of Object.entries(objs)) {
      const v = (list as { value?: unknown }[]).map((o) => o.value).find((x) => x !== undefined && x !== "");
      if (typeof v === "string" || typeof v === "boolean") fields[name] = v;
      else if (typeof v === "number") fields[name] = String(v);
    }
    return characterFromPdfFields(fields);
  } finally {
    void task.destroy();
  }
}
