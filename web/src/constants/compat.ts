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

/** 与原型 compatNotes 完全一致的文案生成规则 */
export function compatNotes(a: string, b: string, scene: CompatScene): CompatNote[] {
  const same = (i: number) => a[i] === b[i]

  const recharge = same(0)
    ? a[0] === 'I'
      ? '你们都需要独处充电：见面之前先确认彼此的电量，不用把安静理解成疏远。'
      : '你们都容易在互动中充电：聊得开心时也留一点各自消化的时间，避免一次耗尽。'
    : a[0] === 'E'
      ? `你偏向互动充电，${b} 更需要独处：活动之间留缓冲，别把对方的“暂时不回”当成冷淡。`
      : `你更需要独处，${b} 偏向互动：提前说明安静时间，不代表拒绝对方。`

  const information = same(1)
    ? a[1] === 'S'
      ? '你们都先看具体经验：讨论计划时给例子、时间和可执行步骤，会更有安全感。'
      : '你们都爱先看可能性：聊想法很过瘾，但重要决定要落回具体时间、预算和下一步。'
    : a[1] === 'S'
      ? `你先看具体信息，${b} 更爱联想可能：对方展开脑洞时，先听完再问“具体下一步是什么”。`
      : `你先看可能性，${b} 更重具体：给想法时配一个可执行的小步骤，别让对方觉得只是空谈。`

  const communication = same(2)
    ? a[2] === 'T'
      ? '你们习惯先讲事实和方案：分歧时补一句“我理解你的在意”，会更顺。'
      : '你们都先照顾感受：重要决定前，把期待说成具体请求，别让对方猜。'
    : a[2] === 'T'
      ? `你习惯先理逻辑，${b} 更先接情绪：对方说感受时先别急着给方案，问一句“想被理解还是一起解决”。`
      : `你先接情绪，${b} 更先理逻辑：需要建议时直接说，能减少“你根本不关心”的误读。`

  const care = same(3)
    ? a[3] === 'J'
      ? '你们都喜欢提前确定：临时变化时一起更新时间表，而不是各自默默调整。'
      : '你们都偏好弹性：重要节点仍要明确，其余留给现场。'
    : a[3] === 'J'
      ? `你偏好提前定好，${b} 更随性：把必须确定的关键节点说清楚，其余留白，别把弹性当成不上心。`
      : `你更随性，${b} 偏好提前安排：收到计划给明确确认，临时调整尽量提前说。`

  const sceneNote: Record<CompatScene, string> = {
    初次见面:
      a[0] === 'E' && b[0] === 'E'
        ? '第一次见面可以选有活动可聊的轻松场合，也给彼此留一个自然结束的点。'
        : '第一次见面选安静、可随时结束的地方；先从共同兴趣切入，不用一次聊完所有话题。',
    一起出游:
      a[3] === 'J' && b[3] === 'J'
        ? '出发前把预算、时间和分工定好，留半天弹性给现场。'
        : '行程只锁定关键节点，其余留白；每天确认一次彼此的电量和预算。',
    协作做事:
      a[2] === 'T' && b[2] === 'T'
        ? '先对齐目标和验收标准，反馈直接说事实，也说明你认可的部分。'
        : '先约定反馈方式：哪些话需要直说，哪些先照顾情绪；重要决定留出确认时间。',
  }

  return [
    { title: '充电节奏', text: recharge },
    { title: '信息方式', text: information },
    { title: '沟通方式', text: communication },
    { title: '安排偏好', text: care },
    { title: '这次场景', text: sceneNote[scene] },
  ]
}
