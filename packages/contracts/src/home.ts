export type HomeWidgetKind = 'stat' | 'list' | 'split'
export type HomeTone = 'default' | 'good' | 'warn' | 'bad'

export interface HomeStatDTO {
  label: string
  value: string
  tone?: HomeTone
  hint?: string
}

export interface HomeListItemDTO {
  primary: string
  secondary?: string
  meta?: string
  tone?: HomeTone
}

export interface HomeWidgetDTO {
  key: string
  title: string
  kind: HomeWidgetKind
  /** "view all" target */
  href?: string
  stats?: HomeStatDTO[]
  items?: HomeListItemDTO[]
  empty?: string
}

export interface HomeResponseDTO {
  hospitalName: string
  greetingName: string
  today: string
  role: string
  widgets: HomeWidgetDTO[]
}
