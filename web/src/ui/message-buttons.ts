type MessageButton = readonly [label: string, code: number]

const BUTTONS: Readonly<Record<string, readonly MessageButton[]>> = {
  'ok!': [['OK', 1]],
  'okcancel!': [['OK', 1], ['Cancel', 2]],
  'yesno!': [['Yes', 1], ['No', 2]],
  'yesnocancel!': [['Yes', 1], ['No', 2], ['Cancel', 3]],
  'retrycancel!': [['Retry', 1], ['Cancel', 2]],
  'abortretryignore!': [['Abort', 1], ['Retry', 2], ['Ignore', 3]],
}

export function messageButtons(kind: string): readonly MessageButton[] {
  if (Object.hasOwn(BUTTONS, kind)) return BUTTONS[kind]
  console.warn('Unsupported message-box buttons; retaining the Classic OK-button behavior.')
  return BUTTONS['ok!']
}
