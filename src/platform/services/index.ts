import type { ServiceContext } from './context'
import { createBibleService, type BibleService } from './bibleService'
import { createLexiconService, type LexiconService } from './lexiconService'
import { createCrossrefsService, type CrossrefsService } from './crossrefsService'
import { createHighlightsService, type HighlightsService } from './highlightsService'
import { createSettingsService, type SettingsService } from './settingsService'
import { createHistoryService, type HistoryService } from './historyService'
import { createWorkspacesService, type WorkspacesService } from './workspacesService'
import { createPlaylistsService, type PlaylistsService } from './playlistsService'
import { createVerseTagsService, type VerseTagsService } from './verseTagsService'
import { createTagGraphService, type TagGraphService } from './tagGraphService'
import { createNotesService, type NotesService } from './notesService'
import { createStudyTrailService, type StudyTrailService } from './studyTrailService'
import { createPdfService, type PdfService } from './pdfService'
import { createYoutubeService, type YoutubeService } from './youtubeService'
import { createAiChatsService, type AiChatsService } from './aiChatsService'
import { createSessionsService, type SessionsService } from './sessionsService'

/**
 * The shared-service registry. One instance per process (desktop main process, iOS WebView).
 * Services are created lazily so they can depend on each other through the registry without
 * import cycles (e.g. tagGraph → verseTags.listTags, studyTrail → lexicon.getEntry).
 *
 * The electron IPC handlers and the iOS bridge both consume exactly this object.
 */
export interface Services {
  readonly bible: BibleService
  readonly lexicon: LexiconService
  readonly crossrefs: CrossrefsService
  readonly highlights: HighlightsService
  readonly settings: SettingsService
  readonly history: HistoryService
  readonly workspaces: WorkspacesService
  readonly playlists: PlaylistsService
  readonly verseTags: VerseTagsService
  readonly tagGraph: TagGraphService
  readonly notes: NotesService
  readonly studyTrail: StudyTrailService
  readonly pdf: PdfService
  readonly youtube: YoutubeService
  readonly aiChats: AiChatsService
  readonly sessions: SessionsService
}

export function createServices(ctx: ServiceContext): Services {
  const cache = new Map<string, unknown>()
  function lazy<T>(key: string, make: () => T): T {
    let v = cache.get(key) as T | undefined
    if (v === undefined) { v = make(); cache.set(key, v) }
    return v
  }
  const registry: Services = {
    get bible() { return lazy('bible', () => createBibleService(ctx)) },
    get lexicon() { return lazy('lexicon', () => createLexiconService(ctx)) },
    get crossrefs() { return lazy('crossrefs', () => createCrossrefsService(ctx)) },
    get highlights() { return lazy('highlights', () => createHighlightsService(ctx)) },
    get settings() { return lazy('settings', () => createSettingsService(ctx)) },
    get history() { return lazy('history', () => createHistoryService(ctx)) },
    get workspaces() { return lazy('workspaces', () => createWorkspacesService(ctx)) },
    get playlists() { return lazy('playlists', () => createPlaylistsService(ctx)) },
    get verseTags() { return lazy('verseTags', () => createVerseTagsService(ctx)) },
    get tagGraph() { return lazy('tagGraph', () => createTagGraphService(ctx, () => registry)) },
    get notes() { return lazy('notes', () => createNotesService(ctx)) },
    get studyTrail() { return lazy('studyTrail', () => createStudyTrailService(ctx, () => registry)) },
    get pdf() { return lazy('pdf', () => createPdfService(ctx)) },
    get youtube() { return lazy('youtube', () => createYoutubeService(ctx)) },
    get aiChats() { return lazy('aiChats', () => createAiChatsService(ctx)) },
    get sessions() { return lazy('sessions', () => createSessionsService(ctx)) },
  }
  return registry
}

export type { ServiceContext } from './context'
