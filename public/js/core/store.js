import { api } from "./api.js";

export const store = {
  buildings: [],
  async loadBuildings(force = false) {
    if (this.buildings.length && !force) return this.buildings;
    const data = await api.get("/buildings");
    this.buildings = data.buildings;
    return this.buildings;
  },
};
