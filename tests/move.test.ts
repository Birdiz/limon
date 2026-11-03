import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveOldHost } from "../src/ui/move";

function at(hostname: string, hash: string) {
  const replace = vi.fn();
  vi.stubGlobal("location", { hostname, hash, replace });
  return replace;
}

describe("anciennes adresses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["www.quart-de-tour.fr", "limon-escaliers.up.railway.app"])("%s part en gardant l'ancre", async (host) => {
    const replace = at(host, "#H=3100");
    expect(leaveOldHost()).toBe(true);
    await Promise.resolve();
    expect(replace).toHaveBeenCalledWith("https://quart-de-tour.fr/#H=3100");
  });

  it("part sans ancre quand il n'y en a pas", async () => {
    const replace = at("www.quart-de-tour.fr", "");
    expect(leaveOldHost()).toBe(true);
    await Promise.resolve();
    expect(replace).toHaveBeenCalledWith("https://quart-de-tour.fr/");
  });

  it("garde l'ancre lue avant que la page la réécrive", async () => {
    const replace = at("www.quart-de-tour.fr", "#H=3100");
    leaveOldHost();
    location.hash = "";
    await Promise.resolve();
    expect(replace).toHaveBeenCalledWith("https://quart-de-tour.fr/#H=3100");
  });

  it("reste à la nouvelle adresse", async () => {
    const replace = at("quart-de-tour.fr", "#H=3100");
    expect(leaveOldHost()).toBe(false);
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
  });
});
