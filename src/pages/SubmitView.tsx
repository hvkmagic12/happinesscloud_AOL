import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { GURUDEV_QUOTE, GURUDEV_QUOTE_SOURCE } from '../lib/quote'
import './SubmitView.css'

const MAX_LENGTH = 200
const NAME_MAX_LENGTH = 80
const STATE_MAX_LENGTH = 80

// On a touch device, focusing a field on mount throws the keyboard up over
// the form before the visitor has read what it's asking for. On a desktop,
// where focus costs nothing, going straight to the field is a kindness.
const PREFERS_TOUCH =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export default function SubmitView() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [stateInput, setStateInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = text.trim()
  const overLimit = text.length > MAX_LENGTH
  const canSubmit = trimmed.length > 0 && !overLimit && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)

    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({
        text: trimmed,
        name: name.trim() || null,
        state: stateInput.trim() || null,
      })
      .select('id')
      .single()

    if (insertError || !data) {
      console.error('Failed to insert message:', insertError)
      setError("Couldn't send your message. Please try again.")
      setSubmitting(false)
      return
    }

    navigate('/cloud', { state: { justSubmittedId: data.id } })
  }

  return (
    <div className="submit-view">
      <div className="submit-card">
        <blockquote className="submit-quote">
          <p className="submit-quote-text">{GURUDEV_QUOTE}</p>
          <footer className="submit-quote-source">{GURUDEV_QUOTE_SOURCE}</footer>
        </blockquote>
        <form onSubmit={handleSubmit}>
          <div className="submit-name-row">
            <input
              type="text"
              className="submit-input"
              placeholder="Name (optional)"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="next"
            />
            <input
              type="text"
              className="submit-input"
              placeholder="State (optional)"
              value={stateInput}
              maxLength={STATE_MAX_LENGTH}
              onChange={(e) => setStateInput(e.target.value)}
              autoComplete="address-level1"
              autoCapitalize="words"
              enterKeyHint="next"
            />
          </div>
          <textarea
            className="submit-textarea"
            placeholder="Share your thoughts 😉..."
            value={text}
            maxLength={MAX_LENGTH + 20}
            onChange={(e) => setText(e.target.value)}
            autoCapitalize="sentences"
            enterKeyHint="send"
            autoFocus={!PREFERS_TOUCH}
          />
          <div className="submit-footer">
            <span className={`char-counter ${overLimit ? 'over' : ''}`}>
              {text.length}/{MAX_LENGTH}
            </span>
          </div>
          <button type="submit" className="send-button" disabled={!canSubmit}>
            {submitting ? 'Sending…' : 'Send it up'}
          </button>
          {error && <p className="submit-error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
