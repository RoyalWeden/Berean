import { useAppStore } from '@/store'
import Switch from '@/components/shell/Switch'

// Experimental / opt-in features that aren't ready to be on by default — usually
// because of a known-but-unfixed cost (e.g. the PDF viewer's per-page canvas memory
// growth) rather than incompleteness.
export default function ExperimentalSection() {
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
  const setPdfFeatureEnabled = useAppStore((s) => s.setPdfFeatureEnabled)
  const chapterPullNavEnabled = useAppStore((s) => s.chapterPullNavEnabled)
  const setChapterPullNavEnabled = useAppStore((s) => s.setChapterPullNavEnabled)
  const continuousChapterScroll = useAppStore((s) => s.continuousChapterScroll)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">Pull to change chapter</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Pull past the top or bottom of a chapter to slide into the previous or next one, with a
            rubber-band stretch and a preview of what&apos;s coming. Off by default — on a trackpad a
            scroll and a pull are the same physical gesture, so this has to infer which one you meant
            and can get it wrong. Only a pull that <em>starts</em> at the end of a chapter counts.
            {continuousChapterScroll
              ? ' Currently inactive: Continuous chapter scroll already flows between chapters.'
              : ''}
          </p>
        </div>
        <Switch checked={chapterPullNavEnabled} onCheckedChange={() => setChapterPullNavEnabled(!chapterPullNavEnabled)} />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-primary))]">PDF library &amp; viewer</p>
          <p className="s-desc text-xs text-[rgb(var(--color-text-muted))] mt-0.5">
            Import and read PDF documents inside Berean. Off by default — long PDFs can build up
            significant memory over a session since viewed pages aren&apos;t released yet. Existing
            imported PDFs are kept; this just hides the library and viewer until you turn it back on.
          </p>
        </div>
        <Switch checked={pdfFeatureEnabled} onCheckedChange={() => setPdfFeatureEnabled(!pdfFeatureEnabled)} />
      </div>
    </div>
  )
}
