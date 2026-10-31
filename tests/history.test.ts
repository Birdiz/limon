import { describe, expect, it } from "vitest";
import { History, HISTORY_LIMIT } from "../src/core/history";
import { DEFAULTS, type Params } from "../src/core/params";

/** Historique à horloge réglable. */
function make(opts: { limit?: number } = {}) {
  let t = 0;
  const h = new History<Params>({ ...DEFAULTS }, { ...opts, now: () => t });
  return { h, wait: (ms: number) => (t += ms) };
}
const P = (o: Partial<Params>): Params => ({ ...DEFAULTS, ...o });

describe("historique des réglages", () => {
  it("n'a rien à annuler ni à rétablir au départ", () => {
    const { h } = make();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it("empile les changements et ignore un état identique", () => {
    const { h } = make();
    expect(h.record(P({}))).toBe(false);
    expect(h.record(P({ H: 2800 }))).toBe(true);
    expect(h.record(P({ H: 2800, W: 900 }))).toBe(true);
    expect(h.undo()).toEqual(P({ H: 2800 }));
    expect(h.undo()).toEqual(P({}));
    expect(h.canUndo()).toBe(false);
  });

  it("rétablit ce qui vient d'être annulé", () => {
    const { h } = make();
    h.record(P({ H: 2800 }));
    h.record(P({ H: 2800, forme: "droit" }));
    h.undo();
    h.undo();
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toEqual(P({ H: 2800 }));
    expect(h.redo()).toEqual(P({ H: 2800, forme: "droit" }));
    expect(h.canRedo()).toBe(false);
  });

  it("regroupe une frappe continue dans un même champ", () => {
    const { h, wait } = make();
    for (const H of [3, 32, 320, 3200]) {
      wait(200);
      h.record(P({ H }), "H");
    }
    expect(h.undo()).toEqual(P({}));
    expect(h.canUndo()).toBe(false);
  });

  it("ouvre une nouvelle étape après une pause, dans un autre champ ou sans champ", () => {
    const { h, wait } = make();
    h.record(P({ H: 2800 }), "H");
    wait(1500);
    h.record(P({ H: 2900 }), "H");
    wait(100);
    h.record(P({ H: 2900, W: 900 }), "W");
    wait(100);
    h.record(P({ H: 2900, W: 900, ...{ cm: false } }));
    wait(100);
    h.record(P({ H: 2900, W: 900, cm: false, ess: "hetre" }));
    expect(h.undo()).toEqual(P({ H: 2900, W: 900, cm: false }));
    expect(h.undo()).toEqual(P({ H: 2900, W: 900 }));
    expect(h.undo()).toEqual(P({ H: 2900 }));
    expect(h.undo()).toEqual(P({ H: 2800 }));
    expect(h.undo()).toEqual(P({}));
  });

  it("ne prolonge pas une étape annulée puis rétablie", () => {
    const { h, wait } = make();
    h.record(P({ H: 2800 }), "H");
    h.undo();
    h.redo();
    wait(100);
    h.record(P({ H: 2900 }), "H");
    expect(h.undo()).toEqual(P({ H: 2800 }));
  });

  it("perd ce qui restait à rétablir après un nouveau changement", () => {
    const { h } = make();
    h.record(P({ H: 2800 }));
    h.record(P({ H: 2900 }));
    h.undo();
    h.record(P({ H: 3000 }));
    expect(h.canRedo()).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()).toEqual(P({ H: 2800 }));
  });

  it("garde un nombre borné d'étapes, les plus récentes", () => {
    const { h } = make({ limit: 3 });
    for (let i = 1; i <= 5; i++) h.record(P({ H: 2700 + i }));
    expect(h.undo()!.H).toBe(2704);
    expect(h.undo()!.H).toBe(2703);
    expect(h.undo()!.H).toBe(2702);
    expect(h.canUndo()).toBe(false);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(50);
  });

  it("garde des copies complètes, y compris des réglages qu'il ne connaît pas", () => {
    type Futur = Params & { palier?: { L: number } };
    const h = new History<Futur>({ ...DEFAULTS });
    const p: Futur = { ...DEFAULTS, palier: { L: 900 } };
    h.record(p);
    p.palier!.L = 1200; // modifier l'objet après coup ne touche pas l'historique
    h.record({ ...DEFAULTS, palier: { L: 1000 } });
    expect(h.undo()).toEqual({ ...DEFAULTS, palier: { L: 900 } });
    const back = h.undo()!;
    expect(back).toEqual(DEFAULTS);
    back.H = 1; // ni l'état rendu
    expect(h.redo()).toEqual({ ...DEFAULTS, palier: { L: 900 } });
    expect(h.undo()).toEqual(DEFAULTS);
  });

  it("repart à zéro", () => {
    const { h } = make();
    h.record(P({ H: 2800 }));
    h.undo();
    h.reset(P({ forme: "droit" }));
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    h.record(P({ forme: "droit", H: 3000 }));
    expect(h.undo()).toEqual(P({ forme: "droit" }));
  });
});
