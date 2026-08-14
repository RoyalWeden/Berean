// Curated emoji set for the note page-icon picker (NoteIconPicker.tsx). Deliberately not a
// full Unicode CLDR emoji dataset pulled from an npm package — that's several hundred KB of
// data for a decorative "pick one emoji" field, and this app is offline-first (no CDN fetch
// at runtime either). Coverage favors what a Bible-study/note-taking user would actually reach
// for: books/study, faith symbols, common objects/nature/people, not exhaustive completism.
//
// `keywords` drive the picker's search box — kept short and literal (no synonym expansion).

export interface EmojiEntry {
  char: string
  name: string
  keywords: string[]
}

export const EMOJI_CATEGORIES: { label: string; emoji: EmojiEntry[] }[] = [
  {
    label: 'Study & Faith',
    emoji: [
      { char: '📖', name: 'open book', keywords: ['book', 'bible', 'read', 'study'] },
      { char: '📚', name: 'books', keywords: ['book', 'library', 'study'] },
      { char: '📜', name: 'scroll', keywords: ['scroll', 'torah', 'ancient'] },
      { char: '🙏', name: 'folded hands', keywords: ['pray', 'prayer', 'thanks'] },
      { char: '👑', name: 'crown', keywords: ['crown', 'king', 'royal'] },
      { char: '🕊️', name: 'dove', keywords: ['dove', 'peace', 'spirit'] },
      { char: '🔥', name: 'fire', keywords: ['fire', 'flame', 'burn'] },
      { char: '💧', name: 'droplet', keywords: ['water', 'drop', 'baptism'] },
      { char: '🌿', name: 'herb', keywords: ['plant', 'herb', 'olive', 'leaf'] },
      { char: '🍇', name: 'grapes', keywords: ['grapes', 'wine', 'vine'] },
      { char: '🌾', name: 'sheaf of rice', keywords: ['wheat', 'grain', 'harvest'] },
      { char: '🐑', name: 'ewe', keywords: ['sheep', 'lamb', 'flock'] },
      { char: '🏛️', name: 'classical building', keywords: ['temple', 'building', 'pillar'] },
      { char: '⛰️', name: 'mountain', keywords: ['mountain', 'sinai', 'hill'] },
      { char: '✨', name: 'sparkles', keywords: ['sparkle', 'shine', 'glory'] },
      { char: '⭐', name: 'star', keywords: ['star', 'favorite'] },
    ],
  },
  {
    label: 'Objects',
    emoji: [
      { char: '📝', name: 'memo', keywords: ['note', 'write', 'memo'] },
      { char: '✏️', name: 'pencil', keywords: ['pencil', 'write', 'edit'] },
      { char: '🖊️', name: 'pen', keywords: ['pen', 'write'] },
      { char: '📌', name: 'pushpin', keywords: ['pin', 'important'] },
      { char: '📎', name: 'paperclip', keywords: ['clip', 'attach'] },
      { char: '🔖', name: 'bookmark', keywords: ['bookmark', 'save', 'tag'] },
      { char: '🗂️', name: 'card index dividers', keywords: ['folder', 'organize'] },
      { char: '📅', name: 'calendar', keywords: ['calendar', 'date', 'daily'] },
      { char: '🗓️', name: 'spiral calendar', keywords: ['calendar', 'schedule'] },
      { char: '⏰', name: 'alarm clock', keywords: ['clock', 'time', 'alarm'] },
      { char: '💡', name: 'light bulb', keywords: ['idea', 'light', 'bulb'] },
      { char: '🔑', name: 'key', keywords: ['key', 'unlock', 'important'] },
      { char: '🗝️', name: 'old key', keywords: ['key', 'old'] },
      { char: '🔍', name: 'magnifying glass', keywords: ['search', 'find', 'zoom'] },
      { char: '📷', name: 'camera', keywords: ['camera', 'photo'] },
      { char: '🎯', name: 'direct hit', keywords: ['target', 'goal', 'focus'] },
      { char: '🧭', name: 'compass', keywords: ['compass', 'direction', 'guide'] },
      { char: '⚖️', name: 'balance scale', keywords: ['scale', 'justice', 'balance'] },
      { char: '🎵', name: 'musical note', keywords: ['music', 'song', 'note'] },
      { char: '🎬', name: 'clapper board', keywords: ['video', 'movie', 'youtube'] },
    ],
  },
  {
    label: 'People & Nature',
    emoji: [
      { char: '😀', name: 'grinning face', keywords: ['smile', 'happy'] },
      { char: '🙂', name: 'slightly smiling face', keywords: ['smile', 'happy'] },
      { char: '😊', name: 'smiling face', keywords: ['smile', 'happy'] },
      { char: '🤔', name: 'thinking face', keywords: ['think', 'question'] },
      { char: '😢', name: 'crying face', keywords: ['sad', 'cry'] },
      { char: '❤️', name: 'red heart', keywords: ['heart', 'love'] },
      { char: '💙', name: 'blue heart', keywords: ['heart', 'love', 'blue'] },
      { char: '👤', name: 'bust in silhouette', keywords: ['person', 'user'] },
      { char: '👥', name: 'busts in silhouette', keywords: ['people', 'group'] },
      { char: '👨‍👩‍👧‍👦', name: 'family', keywords: ['family'] },
      { char: '🌍', name: 'globe showing europe-africa', keywords: ['world', 'earth', 'globe'] },
      { char: '☀️', name: 'sun', keywords: ['sun', 'day', 'light'] },
      { char: '🌙', name: 'crescent moon', keywords: ['moon', 'night'] },
      { char: '⭐', name: 'star2', keywords: ['star', 'night sky'] },
      { char: '🌊', name: 'water wave', keywords: ['wave', 'sea', 'water'] },
      { char: '🌳', name: 'deciduous tree', keywords: ['tree', 'nature'] },
      { char: '🕯️', name: 'candle', keywords: ['candle', 'light'] },
      { char: '⚡', name: 'high voltage', keywords: ['lightning', 'bolt', 'power'] },
      { char: '🌈', name: 'rainbow', keywords: ['rainbow', 'covenant', 'promise'] },
      { char: '🦁', name: 'lion', keywords: ['lion', 'judah'] },
    ],
  },
  {
    label: 'Symbols',
    emoji: [
      { char: '✅', name: 'check mark button', keywords: ['check', 'done', 'yes'] },
      { char: '❗', name: 'exclamation mark', keywords: ['important', 'warning'] },
      { char: '❓', name: 'question mark', keywords: ['question'] },
      { char: '⚠️', name: 'warning', keywords: ['warning', 'caution'] },
      { char: '🔴', name: 'red circle', keywords: ['red', 'circle'] },
      { char: '🟢', name: 'green circle', keywords: ['green', 'circle'] },
      { char: '🟡', name: 'yellow circle', keywords: ['yellow', 'circle'] },
      { char: '🔵', name: 'blue circle', keywords: ['blue', 'circle'] },
      { char: '🟣', name: 'purple circle', keywords: ['purple', 'circle'] },
      { char: '⬆️', name: 'up arrow', keywords: ['up', 'arrow'] },
      { char: '➡️', name: 'right arrow', keywords: ['right', 'arrow', 'next'] },
      { char: '🔄', name: 'counterclockwise arrows', keywords: ['refresh', 'repeat', 'cycle'] },
      { char: '🏆', name: 'trophy', keywords: ['trophy', 'win', 'goal'] },
      { char: '🎓', name: 'graduation cap', keywords: ['study', 'graduate', 'school'] },
      { char: '🧩', name: 'puzzle piece', keywords: ['puzzle', 'piece'] },
      { char: '🗣️', name: 'speaking head', keywords: ['speak', 'talk', 'audio'] },
      { char: '💬', name: 'speech balloon', keywords: ['chat', 'talk', 'comment'] },
      { char: '📣', name: 'megaphone', keywords: ['announce', 'loud'] },
      { char: '🧠', name: 'brain', keywords: ['brain', 'think', 'idea'] },
      { char: '❤️‍🔥', name: 'heart on fire', keywords: ['heart', 'fire', 'passion'] },
    ],
  },
]

export const ALL_EMOJI: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.emoji)
