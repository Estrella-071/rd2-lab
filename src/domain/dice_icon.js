/**
 * Pure mapping from canonical dice data to the public rank-three icon asset.
 * The resolver has no browser or filesystem dependency, so every layer can
 * use the same asset contract without importing a view module.
 */

export const DICE_3_ALIASES = {
  Trap: "Dice_Thorn3.png",
  Fear: "Dice_TRANSFER3.png",
  Box: "Dice_Slow3.png",
  Death: "Dice_SPEEDGUN3.png",
  Decay: "Dice_Crack3.png",
  Solitude: "Dice_Solitude_3.png",
  Fire: "Dice_fire3.png",
  Ice: "Dice_ICE3.png",
  Iron: "Dice_iron_3.png",
  Bubble: "Dice_BUBBLE3.png",
  Bingo: "Dice_BINGO3.png",
  Flower: "Dice_Flower3.png",
  Lock: "Dice_Lock3.png",
  Punch: "Dice_Punch3.png",
  BrokenGrowth: "Dice_BrokenGrowth3.png",
  Executioner: "Dice_Executioner3.png",
  Blessing: "Dice_Blessing3.png",
  Alignment: "Dice_Alignment3.png",
  Tyrant: "Dice_Tyrant3.png",
  Doom: "Dice_Doom3.png",
  Mutation: "Dice_Mutation3.png",
  Predator: "Dice_Predator3.png",
  Potion: "Dice_Potion3.png",
  Switch: "Dice_Switch3.png",
  Gear: "Dice_Gear3.png",
  Wind: "Dice_Wind3.png",
  Light: "Dice_Light3.png",
  Poison: "Dice_Poison3.png",
  Summon: "Dice_summon3.png",
  Combo: "Dice_Combo3.png",
  Adjust: "Dice_Adjust3.png",
  Pillar: "Dice_Pillar3.png",
  Mine: "Dice_Mine3.png",
  Sniper: "Dice_Sniper3.png",
  Ray: "Dice_Ray3.png",
  Electric: "Dice_Electric3.png",
  Resonance: "Dice_Resonance3.png",
  Shuriken: "Dice_shuriken3.png",
  Element: "Dice_Element3.png",
  Neon: "Dice_Neon3.png",
  SawBlade: "Dice_SawBlade3.png",
};

export function resolveNode3Icon(node) {
  if (node?.node_type !== "DICE") return null;

  const diceType = node.dice_type;
  if (diceType && DICE_3_ALIASES[diceType]) return DICE_3_ALIASES[diceType];

  const shortLabel = node.short_label;
  if (shortLabel && DICE_3_ALIASES[shortLabel]) return DICE_3_ALIASES[shortLabel];

  if (node.icon_name) {
    const iconName = String(node.icon_name);
    let suffixStart = iconName.length;
    while (suffixStart > 0) {
      const code = iconName.codePointAt(suffixStart - 1);
      if (code < 48 || code > 57) break;
      suffixStart -= 1;
    }
    return suffixStart === iconName.length
      ? `${iconName}.png`
      : `${iconName.slice(0, suffixStart)}3.png`;
  }
  if (diceType) return `Dice_${diceType}3.png`;
  return null;
}
