// Central pdf.js setup — configures the worker once and re-exports the API.
import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves this to a hashed URL string for the worker module.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjsLib }
export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy
export type PDFPageProxy = pdfjsLib.PDFPageProxy

/** Load a PDF document from raw bytes (fetched via IPC). */
export async function loadPdfFromBytes(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer; pass a copy so the original isn't detached if reused.
  const data = new Uint8Array(bytes.slice(0))
  const task = pdfjsLib.getDocument({ data })
  return task.promise
}
