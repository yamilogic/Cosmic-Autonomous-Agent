export type MessageIntent = 'question' | 'decision' | 'praise' | 'blocker' | 'general'

export interface MessageIntentMeta {
  intent: MessageIntent
  label: string
  tone: 'purple' | 'blue' | 'emerald' | 'red' | 'gray'
  icon?: string
}

const QUESTION_REGEX = /(\?|tell me|let me know|what|how|why|is that|can we|could you|please share|status)/i
const DECISION_REGEX = /(approved|confirmed|agreed|done|finished|we can start|now we work|completed|ready|sign off)/i
const PRAISE_REGEX = /(happy|amazing|good work|thank you|thanks|great job|hurry|dop much good|feel good|proud)/i
const BLOCKER_REGEX = /(blocked|missing|unclear|issue|problem|delay|stuck|broken|fail|error|barbad)/i

export function classifyMessageIntent(text: string): MessageIntentMeta {
  const clean = text.trim()
  if (!clean) {
    return { intent: 'general', label: 'Message', tone: 'gray' }
  }

  // Priority 1: Blocker / Alert
  if (BLOCKER_REGEX.test(clean)) {
    return { intent: 'blocker', label: 'Alert', tone: 'red', icon: '⚠️' }
  }

  // Priority 2: Praise / Celebration
  if (PRAISE_REGEX.test(clean)) {
    return { intent: 'praise', label: 'Praise', tone: 'emerald', icon: '✨' }
  }

  // Priority 3: Decision / Confirmation
  if (DECISION_REGEX.test(clean)) {
    return { intent: 'decision', label: 'Decision', tone: 'blue', icon: '✓' }
  }

  // Priority 4: Question / Inbound Ask
  if (clean.includes('?') || QUESTION_REGEX.test(clean)) {
    return { intent: 'question', label: 'Needs Reply', tone: 'purple', icon: '?' }
  }

  return { intent: 'general', label: 'Chat', tone: 'gray' }
}

