export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface QuestionOption {
  id: string
  label: string
}

export interface Question {
  id: string
  index: number
  dimension: 'EI' | 'SN' | 'TF' | 'JP'
  prompt: string
  options: QuestionOption[]
}

export interface Answer {
  question_id: string
  option_id: string
}

export interface QuizSession {
  id: string
  question_bank_version: string
  status: 'in_progress' | 'submitted'
  answers: Answer[]
  created_at?: string
  updated_at?: string
}

export interface QuizVersionPayload {
  question_bank_version: string
  lookback_hint?: string
  questions: Question[]
}

export interface DimensionCounts {
  E: number
  I: number
  S: number
  N: number
  T: number
  F: number
  J: number
  P: number
}

export type ResultSource = 'quiz' | 'self_select'

export interface ResultSnapshot {
  id: string
  source: ResultSource
  type_code: string
  dimension_counts?: DimensionCounts
  question_bank_version: string
  submitted_at: string
  life_stage?: string
  recent_status?: string
  session_id?: string
}

export interface ResultSnapshotSummary {
  id: string
  source: ResultSource
  type_code: string
  question_bank_version: string
  submitted_at: string
  life_stage?: string
}

export interface TypeMeta {
  type_code: string
  name_zh: string
  tagline: string
  description?: string
}

export interface CompareResult {
  baseline_id: string
  target_id: string
  question_bank_version: string
  type_changed: boolean
  baseline_type_code: string
  target_type_code: string
  dimension_deltas?: Record<string, number>
  stability_notes?: string[]
}

export interface SharePreviewResponse {
  preview_url?: string
  job_id?: string
  status: 'ready' | 'pending'
}
