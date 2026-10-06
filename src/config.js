// Physical dimensions of the store, in metres. Tweak here to reshape the whole building.
export const DIM = {
  // A rental clamshell VHS case
  CASE_W: 0.13,
  CASE_H: 0.21,
  CASE_D: 0.032,
  CASE_TILT: (8 * Math.PI) / 180, // lean back against the shelf
  SLOT_PITCH: 0.16, // horizontal spacing between face-out cases

  // Shelving
  BAY_W: 1.2,
  SHELF_COUNT: 5,
  SHELF_Y0: 0.26, // top surface of the lowest shelf
  SHELF_PITCH: 0.33,
  SHELF_DEPTH: 0.3,
  UNIT_H: 1.98,
  SIGN_H: 0.3,

  // Floor plan
  G_DEPTH: 0.64, // double-sided gondola: two shelf depths + spine
  ENDCAP: 0.3,
  WALL_UNIT: 0.34,
  AISLE: 1.9,
  SIDE_AISLE: 2.0,
  FRONT: 5.8, // entrance / checkout zone depth
  BACK_AISLE: 2.4,
  CEILING: 3.4,

  // Player
  EYE: 1.62,
  RADIUS: 0.28,
  WALK: 2.4,
  RUN: 4.2,
  REACH: 2.3, // how far away you can grab a tape
};

export const CASES_PER_BAY_ROW = Math.floor((DIM.BAY_W - 0.06) / DIM.SLOT_PITCH);
export const SLOTS_PER_BAY = CASES_PER_BAY_ROW * DIM.SHELF_COUNT;

// Brand palette (store fixtures, UI). Aisle colours come from the catalog.
export const BRAND = {
  navy: '#121a3d',
  navyDeep: '#0a0f26',
  yellow: '#ffc61a',
  magenta: '#ff2e88',
  cyan: '#2ee6ff',
  cream: '#f4ecd8',
};

export const AISLE_PALETTE = [
  '#ff3b3b', '#ffb000', '#3ddc84', '#29b6f6', '#b388ff', '#ff4fa3',
  '#00e5c0', '#ff7a00', '#c6ff00', '#7c4dff', '#ff1744', '#18ffff',
];
