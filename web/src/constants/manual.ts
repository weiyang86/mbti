/** 按四个字母生成相处小抄，与产品原型 getManual 保持一致 */
export interface TypeManualFields {
  recharge: string
  communication: string
  care: string
}

export interface TypeManualItem {
  no: string
  title: string
  body: string
}

export function manualFields(typeCode = 'INFP'): TypeManualFields {
  const t = typeCode || 'INFP'
  return {
    recharge:
      t[0] === 'I'
        ? '独处一会儿再出发，允许我慢慢恢复电量。'
        : '和熟悉的人一起活动，可能更容易让我恢复电量。',
    communication:
      t[2] === 'F'
        ? '先理解感受，再一起讨论下一步。'
        : '把事实和需求说清楚，一起看可行的办法。',
    care:
      t[3] === 'J'
        ? '重要安排提前说，我更容易安心。'
        : '留一点调整空间，我更容易投入。',
  }
}

export function buildManual(typeCode = 'INFP'): TypeManualItem[] {
  const m = manualFields(typeCode)
  return [
    { no: '01', title: '如何给我充电', body: m.recharge },
    { no: '02', title: '怎样和我沟通', body: m.communication },
    { no: '03', title: '我在意的相处细节', body: m.care },
  ]
}
