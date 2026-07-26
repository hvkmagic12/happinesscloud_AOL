import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import './SubmitView.css'

const MAX_LENGTH = 200
const NAME_MAX_LENGTH = 80
const STATE_MAX_LENGTH = 80

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
        <h1>Share something positive from this week</h1>
        <p className="subtitle">
          Your words will float up and join everyone else's in the cloud.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="submit-name-row">
            <input
              type="text"
              className="submit-input"
              placeholder="Name (optional)"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="text"
              className="submit-input"
              placeholder="State (optional)"
              value={stateInput}
              maxLength={STATE_MAX_LENGTH}
              onChange={(e) => setStateInput(e.target.value)}
            />
          </div>
          <textarea
            className="submit-textarea"
            placeholder="Something you're grateful for..."
            value={text}
            maxLength={MAX_LENGTH + 20}
            onChange={(e) => setText(e.target.value)}
            autoFocus
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
