/** 常用元素/氧化物分组；只作为前端选择器候选，不参与科学计算。 */

/** 稀土元素（不含 Y），顺序按原子序数。 */
export const REE_ELEMENTS: string[] = [
  'La',
  'Ce',
  'Pr',
  'Nd',
  'Sm',
  'Eu',
  'Gd',
  'Tb',
  'Dy',
  'Ho',
  'Er',
  'Tm',
  'Yb',
  'Lu',
];

/** 蛛网图默认元素顺序（Sun & McDonough, 1989 常用序列）。 */
export const SPIDER_ELEMENTS: string[] = [
  'Cs',
  'Rb',
  'Ba',
  'Th',
  'U',
  'Nb',
  'Ta',
  'La',
  'Ce',
  'Pb',
  'Pr',
  'Sr',
  'Nd',
  'Zr',
  'Hf',
  'Sm',
  'Eu',
  'Ti',
  'Gd',
  'Tb',
  'Dy',
  'Y',
  'Ho',
  'Er',
  'Tm',
  'Yb',
  'Lu',
];

/** TAS 图使用的氧化物集合（与合同 fixtures 的 OXIDES 一致）。 */
export const TAS_OXIDES: string[] = [
  'SiO2',
  'TiO2',
  'Al2O3',
  'FeOT',
  'MnO',
  'MgO',
  'CaO',
  'Na2O',
  'K2O',
  'P2O5',
];
