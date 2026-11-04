import type { Question } from '../types'

/**
 * 题库内容与 UIhtml/mbti-buddy-prototype.html 中的 QUIZ 保持一致。
 * 注意：题库内容替换后，历史快照仍沿用 qb-v0.4-teach-1（是否递增版本号待 Remy 定稿）。
 */
export const QUESTION_BANK_VERSION = 'qb-v0.4-teach-1'

const quiz: {
  dimension: Question['dimension']
  prompt: string
  a: string
  b: string
}[] = [
  {
    dimension: 'EI',
    prompt: '忙完一周，你更想用哪种方式恢复电量？',
    a: '和熟悉的人一起吃饭、出门',
    b: '给自己一段安静独处的时间',
  },
  {
    dimension: 'SN',
    prompt: '去一个没去过的地方，你通常先关注什么？',
    a: '路线、环境、吃住这些具体信息',
    b: '它有什么故事，还有哪些新可能',
  },
  {
    dimension: 'TF',
    prompt: '朋友和你商量一个难题，你更习惯先做什么？',
    a: '梳理事实，找出可执行的办法',
    b: '了解他的感受和真正的在意',
  },
  {
    dimension: 'JP',
    prompt: '准备周末出游，你更舒服的方式是？',
    a: '先定好安排，到了照着走',
    b: '留出弹性，到时看心情',
  },
  {
    dimension: 'EI',
    prompt: '来到一个不太熟悉的聚会，你通常会？',
    a: '主动找人认识，在互动中进入状态',
    b: '先观察，找到合适的人再靠近',
  },
  {
    dimension: 'SN',
    prompt: '开始学习一件新事，你更想先看到？',
    a: '清楚的步骤和具体示范',
    b: '整体思路和背后的原理',
  },
  {
    dimension: 'TF',
    prompt: '意见不一致时，你更希望讨论围绕什么？',
    a: '依据是否充分，方案是否合理',
    b: '各方在意什么，怎样彼此尊重',
  },
  {
    dimension: 'JP',
    prompt: '一件事有截止日期，你更倾向于？',
    a: '拆好步骤，提前完成',
    b: '保留调整空间，灵感来了集中完成',
  },
  {
    dimension: 'EI',
    prompt: '有一个新想法时，你更常？',
    a: '先说出来，和别人一起理清',
    b: '先自己想清楚，再与人分享',
  },
  {
    dimension: 'SN',
    prompt: '听别人讲经历，什么更吸引你？',
    a: '实际发生的细节与体验',
    b: '这段经历带来的联想与意义',
  },
  {
    dimension: 'TF',
    prompt: '必须做一个取舍时，你通常优先考虑？',
    a: '尽量一致的标准与逻辑',
    b: '它对具体人的影响与感受',
  },
  {
    dimension: 'JP',
    prompt: '原定计划临时有变，你更接近哪种反应？',
    a: '先重新整理安排，再继续',
    b: '顺势看看有没有更有趣的选择',
  },
]

/** option a = 该维度第一个字母，option b = 第二个字母 */
const dimensionLetters: Record<Question['dimension'], [string, string]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
}

export const MOCK_QUESTIONS: Question[] = quiz.map((item, i) => {
  const [a, b] = dimensionLetters[item.dimension]
  return {
    id: `q${i + 1}`,
    index: i + 1,
    dimension: item.dimension,
    prompt: item.prompt,
    options: [
      { id: a.toLowerCase(), label: item.a },
      { id: b.toLowerCase(), label: item.b },
    ],
  }
})

export function optionToLetter(question: Question, optionId: string): string {
  const [a, b] = dimensionLetters[question.dimension]
  if (optionId === a.toLowerCase()) return a
  if (optionId === b.toLowerCase()) return b
  return a
}
