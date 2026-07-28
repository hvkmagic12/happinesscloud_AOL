/**
 * Sorts incoming messages into event themes so the cloud can colour-code them
 * and the legend can group them.
 *
 * The classifier is a deliberately simple keyword scorer running in the
 * browser, not a model call. That buys three things this event needs: it
 * classifies the entire backlog the instant the page loads (no migration, no
 * `category` column, no re-processing of old rows), every screen in the room
 * derives the identical colours with nothing sent over the wire, and it keeps
 * working if the venue's network doesn't.
 */

export type CategoryId =
  | 'meditation'
  | 'wisdom'
  | 'seva'
  | 'peace'
  | 'nature'
  | 'joy'
  | 'community'
  | 'gratitude'
  | 'other'

export interface CategoryDef {
  id: CategoryId
  label: string
  /** One-line explanation, shown in the legend on hover. */
  blurb: string
  /** HSL, shared by the puff tint and the legend swatch. */
  hue: number
  saturation: number
  lightness: number
  /**
   * Topic words. A trailing `*` is a prefix match (at least four characters
   * before it); a keyword containing a space is matched as a whole phrase.
   */
  keywords: string[]
  /**
   * Words that describe how someone feels *about* their topic rather than
   * what the topic is. Scored far lower — see SOFT_WEIGHT.
   */
  softKeywords?: string[]
}

// A topic word is worth this much; a framing word only SOFT_WEIGHT.
//
// The split matters more here than it looks. At a gratitude event nearly
// every message opens with "grateful for…" or "so happy about…", so scoring
// those level with topic words would collapse the whole cloud into one or two
// categories. "Grateful for the morning meditation" is a message about
// meditation; the gratitude is the frame around it.
const TOPIC_WEIGHT = 3
const SOFT_WEIGHT = 1

// Order is the tie-break: when two categories score the same, the earlier
// (more specific) one wins. Hence gratitude sits second-to-last — it only
// takes a message no clearer theme claimed.
export const CATEGORIES: CategoryDef[] = [
  {
    id: 'meditation',
    label: 'Meditation & Breath',
    blurb: 'Kriya, pranayama, yoga, silence, practice',
    hue: 268,
    saturation: 0.62,
    lightness: 0.74,
    keywords: [
      'meditat*',
      'breath*',
      'pranayam*',
      'mindful*',
      'chant*',
      'sudarshan',
      'kriya',
      'yoga',
      'asana',
      'mantra',
      'sadhana',
      'silence',
      'silent',
      // "stillness" only — bare "still" is far more often the adverb
      // ("still smiling about…") and swallowed unrelated messages.
      'stillness',
      'practice',
      'practise',
    ],
  },
  {
    id: 'wisdom',
    label: 'Wisdom & Knowledge',
    blurb: "Gurudev's talks, insights, something learned",
    hue: 40,
    saturation: 0.8,
    lightness: 0.7,
    keywords: [
      'teach*',
      'insight*',
      'learn*',
      'lesson*',
      'realiz*',
      'realis*',
      'understand*',
      'gurudev',
      'guru',
      'knowledge',
      'wisdom',
      'wise',
      'understood',
      'taught',
      'talk',
      'talks',
      'sutra',
      'discourse',
      'question',
    ],
  },
  {
    id: 'seva',
    label: 'Seva & Service',
    blurb: 'Volunteering, helping, giving back',
    hue: 168,
    saturation: 0.55,
    lightness: 0.68,
    keywords: [
      'volunteer*',
      'contribut*',
      'organiz*',
      'organis*',
      'help*',
      'seva',
      'service',
      'serving',
      'served',
      'give back',
      'giving back',
      'gave back',
      'setting up',
    ],
  },
  {
    id: 'peace',
    label: 'Peace & Healing',
    blurb: 'Calm, rest, letting go, feeling lighter',
    hue: 202,
    saturation: 0.7,
    lightness: 0.74,
    keywords: [
      'peace*',
      'calm*',
      'relax*',
      'heal*',
      'releas*',
      'transform*',
      'refresh*',
      'renew*',
      'recharg*',
      'quiet',
      'stress',
      'anxiety',
      'anxious',
      'lighter',
      'clarity',
      'serene',
      'serenity',
      'ease',
      'sleep',
      'rest',
      'rested',
      'restful',
      'grounded',
      'centered',
      'centred',
      'let go',
      'letting go',
    ],
  },
  {
    id: 'nature',
    label: 'Nature & Boone',
    blurb: 'Mountains, air, sunrises, being outside',
    hue: 138,
    saturation: 0.52,
    lightness: 0.66,
    keywords: [
      'mountain*',
      'forest*',
      'tree*',
      'river*',
      'garden*',
      'flower*',
      'bird*',
      'trail*',
      'walk*',
      'nature',
      'boone',
      'appalachian',
      'blue ridge',
      'creek',
      'lake',
      'outdoors',
      'outside',
      'sky',
      'stars',
      'starry',
      'moon',
      'sunrise',
      'sunrises',
      'sunset',
      'sunsets',
      'sunshine',
      'hike',
      'hikes',
      'hiking',
      'hiked',
      'rain',
      'leaves',
      'fresh air',
    ],
  },
  {
    id: 'joy',
    label: 'Joy & Celebration',
    blurb: 'Music, dancing, laughter, satsang',
    hue: 18,
    saturation: 0.85,
    lightness: 0.72,
    keywords: [
      'celebrat*',
      'danc*',
      'laugh*',
      'excit*',
      'music',
      'bhajan',
      'bhajans',
      'kirtan',
      'sing',
      'sang',
      'singing',
      'song',
      'songs',
      'fun',
      'party',
      'festival',
      'joyful',
      'joyous',
    ],
    softKeywords: ['joy', 'happy', 'happiness', 'smil*', 'delight*', 'wonderful'],
  },
  {
    id: 'community',
    label: 'Community & Connection',
    blurb: 'Friends, family, sangha, meeting people',
    hue: 305,
    saturation: 0.55,
    lightness: 0.74,
    keywords: [
      'friend*',
      'connect*',
      'reconnect*',
      'belong*',
      'welcom*',
      'neighbor*',
      'neighbour*',
      'stranger*',
      'famil*',
      'community',
      'sangha',
      'satsang',
      'together',
      'everyone',
      'people',
      'group',
      'potluck',
      'kids',
      'children',
      'kindness',
      'kindly',
      'loved ones',
      'met someone',
    ],
  },
  {
    id: 'gratitude',
    label: 'Gratitude',
    blurb: 'Thanks and blessings, with no other theme named',
    hue: 340,
    saturation: 0.78,
    lightness: 0.74,
    keywords: [],
    softKeywords: [
      'appreciat*',
      'blessing*',
      'grateful',
      'gratitude',
      'thankful',
      'thanks',
      'thank',
      'blessed',
      'gift',
      'lucky',
    ],
  },
  {
    id: 'other',
    label: 'Reflections',
    blurb: "Everything that doesn't fit a theme above",
    hue: 228,
    saturation: 0.28,
    lightness: 0.78,
    keywords: [],
  },
]

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDef>

export const FALLBACK_CATEGORY: CategoryId = 'other'

// Shortest allowed prefix. Token lookup walks prefixes from this length up,
// which is a handful of map probes per word instead of comparing every word
// against every prefix in the table.
const MIN_PREFIX_LENGTH = 4

interface Entry {
  category: CategoryId
  weight: number
  /** Distinct-match key, so repeating one word doesn't score twice. */
  key: string
}

const exactIndex = new Map<string, Entry[]>()
const prefixIndex = new Map<string, Entry[]>()
const phraseEntries: Array<Entry & { phrase: string }> = []

function addEntry(index: Map<string, Entry[]>, key: string, entry: Entry) {
  const existing = index.get(key)
  if (existing) existing.push(entry)
  else index.set(key, [entry])
}

function register(category: CategoryId, keyword: string, weight: number) {
  const key = `${category}:${keyword}`
  const entry: Entry = { category, weight, key }

  if (keyword.includes(' ')) {
    phraseEntries.push({ ...entry, phrase: ` ${keyword} ` })
    return
  }

  if (keyword.endsWith('*')) {
    const prefix = keyword.slice(0, -1)
    if (prefix.length < MIN_PREFIX_LENGTH) {
      throw new Error(
        `[categories] prefix "${keyword}" is shorter than ${MIN_PREFIX_LENGTH} characters — too loose, it will match unrelated words`,
      )
    }
    addEntry(prefixIndex, prefix, entry)
    return
  }

  addEntry(exactIndex, keyword, entry)
}

for (const category of CATEGORIES) {
  for (const keyword of category.keywords) {
    register(category.id, keyword, TOPIC_WEIGHT)
  }
  for (const keyword of category.softKeywords ?? []) {
    register(category.id, keyword, SOFT_WEIGHT)
  }
}

const WORD_PATTERN = /[a-z0-9']+/g

/**
 * Picks the best-fitting theme for a message. Pure and deterministic: the
 * same text always lands in the same category on every device.
 */
export function categorize(text: string): CategoryId {
  const tokens = text.toLowerCase().match(WORD_PATTERN)
  if (!tokens || tokens.length === 0) return FALLBACK_CATEGORY

  const scores = new Map<CategoryId, number>()
  const counted = new Set<string>()

  function score(entries: Entry[] | undefined) {
    if (!entries) return
    for (const entry of entries) {
      if (counted.has(entry.key)) continue
      counted.add(entry.key)
      scores.set(entry.category, (scores.get(entry.category) ?? 0) + entry.weight)
    }
  }

  for (const token of tokens) {
    score(exactIndex.get(token))
    for (let len = MIN_PREFIX_LENGTH; len <= token.length; len++) {
      score(prefixIndex.get(token.slice(0, len)))
    }
  }

  if (phraseEntries.length > 0) {
    const joined = ` ${tokens.join(' ')} `
    for (const entry of phraseEntries) {
      if (joined.includes(entry.phrase)) score([entry])
    }
  }

  let best: CategoryId = FALLBACK_CATEGORY
  let bestScore = 0
  // CATEGORIES order decides ties, so a strict `>` keeps the more specific
  // category rather than whichever happened to be scored last.
  for (const category of CATEGORIES) {
    const value = scores.get(category.id) ?? 0
    if (value > bestScore) {
      bestScore = value
      best = category.id
    }
  }

  return best
}

/** CSS colour for a category, for legend swatches and bars. */
export function categoryCssColor(id: CategoryId, alpha = 1): string {
  const def = CATEGORY_BY_ID[id]
  const hsl = `${def.hue} ${Math.round(def.saturation * 100)}% ${Math.round(def.lightness * 100)}%`
  return alpha === 1 ? `hsl(${hsl})` : `hsl(${hsl} / ${alpha})`
}
