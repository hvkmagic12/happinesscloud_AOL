import { useState } from 'react'
import { categoryCssColor } from '../lib/categories'
import type { CategoryDef, CategoryId } from '../lib/categories'
import './CategoryLegend.css'

export interface CategoryLegendProps {
  /** Categories that have at least one message, largest group first. */
  present: CategoryDef[]
  counts: Map<CategoryId, number>
  total: number
  active: CategoryId | null
  onSelect: (id: CategoryId | null) => void
}

/**
 * Key to the cloud's colours, doubling as a filter: each row shows how many
 * messages landed in that theme and how big a share of the cloud it is, and
 * clicking one fades the rest of the cloud back so that theme stands alone.
 */
export default function CategoryLegend({
  present,
  counts,
  total,
  active,
  onSelect,
}: CategoryLegendProps) {
  // Starts open on desktop and closed on phones, where the panel would cover
  // a real share of the cloud. Matches the CSS breakpoint.
  const isNarrow = () => typeof window !== 'undefined' && window.innerWidth <= 640
  const [open, setOpen] = useState(() => !isNarrow())

  // On a phone the panel is a bottom sheet covering nearly half the screen,
  // so picking a theme folds it away — otherwise it hides the very cloud the
  // tap just gathered. On desktop it sits in the corner and can stay put.
  function select(next: CategoryId | null) {
    onSelect(next)
    if (next !== null && isNarrow()) setOpen(false)
  }

  const activeDef = present.find((c) => c.id === active)

  if (present.length === 0) return null

  return (
    <section className={`category-legend ${open ? 'is-open' : ''}`} aria-label="Message themes">
      <button
        type="button"
        className="category-legend-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* Collapsed, the header has to say which theme is showing — the
            panel is folded away and the cloud alone doesn't name it. */}
        <span className="category-legend-title">
          {!open && activeDef ? activeDef.label : 'Themes'}
        </span>
        <span className="category-legend-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <>
          <ul className="category-legend-list">
            {present.map((category) => {
              const count = counts.get(category.id) ?? 0
              const share = total > 0 ? (count / total) * 100 : 0
              const isActive = active === category.id
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    className={`category-legend-row ${isActive ? 'is-active' : ''}`}
                    onClick={() => select(isActive ? null : category.id)}
                    aria-pressed={isActive}
                    title={category.blurb}
                  >
                    <span
                      className="category-legend-swatch"
                      style={{ background: categoryCssColor(category.id) }}
                      aria-hidden="true"
                    />
                    <span className="category-legend-label">{category.label}</span>
                    <span className="category-legend-count">{count.toLocaleString()}</span>
                    <span className="category-legend-bar" aria-hidden="true">
                      <span
                        className="category-legend-bar-fill"
                        style={{
                          width: `${share}%`,
                          background: categoryCssColor(category.id),
                        }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <button
            type="button"
            className="category-legend-clear"
            onClick={() => onSelect(null)}
            disabled={active === null}
          >
            {active === null ? 'Showing every theme' : 'Show every theme'}
          </button>
        </>
      )}
    </section>
  )
}
