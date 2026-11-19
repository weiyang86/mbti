/** 相处小抄：按两人具体类型的四个维度生成建议，纯前端规则，不提供配对分数 */
export type CompatScene = '初次见面' | '一起出游' | '协作做事'

export const COMPAT_SCENES: CompatScene[] = ['初次见面', '一起出游', '协作做事']

/** 原型默认的「对方类型」，用户可在页面内更换 */
export const DEFAULT_COMPARE_TYPE = 'ENFP'

export const COMPAT_SCENE_TIPS: Record<CompatScene, string> = {
  初次见面: '先交换一张名片，选择一个彼此都感兴趣的活动。',
  一起出游: '先对齐预算、出发时间和独处需求，再安排细节。',
  协作做事: '提前说清分工、反馈方式与截止时间。',
}

export interface CompatNote {
  title: string
  text: string
}

/** 四个字母各自的偏好摘要 */
export function compatProfile(typeCode: string): string {
  if (!typeCode || typeCode.length !== 4) return '等待选择类型'
  const parts = [
    typeCode[0] === 'I' ? '独处回血' : '互动回血',
    typeCode[1] === 'S' ? '先看具体' : '先看可能',
    typeCode[2] === 'T' ? '先讲逻辑' : '先接情绪',
    typeCode[3] === 'J' ? '计划优先' : '弹性优先',
  ]
  return parts.join(' · ')
}

/** 与原型 compat 页面一致的三条建议文案 */
export function compatNotes(a: string, b: string, _scene: CompatScene): CompatNote[] {
  const same = (i: number) => a[i] === b[i]

  const recharge = same(0)
    ? a[0] === 'I'
      ? '都偏好保留独处时间，约见面前先确认精力。'
      : '都可能喜欢互动，也给彼此留出安静的时段。'
    : '一方可能靠互动充电，另一方需要独处；约定活动时长。'

  const communication = same(2)
    ? a[2] === 'F'
      ? '都在意感受时，别把没说出口的期待当成默认共识。'
      : '都重视逻辑时，也记得问问对方的感受。'
    : '讨论分歧时，先确认是想被理解，还是一起找解决办法。'

  const arrangement = same(3)
    ? a[3] === 'J'
      ? '提前说好安排，遇到变化再一起更新计划。'
      : '保持弹性，也给重要的约定一个明确时间。'
    : '一方喜欢计划、一方偏好弹性；确定关键节点，其余留白。'

  return [
    { title: '充电节奏', text: recharge },
    { title: '沟通方式', text: communication },
    { title: '安排偏好', text: arrangement },
  ]
}
