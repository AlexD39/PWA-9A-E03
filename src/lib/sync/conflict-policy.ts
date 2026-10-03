/**
 * Política de resolución de conflictos (Semana 5).
 *
 * Un conflicto ocurre cuando el servidor rechaza una operación porque el
 * registro cambió desde la última versión que el dispositivo conocía
 * (concurrencia optimista: `baseServerRevision` no coincide). La resolución
 * se hace en el cliente con una fusión de tres vías por campo:
 *
 *   base   = última versión confirmada por el servidor que el cliente conocía
 *   local  = lo que el cliente quiere guardar
 *   remote = lo que el servidor tiene ahora
 *
 * Por cada campo:
 *   - si local y remote coinciden           -> ese valor.
 *   - si solo cambió uno respecto a `base`   -> el valor de quien cambió.
 *   - si cambiaron los dos a valores distintos -> regla explícita del campo:
 *       status    "attention" gana sobre "ok" (nunca se oculta una alerta).
 *       findings  se conserva el máximo (nunca se pierde un hallazgo).
 *       resto     gana el cambio más reciente (`updatedAt`); en empate, el servidor.
 *   - invariante final: hallazgos > 0 implica "attention".
 *
 * Es una función pura y determinista. Cada decisión queda registrada con la
 * regla aplicada y el valor descartado, para que ninguna pérdida de datos sea
 * silenciosa. Ver docs/sync-policy.md.
 */

import {
  FIELD_NAMES,
  fieldsEqual,
  validateInspectionFields,
  type FieldName,
  type InspectionFields
} from "../storage/schema";

export type FieldSource = "equal" | "local" | "remote" | "policy";

export interface FieldDecision {
  source: FieldSource;
  rule: string;
  /** Valor que perdió, cuando hubo cambios concurrentes distintos. */
  discarded?: string | number;
}

export type ConflictStrategy =
  | "identical"
  | "remote-only"
  | "fast-forward-local"
  | "three-way-merge"
  | "fallback-remote";

export interface ConflictSide {
  fields: InspectionFields;
  updatedAt: string;
}

export interface ConflictInput {
  /** Última versión confirmada del servidor conocida por el cliente; `null` si no hay ancestro común. */
  base: InspectionFields | null;
  local: ConflictSide;
  remote: ConflictSide;
}

export interface ConflictResolution {
  merged: InspectionFields;
  decisions: Record<FieldName, FieldDecision>;
  strategy: ConflictStrategy;
  /** Al menos un campo cambió en ambos lados a valores distintos. */
  hadRealConflict: boolean;
}

function timeOf(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveBothChanged(
  name: FieldName,
  local: ConflictSide,
  remote: ConflictSide
): { value: string | number; decision: FieldDecision } {
  const l = local.fields[name];
  const r = remote.fields[name];

  if (name === "status") {
    const winner = l === "attention" ? "local" : "remote";
    return {
      value: "attention",
      decision: {
        source: winner,
        rule: "estado-attention-gana",
        discarded: winner === "local" ? (r as string) : (l as string)
      }
    };
  }

  if (name === "findings") {
    const max = Math.max(l as number, r as number);
    const min = Math.min(l as number, r as number);
    return {
      value: max,
      decision: {
        source: (l as number) >= (r as number) ? "local" : "remote",
        rule: "hallazgos-maximo",
        discarded: min
      }
    };
  }

  const localTime = timeOf(local.updatedAt);
  const remoteTime = timeOf(remote.updatedAt);
  if (localTime > remoteTime) {
    return {
      value: l,
      decision: { source: "local", rule: "ultimo-escritor", discarded: r }
    };
  }
  return {
    value: r,
    decision: {
      source: "remote",
      rule: localTime === remoteTime ? "empate-gana-remoto" : "ultimo-escritor",
      discarded: l
    }
  };
}

export function resolveConflict(input: ConflictInput): ConflictResolution {
  const { base, local, remote } = input;
  const merged = {} as Record<string, string | number>;
  const decisions = {} as Record<FieldName, FieldDecision>;
  let hadRealConflict = false;

  FIELD_NAMES.forEach((name) => {
    const l = local.fields[name];
    const r = remote.fields[name];
    const b = base ? base[name] : undefined;

    if (l === r) {
      merged[name] = l;
      decisions[name] = { source: "equal", rule: "iguales" };
    } else if (base && l === b) {
      merged[name] = r;
      decisions[name] = { source: "remote", rule: "solo-remoto" };
    } else if (base && r === b) {
      merged[name] = l;
      decisions[name] = { source: "local", rule: "solo-local" };
    } else {
      hadRealConflict = true;
      const outcome = resolveBothChanged(name, local, remote);
      merged[name] = outcome.value;
      decisions[name] = outcome.decision;
    }
  });

  // Invariante entre campos: un hallazgo siempre implica estado "attention".
  if (merged.status === "ok" && (merged.findings as number) > 0) {
    decisions.status = {
      source: "policy",
      rule: "invariante-hallazgos-implican-attention",
      discarded: "ok"
    };
    merged.status = "attention";
  }

  const validated = validateInspectionFields(merged);
  if (!validated.ok) {
    // Red de seguridad: si por cualquier motivo la fusión no es válida, se adopta el servidor
    // completo en lugar de enviar datos inválidos en bucle. Queda marcado en la estrategia.
    const fallbackDecisions = {} as Record<FieldName, FieldDecision>;
    FIELD_NAMES.forEach((name) => {
      fallbackDecisions[name] = {
        source: "remote",
        rule: "respaldo-fusion-invalida",
        discarded: local.fields[name]
      };
    });
    return {
      merged: { ...remote.fields },
      decisions: fallbackDecisions,
      strategy: "fallback-remote",
      hadRealConflict: true
    };
  }

  const localChanged = base ? !fieldsEqual(local.fields, base) : true;
  const remoteChanged = base ? !fieldsEqual(remote.fields, base) : true;
  let strategy: ConflictStrategy;
  if (fieldsEqual(local.fields, remote.fields)) strategy = "identical";
  else if (base && !localChanged) strategy = "remote-only";
  else if (base && !remoteChanged) strategy = "fast-forward-local";
  else strategy = "three-way-merge";

  return { merged: validated.value, decisions, strategy, hadRealConflict };
}
