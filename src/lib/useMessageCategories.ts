import { useMemo, useRef } from 'react'
import { categorize, CATEGORIES, FALLBACK_CATEGORY } from './categories'
import type { CategoryDef, CategoryId } from './categories'
import type { Message } from '../types'

export interface CategoryBreakdown {
  /** Message id -> category. Stable for the life of the page. */
  categoryById: Map<string, CategoryId>
  counts: Map<CategoryId, number>
  /** Only the categories that actually have messages, largest group first. */
  present: CategoryDef[]
}

/**
 * Classifies every message once and keeps a running tally per category.
 *
 * `messages` is a fresh array on every realtime insert, so the classification
 * is cached by message id in a ref: an arriving message costs one classify
 * call, not one per message already in the cloud.
 */
export function useMessageCategories(messages: Message[]): CategoryBreakdown {
  const cacheRef = useRef<Map<string, CategoryId>>(new Map())

  return useMemo(() => {
    const categoryById = cacheRef.current
    const counts = new Map<CategoryId, number>()

    for (const message of messages) {
      let category = categoryById.get(message.id)
      if (!category) {
        category = categorize(message.text)
        categoryById.set(message.id, category)
      }
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }

    const present = CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).sort(
      (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
    )

    return { categoryById, counts, present }
  }, [messages])
}

export { FALLBACK_CATEGORY }
