import type { Answer, DimensionCounts, Question } from '../types'
import { optionToLetter } from './questions'

export function scoreQuizAnswers(
  questions: Question[],
  answers: Answer[],
): { type_code: string; dimension_counts: DimensionCounts } {
  const counts: DimensionCounts = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 }
  const byQ = new Map(questions.map((q) => [q.id, q]))

  answers.forEach((a) => {
    const q = byQ.get(a.question_id)
    if (!q) return
    const letter = optionToLetter(q, a.option_id)
    counts[letter as keyof DimensionCounts] += 1
  })

  const type_code =
    (counts.E >= counts.I ? 'E' : 'I') +
    (counts.S >= counts.N ? 'S' : 'N') +
    (counts.T >= counts.F ? 'T' : 'F') +
    (counts.J >= counts.P ? 'J' : 'P')

  return { type_code, dimension_counts: counts }
}
