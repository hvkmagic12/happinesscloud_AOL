import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

// Supabase Realtime broadcast: the admin presses "Assemble" and every open
// cloud — projector, phones, laptops — receives the command and starts the
// same animation within a few tens of milliseconds of each other. Broadcast
// needs no table and no RLS policy of its own, unlike the postgres_changes
// subscription used for messages.
const COMMAND_CHANNEL = 'cloud-commands'
const ASSEMBLE_EVENT = 'assemble'

export function useCloudCommands() {
  const [assembled, setAssembled] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const channel = supabase.channel(COMMAND_CHANNEL)
    channel
      .on('broadcast', { event: ASSEMBLE_EVENT }, ({ payload }) => {
        setAssembled(Boolean((payload as { assembled?: boolean } | null)?.assembled))
      })
      .subscribe()
    channelRef.current = channel

    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [])

  // Broadcast does not echo back to the sender, so the sender's own view is
  // updated directly here.
  const broadcastAssembled = useCallback(async (next: boolean) => {
    setAssembled(next)
    await channelRef.current?.send({
      type: 'broadcast',
      event: ASSEMBLE_EVENT,
      payload: { assembled: next },
    })
  }, [])

  return { assembled, broadcastAssembled }
}
