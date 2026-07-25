export interface Message {
  id: string
  text: string
  created_at: string
  hue_offset: number
  approved: boolean
}

export interface PuffLayout {
  id: string
  x: number
  y: number
  radius: number
}
