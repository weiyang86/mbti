import type { Question } from '../types'

export const QUESTION_BANK_VERSION = 'qb-v0.4-teach-1'

const prompts: { dimension: Question['dimension']; text: string }[] = [
  { dimension: 'EI', text: '最近四周，更常从独处中恢复精力？' },
  { dimension: 'EI', text: '小组讨论时，你更习惯先听再说？' },
  { dimension: 'EI', text: '社交活动结束后，你需要 alone time？' },
  { dimension: 'SN', text: '你更关注眼前可验证的细节？' },
  { dimension: 'SN', text: '说明方案时，你偏好举具体例子？' },
  { dimension: 'SN', text: '你对“可能性和联想”耐心有限？' },
  { dimension: 'TF', text: '做决定时，你优先看逻辑一致性？' },
  { dimension: 'TF', text: '冲突时，你更先理清对错而非情绪？' },
  { dimension: 'TF', text: '评价方案时，“是否合理”比“是否舒服”更重要？' },
  { dimension: 'JP', text: '你更喜欢计划先于行动？' },
  { dimension: 'JP', text: '临时改计划会让你略感不安？' },
  { dimension: 'JP', text: '你倾向把待办清掉再放松？' },
]

/** option a = first letter of pair, b = second */
const dimensionLetters: Record<Question['dimension'], [string, string]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
}

export const MOCK_QUESTIONS: Question[] = prompts.map((p, i) => {
  const [a, b] = dimensionLetters[p.dimension]
  return {
    id: `q${i + 1}`,
    index: i + 1,
    dimension: p.dimension,
    prompt: p.text,
    options: [
      { id: `${a.toLowerCase()}`, label: `更贴近 ${a} 侧（同意/是）` },
      { id: `${b.toLowerCase()}`, label: `更贴近 ${b} 侧（不同意/否）` },
    ],
  }
})

export function optionToLetter(question: Question, optionId: string): string {
  const [a, b] = dimensionLetters[question.dimension]
  if (optionId === a.toLowerCase()) return a
  if (optionId === b.toLowerCase()) return b
  return a
}
