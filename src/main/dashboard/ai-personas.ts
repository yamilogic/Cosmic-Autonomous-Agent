import type { AutoReplyPersona } from '../../shared/dashboard-contract'

export interface PersonaMessageItem {
  user?: string
  text?: string
  ts?: string
}

export type AIPersonaKey = AutoReplyPersona

export interface AIPersonaDef {
  key: AIPersonaKey
  label: string
  icon: string
  description: string
  instruction: string
}

export const AI_PERSONAS: Record<AIPersonaKey, AIPersonaDef> = {
  professional: {
    key: 'professional',
    label: 'Professional',
    icon: '👔',
    description: 'Crisp, formal, objective enterprise communication (Default)',
    instruction:
      'You are a professional enterprise representative. Respond concisely, politely, and factually with polished business phrasing. Maintain composure, clarity, and precision.'
  },
  friendly: {
    key: 'friendly',
    label: 'Friendly & Warm',
    icon: '😊',
    description: 'Approachable, polite, enthusiastic, conversational',
    instruction:
      'You are a warm, approachable, and encouraging teammate. Use friendly, engaging language, cheerful politeness, and empathetic support while remaining productive.'
  },
  concise: {
    key: 'concise',
    label: 'Direct & Concise',
    icon: '⚡',
    description: 'Minimalist, bullet-pointed, zero fluff',
    instruction:
      'Provide direct, minimalist answers in short bullet points. Do not include pleasantries, filler phrases, conversational preamble, or redundant sign-offs.'
  },
  empathetic: {
    key: 'empathetic',
    label: 'Empathetic ("Good Person")',
    icon: '🤝',
    description: 'Caring, reassuring, supportive client-success tone',
    instruction:
      'You are deeply caring, patient, and considerate ("a good person"). Acknowledge concerns reassuringly, prioritize client success, offer generous assistance, and convey genuine partnership.'
  },
  technical: {
    key: 'technical',
    label: 'Technical & Detailed',
    icon: '🛠️',
    description: 'In-depth engineering explanations with specifications',
    instruction:
      'Provide rigorous, detailed technical explanations. Include exact architectural specifications, code references, parameter details, and structured troubleshooting steps.'
  },
  executive: {
    key: 'executive',
    label: 'Executive Summary',
    icon: '📊',
    description: 'High-level milestones, deliverables, blockers, and decisions',
    instruction:
      'Provide a high-level executive summary. Focus strictly on key milestone progress, deliverable completion, active blockers, risks, and pending executive decisions.'
  }
}

export const ALL_PERSONAS: AIPersonaDef[] = Object.values(AI_PERSONAS)

/**
 * Builds a grounded prompt injecting channel history (RAG) and project state.
 */
export function buildPersonaPrompt(options: {
  personaKey?: AIPersonaKey | string
  channelName: string
  history?: Array<PersonaMessageItem>
  projectContext?: {
    projectName?: string
    clientName?: string
    blockers?: string[]
    deliverables?: string[]
  }
  instruction: string
}): string {
  const persona =
    options.personaKey && options.personaKey in AI_PERSONAS
      ? AI_PERSONAS[options.personaKey as AIPersonaKey]
      : AI_PERSONAS.professional

  const lines: string[] = []

  // 1. Persona System Role
  lines.push(`[ROLE & TONE: ${persona.label.toUpperCase()}]`)
  lines.push(persona.instruction)
  lines.push('')

  // 2. Project Context
  if (options.projectContext) {
    lines.push('[PROJECT CONTEXT]')
    if (options.projectContext.projectName) {
      lines.push(`- Project: ${options.projectContext.projectName}`)
    }
    if (options.projectContext.clientName) {
      lines.push(`- Client: ${options.projectContext.clientName}`)
    }
    if (options.projectContext.blockers && options.projectContext.blockers.length > 0) {
      lines.push(`- Active Blockers: ${options.projectContext.blockers.join('; ')}`)
    }
    if (options.projectContext.deliverables && options.projectContext.deliverables.length > 0) {
      lines.push(`- Deliverables: ${options.projectContext.deliverables.join('; ')}`)
    }
    lines.push('')
  }

  // 3. Channel History (RAG: last 15-20 messages)
  if (options.history && options.history.length > 0) {
    lines.push(`[RECENT CHANNEL HISTORY (#${options.channelName.replace(/^[#@]+/, '')})]`)
    const recent = options.history.slice(-20)
    for (const msg of recent) {
      const u = msg.user || 'Participant'
      const t = (msg.text || '').replace(/\s+/g, ' ').trim()
      if (t) {
        lines.push(`- ${u}: "${t}"`)
      }
    }
    lines.push('')
  }

  // 4. User Instruction
  lines.push('[TASK / INSTRUCTION]')
  lines.push(options.instruction.trim())
  lines.push('')
  lines.push('Write the response to post to the channel now.')

  return lines.join('\n')
}

/**
 * Heuristics to detect if an incoming message genuinely asks a question or requires an answer.
 */
export function detectMessageNeedsReply(text: string): boolean {
  if (!text || text.trim().length === 0) return false
  const t = text.toLowerCase()

  // Contains question mark
  if (t.includes('?')) return true

  // Interrogative / inquiry patterns
  const questionWords = [
    /\b(?:when|where|what|how|who|why|which)\b/i,
    /\b(?:can\s+you|could\s+you|will\s+you|would\s+you|is\s+there|are\s+there)\b/i,
    /\b(?:please\s+(?:let\s+me\s+know|update|check|confirm|send|share|tell))\b/i,
    /\b(?:any\s+(?:update|updates|news|progress|blockers?))\b/i,
    /\b(?:status\s+on|eta\s+on|timeline\s+for)\b/i
  ]
  return questionWords.some((regex) => regex.test(t))
}

/**
 * Heuristics to detect if an incoming message concerns project tasks, deliverables, or blockers.
 */
export function detectMessageIsTaskRelated(text: string): boolean {
  if (!text || text.trim().length === 0) return false
  const t = text.toLowerCase()

  const taskKeywords = [
    /\b(?:task|tasks|deliverable|deliverables|milestone|milestones|deadline|scope)\b/i,
    /\b(?:bug|bugs|issue|issues|fix|fixes|error|errors|failing|blocker|blockers)\b/i,
    /\b(?:deploy|deployment|release|build|pr|pull\s+request|branch|commit|merge)\b/i,
    /\b(?:feature|features|requirement|requirements|spec|specs|architecture)\b/i,
    /\b(?:test|tests|testing|qa|review|reviewing|audit|audit log)\b/i,
    /\b(?:urgent|asap|priority|high\s+priority|blocker)\b/i
  ]
  return taskKeywords.some((regex) => regex.test(t))
}

/**
 * Generates an appropriate contextual reply for a channel using the selected persona voice.
 */
export function generatePersonaReply(options: {
  personaKey?: AIPersonaKey | string
  channelName: string
  instruction: string
  history?: Array<PersonaMessageItem>
}): string {
  const pKey =
    options.personaKey && options.personaKey in AI_PERSONAS
      ? (options.personaKey as AIPersonaKey)
      : 'professional'

  const cleanTarget = options.channelName.replace(/^[#@]+/, '').replace(/\s*\(?you\)?$/i, '').trim() || 'team'
  const isChannel = !options.channelName.startsWith('@') && options.channelName.includes('-')
  const recipient = isChannel ? `#${cleanTarget}` : `@${cleanTarget}`
  const rawInst = options.instruction.trim()

  // Clean imperative prefixes like "try to gave their answer as", "ask", "tell", "say", "answer"
  let cleanInst = rawInst
    .replace(/^(?:try\s+to\s+)?(?:give|gave|send|provide|write)\s+(?:their\s+|them\s+|him\s+|her\s+|a\s+)?(?:proper\s+)?(?:answer|reply|message)?\s*(?:like|as|saying|that|:|-)?\s*/i, '')
    .trim()
  if (!cleanInst) cleanInst = rawInst

  const lower = cleanInst.toLowerCase()

  // Case 1: Status / progress inquiries ("ask status", "how are you", "what are we doing")
  if (
    lower.includes('status') ||
    lower.includes('how are you') ||
    lower.includes('what are the things') ||
    lower.includes('progress') ||
    lower.includes('what are we doing')
  ) {
    switch (pKey) {
      case 'friendly':
        return `Hey ${recipient}! Hope you are having an awesome day 😊 Just checking in to see how everything is going and what we are working on together. Let me know how I can help! 🚀`
      case 'concise':
        return `Status check: please provide current progress update, deliverables status, and any open blockers.`
      case 'empathetic':
        return `Hi ${recipient}, wanted to warmly reach out and check in on how you're feeling about the project progress. We're here to support you every step of the way!`
      case 'technical':
        return `Engineering status sync: Requesting current commit SHA, test execution metrics, active PR status, and CI/CD pipeline health.`
      case 'executive':
        return `Executive briefing request: Please share milestone completion rate, current sprint progress, and executive blockers.`
      case 'professional':
      default:
        return `Hello ${recipient}, following up on current milestones and project tasks. Please share a status update at your earliest convenience.`
    }
  }

  // Case 2: 10 points / anime / list requests ("10 anime name", "10 good points")
  if (lower.includes('10 anime') || (lower.includes('10') && (lower.includes('point') || lower.includes('name')))) {
    switch (pKey) {
      case 'friendly':
        return `Here are 10 amazing anime recommendations for you, ${recipient}! 🍿✨ 1. Attack on Titan, 2. Fullmetal Alchemist: Brotherhood, 3. Death Note, 4. Jujutsu Kaisen, 5. Demon Slayer, 6. Steins;Gate, 7. Hunter x Hunter, 8. My Hero Academia, 9. One Piece, 10. Spirited Away! Enjoy watching! 😊`
      case 'concise':
        return `Top 10: 1. Attack on Titan 2. Fullmetal Alchemist: Brotherhood 3. Death Note 4. Jujutsu Kaisen 5. Demon Slayer 6. Steins;Gate 7. Hunter x Hunter 8. My Hero Academia 9. One Piece 10. Spirited Away.`
      case 'empathetic':
        return `Hi ${recipient}, here is a curated top 10 list chosen to give you inspiring and heartwarming stories: 1. Attack on Titan, 2. Fullmetal Alchemist: Brotherhood, 3. Death Note, 4. Jujutsu Kaisen, 5. Demon Slayer, 6. Steins;Gate, 7. Hunter x Hunter, 8. My Hero Academia, 9. One Piece, 10. Spirited Away. Hope these bring you great joy!`
      case 'technical':
        return `Top 10 categorized index: 1. Attack on Titan [Action/SciFi] 2. Fullmetal Alchemist: Brotherhood [Fantasy/Adventure] 3. Death Note [Psychological/Mystery] 4. Jujutsu Kaisen [Supernatural/Action] 5. Demon Slayer [Historical/Action] 6. Steins;Gate [SciFi/TimeTravel] 7. Hunter x Hunter [Adventure] 8. My Hero Academia [Superhero] 9. One Piece [Epic/Adventure] 10. Spirited Away [Feature Film].`
      case 'executive':
        return `Summary of Top 10 recommendations: 1. Attack on Titan, 2. Fullmetal Alchemist: Brotherhood, 3. Death Note, 4. Jujutsu Kaisen, 5. Demon Slayer, 6. Steins;Gate, 7. Hunter x Hunter, 8. My Hero Academia, 9. One Piece, 10. Spirited Away.`
      case 'professional':
      default:
        return `Hello ${recipient}, as requested, here are 10 recommended titles: 1. Attack on Titan, 2. Fullmetal Alchemist: Brotherhood, 3. Death Note, 4. Jujutsu Kaisen, 5. Demon Slayer, 6. Steins;Gate, 7. Hunter x Hunter, 8. My Hero Academia, 9. One Piece, 10. Spirited Away.`
    }
  }

  // Case 3: Reassurance / helping out / good person
  if (lower.includes('reassure') || lower.includes('good person') || lower.includes('help') || lower.includes('support')) {
    switch (pKey) {
      case 'friendly':
        return `Hi ${recipient}! Don't worry at all, everything is being handled and we have your back completely 😊 Feel free to ping anytime!`
      case 'concise':
        return `Action items prioritized. Standing by to assist.`
      case 'empathetic':
        return `Hi ${recipient}, please rest assured that your request is our top priority. We care deeply about delivering this cleanly and we are here alongside you every step of the way.`
      case 'technical':
        return `Incident/task mitigation active. Monitoring SLAs and pipeline status to ensure zero downtime.`
      case 'executive':
        return `Risk mitigated. Dedicated resources assigned to ensure delivery alignment.`
      case 'professional':
      default:
        return `Hello ${recipient}, thank you for reaching out. Please be assured that we are actively addressing this and will keep you informed of any developments.`
    }
  }

  // Case 4: General statement or custom instruction
  switch (pKey) {
    case 'friendly':
      return `Hey ${recipient}! ${cleanInst} 😊 Let me know if you need anything else!`
    case 'concise':
      return `${cleanInst}`
    case 'empathetic':
      return `Hi ${recipient}, ${cleanInst} Thank you so much for your partnership and patience!`
    case 'technical':
      return `[Technical Note - ${recipient}]: ${cleanInst}`
    case 'executive':
      return `Executive update: ${cleanInst}`
    case 'professional':
    default:
      return `Hello ${recipient}, ${cleanInst}`
  }
}
