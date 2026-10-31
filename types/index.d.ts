/** idle: the button shows. asked: from the press until the checklist's turn ends. */
export type Phase = 'idle' | 'asked'

declare module 'claude-code' {
  interface EngineInterface {
    wrapUp: { start: (args: Record<string, never>) => Promise<void> }
  }

  interface PluginState {
    'wrap-up': { phase: Phase; isNoticeDue: boolean; turnsBeforeChecklist: number }
  }
}
