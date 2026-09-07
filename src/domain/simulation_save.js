/**
 * Simulation Save Slots Domain Module
 *
 * Manages up to 5 simulation build save slots with validated names (max 10 chars)
 * and serialized state payloads.
 */

export const MAX_SIMULATION_SAVE_SLOTS = 5;
export const MAX_SIMULATION_SLOT_NAME_LENGTH = 10;
export const SIMULATION_SAVE_PREFIX = "sim_build_slot_";

export function sanitizeSlotName(name, defaultName = "配點方案") {
  const clean = String(name || "").trim();
  if (!clean) return defaultName.slice(0, MAX_SIMULATION_SLOT_NAME_LENGTH);
  return clean.slice(0, MAX_SIMULATION_SLOT_NAME_LENGTH);
}

export function getSlotKey(slotId) {
  const id = Math.max(1, Math.min(MAX_SIMULATION_SAVE_SLOTS, Math.floor(Number(slotId) || 1)));
  return `${SIMULATION_SAVE_PREFIX}${id}`;
}

export function serializeSimulationSlot({ id, name, simulation }) {
  const cleanId = Math.max(1, Math.min(MAX_SIMULATION_SAVE_SLOTS, Math.floor(Number(id) || 1)));
  const cleanName = sanitizeSlotName(name, `配點方案 ${cleanId}`);
  const ranks = simulation?.ranks instanceof Map
    ? Object.fromEntries(simulation.ranks.entries())
    : (simulation?.ranks || {});
  const rawDice = simulation?.team?.dice || [];
  const diceIds = Array.isArray(rawDice)
    ? rawDice.map((d) => String(d?.id || d)).filter(Boolean).slice(0, 5)
    : [];
  const spent = simulation?.spent || { gold: 0, core: 0, solar: 0 };

  return {
    id: cleanId,
    name: cleanName,
    updatedAt: Date.now(),
    spent: {
      gold: Number(spent.gold || 0),
      core: Number(spent.core || 0),
      solar: Number(spent.solar || 0)
    },
    teamDiceIds: diceIds,
    ranks
  };
}

export function listSimulationSlots(storagePort) {
  if (!storagePort) return new Array(MAX_SIMULATION_SAVE_SLOTS).fill(null);
  const slots = [];
  for (let i = 1; i <= MAX_SIMULATION_SAVE_SLOTS; i += 1) {
    const raw = storagePort.getItem(getSlotKey(i));
    if (!raw) {
      slots.push(null);
      continue;
    }
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        slots.push({
          id: i,
          name: sanitizeSlotName(parsed.name, `配點方案 ${i}`),
          updatedAt: Number(parsed.updatedAt || 0),
          spent: parsed.spent || { gold: 0, core: 0, solar: 0 },
          teamDiceIds: Array.isArray(parsed.teamDiceIds) ? parsed.teamDiceIds : [],
          ranks: parsed.ranks || {}
        });
      } else {
        slots.push(null);
      }
    } catch {
      slots.push(null);
    }
  }
  return slots;
}

export function saveSimulationSlot(storagePort, slotId, { name, simulation }) {
  if (!storagePort) return { ok: false, error: "storage-unavailable" };
  const payload = serializeSimulationSlot({ id: slotId, name, simulation });
  try {
    storagePort.setItem(getSlotKey(payload.id), JSON.stringify(payload));
    return { ok: true, slot: payload };
  } catch (err) {
    return { ok: false, error: err?.message || "storage-write-failed" };
  }
}

export function loadSimulationSlot(storagePort, slotId) {
  if (!storagePort) return null;
  const raw = storagePort.getItem(getSlotKey(slotId));
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      id: Math.max(1, Math.min(MAX_SIMULATION_SAVE_SLOTS, Math.floor(Number(slotId) || 1))),
      name: sanitizeSlotName(parsed.name, `配點方案 ${slotId}`),
      updatedAt: Number(parsed.updatedAt || 0),
      spent: parsed.spent || { gold: 0, core: 0, solar: 0 },
      teamDiceIds: Array.isArray(parsed.teamDiceIds) ? parsed.teamDiceIds : [],
      ranks: parsed.ranks || {}
    };
  } catch {
    return null;
  }
}

export function deleteSimulationSlot(storagePort, slotId) {
  if (!storagePort) return false;
  try {
    storagePort.removeItem(getSlotKey(slotId));
    return true;
  } catch {
    return false;
  }
}
