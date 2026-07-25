// Bundled SF Symbol PNG assets for keyboard-shortcut glyphs only (⌘⇧⌥⌃↵ + arrows) —
// scoped to ShortcutKeys.tsx. Source: github.com/andrewtavis/sf-symbols-online.
// Each is a small black-on-transparent PNG rendered via SFIcon.tsx's CSS mask, so it
// inherits whatever text color the call site applies.
import ic_arrowDown from './arrow.down.png'
import ic_arrowLeft from './arrow.left.png'
import ic_arrowRight from './arrow.right.png'
import ic_arrowUp from './arrow.up.png'
import ic_command from './command.png'
import ic_control from './control.png'
import ic_deleteLeft from './delete.left.png'
import ic_escape from './escape.png'
import ic_option from './option.png'
import ic_return from './return.png'
import ic_shift from './shift.png'

export const SF_ICONS = {
  'arrow.down': ic_arrowDown,
  'arrow.left': ic_arrowLeft,
  'arrow.right': ic_arrowRight,
  'arrow.up': ic_arrowUp,
  'command': ic_command,
  'control': ic_control,
  'delete.left': ic_deleteLeft,
  'escape': ic_escape,
  'option': ic_option,
  'return': ic_return,
  'shift': ic_shift,
} as const
